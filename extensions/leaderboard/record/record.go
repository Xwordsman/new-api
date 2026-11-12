// Package record captures leaderboard facts without depending on gateway models.
package record

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Policy struct {
	Enabled       bool
	Savings       bool
	Cyber         bool
	ModelPrefixes []string
	SafetyCodes   []string
}

type Runtime struct {
	DB     *gorm.DB
	Policy Policy
}

var runtime atomic.Pointer[Runtime]

func Configure(db *gorm.DB, policy Policy) {
	policy.ModelPrefixes = append([]string(nil), policy.ModelPrefixes...)
	policy.SafetyCodes = append([]string(nil), policy.SafetyCodes...)
	runtime.Store(&Runtime{DB: db, Policy: policy})
}

// SavingsBasis is frozen with the request, and persisted with asynchronous
// tasks. Standard is the public group rate before membership/public discounts.
// StandardQuota, when available, preserves the settlement's exact rounding.
type SavingsBasis struct {
	Standard      float64 `json:"standard"`
	Effective     float64 `json:"effective"`
	StandardQuota *int    `json:"standard_quota,omitempty"`
	Unreliable    bool    `json:"unreliable,omitempty"`
}

func (b *SavingsBasis) Capture(quota int, clamp *common.QuotaClamp) {
	if b == nil {
		return
	}
	b.StandardQuota = nil
	b.Unreliable = clamp != nil
	if clamp == nil && quota >= 0 {
		b.StandardQuota = &quota
	}
}

func (b *SavingsBasis) Discounted() bool {
	return b != nil && b.Standard > 0 && b.Effective >= 0 && b.Effective < b.Standard &&
		!math.IsNaN(b.Standard) && !math.IsInf(b.Standard, 0) && !math.IsNaN(b.Effective) && !math.IsInf(b.Effective, 0)
}

func (b SavingsBasis) Savings(charged int) int64 {
	if charged < 0 || b.Unreliable || !b.Discounted() {
		return 0
	}
	if b.StandardQuota != nil {
		return int64(max(0, *b.StandardQuota-charged))
	}
	if b.Effective == 0 {
		return 0 // No inverse of a free rate; never invent an undiscounted charge.
	}
	// Compare with the same settled usage, never with today's pricing. Round at
	// the same quota granularity as billing, using the bounded quota helpers.
	standard, clamp := common.QuotaFromDecimalChecked(decimal.NewFromInt(int64(charged)).
		Mul(decimal.NewFromFloat(b.Standard)).Div(decimal.NewFromFloat(b.Effective)))
	if clamp != nil {
		return 0 // A saturated estimate is not a trustworthy saving.
	}
	return int64(max(0, standard-charged))
}

type Receipt struct {
	ReceiptID string `gorm:"primaryKey;type:varchar(64)"`
	UserID    int
	Savings   int64
	Version   int64
}

func (Receipt) TableName() string { return "extension_leaderboard_receipts" }

type Saving struct {
	ID        int64  `gorm:"primaryKey"`
	Receipt   string `gorm:"type:varchar(64);uniqueIndex:leaderboard_saving_version"`
	Version   int64  `gorm:"uniqueIndex:leaderboard_saving_version"`
	UserID    int    `gorm:"index"`
	Amount    int64
	CreatedAt int64 `gorm:"index"`
}

func (Saving) TableName() string { return "extension_leaderboard_savings" }

type Warning struct {
	Key       string `gorm:"primaryKey;type:varchar(64)"`
	UserID    int    `gorm:"index"`
	Model     string `gorm:"type:varchar(200)"`
	Code      string `gorm:"type:varchar(100)"`
	CreatedAt int64  `gorm:"index"`
}

func (Warning) TableName() string { return "extension_leaderboard_warnings" }

func Migrate(db *gorm.DB) error { return db.AutoMigrate(&Receipt{}, &Saving{}, &Warning{}) }

var errConcurrentReceipt = errors.New("leaderboard receipt changed")

// SetSavings records an absolute settled saving. A journal delta is written in
// the same transaction, so retries, task corrections and refunds do not inflate
// totals. Corrections belong to their settlement day, including negative ones.
func SetSavings(ctx context.Context, db *gorm.DB, key string, userID int, savings int64, now int64) error {
	if key == "" || userID <= 0 || savings < 0 {
		return errors.New("invalid leaderboard receipt")
	}
	key = fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("%d:%s", userID, key))))
	for range 4 {
		err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&Receipt{ReceiptID: key, UserID: userID}).Error; err != nil {
				return err
			}
			var old Receipt
			if err := tx.Where("receipt_id = ?", key).Take(&old).Error; err != nil {
				return err
			}
			if old.Savings == savings {
				return nil
			}
			r := tx.Model(&Receipt{}).Where("receipt_id = ? AND version = ?", key, old.Version).
				Updates(map[string]any{"savings": savings, "version": old.Version + 1})
			if r.Error != nil {
				return r.Error
			}
			if r.RowsAffected != 1 {
				return errConcurrentReceipt
			}
			return tx.Create(&Saving{Receipt: key, Version: old.Version + 1, UserID: userID, Amount: savings - old.Savings, CreatedAt: now}).Error
		})
		if !errors.Is(err, errConcurrentReceipt) {
			return err
		}
	}
	return errConcurrentReceipt
}

func Settled(ctx context.Context, key string, userID int, basis *SavingsBasis, charged int, refund bool) {
	r := runtime.Load()
	if r == nil || r.DB == nil || !r.Policy.Enabled || !r.Policy.Savings || basis == nil || key == "" || userID <= 0 {
		return
	}
	amount := basis.Savings(charged)
	if refund {
		amount = 0
	}
	// Billing has already committed. Client cancellation must not discard this
	// fact; use a short independent context. Reporting never changes billing.
	writeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := SetSavings(writeCtx, r.DB, key, userID, amount, time.Now().Unix()); err != nil {
		common.SysError("leaderboard savings: " + err.Error())
	}
}

func MatchesSafety(policy Policy, model, code, errorType string) bool {
	if !policy.Enabled || !policy.Cyber {
		return false
	}
	matchedModel := false
	for _, prefix := range policy.ModelPrefixes {
		if strings.HasPrefix(strings.ToLower(model), strings.ToLower(prefix)) {
			matchedModel = true
			break
		}
	}
	if !matchedModel {
		return false
	}
	for _, allowed := range policy.SafetyCodes {
		if strings.EqualFold(code, allowed) || strings.EqualFold(errorType, allowed) {
			return true
		}
	}
	return false
}

// ObserveSafetyEvent reads structured upstream SSE facts before protocol
// conversion. Stream handlers can settle delivered output and return no error
// after an upstream failure, so the normal relay error hook is insufficient.
// Generated text, refusal prose and local permission failures are not signals.
func ObserveSafetyEvent(ctx context.Context, requestID string, userID int, model, data string) {
	r := runtime.Load()
	if r == nil || r.DB == nil || !r.Policy.Enabled || !r.Policy.Cyber || requestID == "" || userID <= 0 {
		return
	}
	if !strings.Contains(data, `"error"`) && !strings.Contains(data, `"finish_reason"`) {
		return
	}
	type upstreamError struct {
		Code string `json:"code"`
		Type string `json:"type"`
	}
	var event struct {
		Type     string         `json:"type"`
		Code     string         `json:"code"`
		Error    *upstreamError `json:"error"`
		Response *struct {
			Error *upstreamError `json:"error"`
		} `json:"response"`
		Choices []struct {
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
	}
	if common.UnmarshalJsonStr(data, &event) != nil {
		return
	}
	if event.Error != nil {
		SafetyWarning(ctx, requestID, userID, model, event.Error.Code, event.Error.Type)
	}
	if event.Type == "error" {
		SafetyWarning(ctx, requestID, userID, model, event.Code, event.Type)
	}
	if event.Type == "response.failed" && event.Response != nil && event.Response.Error != nil {
		SafetyWarning(ctx, requestID, userID, model, event.Response.Error.Code, event.Response.Error.Type)
	}
	for _, choice := range event.Choices {
		if choice.FinishReason == "content_filter" {
			SafetyWarning(ctx, requestID, userID, model, choice.FinishReason, "")
			break
		}
	}
}

func SafetyWarning(ctx context.Context, requestID string, userID int, model, code, errorType string) {
	r := runtime.Load()
	if r == nil || r.DB == nil || requestID == "" || userID <= 0 || !MatchesSafety(r.Policy, model, code, errorType) {
		return
	}
	if len(model) > 200 || len(code) > 100 {
		return
	}
	if code == "" {
		code = errorType
	}
	warning := Warning{
		Key:    fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("%d:%s", userID, requestID)))),
		UserID: userID, Model: model, Code: code, CreatedAt: time.Now().Unix(),
	}
	writeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := r.DB.WithContext(writeCtx).Clauses(clause.OnConflict{DoNothing: true}).Create(&warning).Error; err != nil {
		common.SysError("leaderboard safety warning: " + err.Error())
	}
}
