package checkin

import (
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/extensions/checkin/policy"
	"github.com/QuantumNous/new-api/extensions/referral/ledger"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func respond(c *gin.Context, data any, err error) {
	if err == nil {
		common.ApiSuccess(c, data)
		return
	}
	if policy.IsPolicyError(err) {
		common.ApiError(c, err)
		return
	}
	common.SysError("check-in: " + err.Error())
	common.ApiError(c, policy.ErrUnavailable)
}

func dashboard(c *gin.Context) {
	data, err := policy.Dashboard(model.DB.WithContext(c.Request.Context()), c.GetInt("id"), c.Query("month"), time.Now())
	respond(c, data, err)
}

// LegacyStatusHandler preserves upstream's response fields while exposing the
// authoritative plugin qualification and continuing the existing history.
func LegacyStatusHandler(c *gin.Context) {
	data, err := policy.Dashboard(model.DB.WithContext(c.Request.Context()), c.GetInt("id"), c.Query("month"), time.Now())
	if err != nil {
		respond(c, nil, err)
		return
	}
	respond(c, gin.H{
		"enabled": data.Enabled, "min_quota": data.Rules.RewardMinQuota, "max_quota": data.Rules.RewardMaxQuota,
		"stats": gin.H{
			"total_quota": data.Stats.TotalQuota, "total_checkins": data.Stats.TotalCheckins,
			"checkin_count": data.Stats.MonthCheckins, "checked_in_today": data.CheckedInToday, "records": data.Records,
		},
		"rules": data.Rules, "eligibility": data.Eligibility, "claimable": data.Claimable,
		"claim_reason": data.ClaimReason, "verification_required": data.VerificationRequired,
		"today": data.Today, "timezone": data.Timezone, "next_reset_at": data.NextResetAt,
	}, nil)
}

// ClaimHandler is shared by the plugin and upstream check-in endpoint. It
// consumes a CAPTCHA only once and always derives the recipient from auth.
func ClaimHandler(c *gin.Context) {
	settings, err := policy.GetSettings(model.DB.WithContext(c.Request.Context()))
	if err != nil {
		respond(c, nil, err)
		return
	}
	if !settings.Enabled {
		respond(c, nil, policy.ErrDisabled)
		return
	}
	verified := false
	if settings.RequireTurnstile || common.TurnstileCheckEnabled {
		if !common.TurnstileCheckEnabled || common.TurnstileSiteKey == "" || common.TurnstileSecretKey == "" {
			respond(c, nil, policy.ErrVerificationUnavailable)
			return
		}
		token := c.Query("turnstile")
		if token == "" || len(token) > 2048 {
			respond(c, nil, policy.ErrVerificationRequired)
			return
		}
		form := url.Values{"secret": {common.TurnstileSecretKey}, "response": {token}, "remoteip": {c.ClientIP()}}
		request, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, "https://challenges.cloudflare.com/turnstile/v0/siteverify", strings.NewReader(form.Encode()))
		if err != nil {
			respond(c, nil, policy.ErrVerificationRequired)
			return
		}
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		client := http.Client{Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		response, err := client.Do(request)
		if err != nil {
			respond(c, nil, policy.ErrVerificationRequired)
			return
		}
		defer response.Body.Close()
		var result struct {
			Success bool `json:"success"`
		}
		if response.StatusCode != http.StatusOK || common.DecodeJson(io.LimitReader(response.Body, 16<<10), &result) != nil || !result.Success {
			respond(c, nil, policy.ErrVerificationRequired)
			return
		}
		verified = true
	}
	checkin, err := model.UserCheckin(c.GetInt("id"), verified)
	if err != nil {
		respond(c, nil, err)
		return
	}
	model.RecordLog(checkin.UserId, model.LogTypeSystem, common.NewMessage("Daily check-in, received {{quota}}", map[string]any{"quota": logger.FormatQuota(checkin.QuotaAwarded)}))
	common.ApiSuccessT(c, "Check-in successful", gin.H{"quota_awarded": checkin.QuotaAwarded, "checkin_date": checkin.CheckinDate})
}

func getSettings(c *gin.Context) {
	settings, err := policy.GetSettings(model.DB.WithContext(c.Request.Context()))
	respond(c, settings, err)
}

func putSettings(c *gin.Context) {
	var input policy.Settings
	if common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10), &input) != nil {
		respond(c, nil, policy.ErrInvalid)
		return
	}
	settings, err := policy.UpdateSettings(model.DB.WithContext(c.Request.Context()), input, c.GetInt("id"))
	respond(c, settings, err)
}

// A bounded shared pagination contract keeps filters and offsets identical
// across the administrator's accounts, payment ledger, and audit trail.
func adminPage(c *gin.Context) (int, int, int, error) {
	page, err := strconv.Atoi(c.DefaultQuery("p", c.DefaultQuery("page", "1")))
	if err != nil || page < 1 || page > 1000000 {
		return 0, 0, 0, policy.ErrInvalid
	}
	pageSize, err := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if err != nil || pageSize < 1 || pageSize > 100 {
		return 0, 0, 0, policy.ErrInvalid
	}
	userID, err := strconv.Atoi(c.DefaultQuery("user_id", "0"))
	if err != nil || userID < 0 {
		return 0, 0, 0, policy.ErrInvalid
	}
	return page, pageSize, userID, nil
}

func accounts(c *gin.Context) {
	page, pageSize, userID, err := adminPage(c)
	if err != nil {
		respond(c, nil, err)
		return
	}
	rows, total, err := policy.GetAccounts(model.DB.WithContext(c.Request.Context()), userID, c.Query("state"), page, pageSize)
	respond(c, gin.H{"items": rows, "total": total, "page": page, "page_size": pageSize}, err)
}

func updateAccount(c *gin.Context) {
	userID, err := strconv.Atoi(c.Param("id"))
	var input struct {
		State  string `json:"state"`
		Reason string `json:"reason"`
	}
	if err != nil || userID <= 0 || common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 4096), &input) != nil {
		respond(c, nil, policy.ErrInvalid)
		return
	}
	account, err := policy.UpdateAccount(model.DB.WithContext(c.Request.Context()), userID, c.GetInt("id"), input.State, input.Reason)
	respond(c, account, err)
}

func payments(c *gin.Context) {
	page, pageSize, userID, err := adminPage(c)
	if err != nil {
		respond(c, nil, err)
		return
	}
	rows, total, err := policy.GetPayments(model.DB.WithContext(c.Request.Context()), policy.PaymentQuery{
		UserID: userID, Source: c.Query("source"), Status: c.Query("status"), TradeNo: c.Query("trade_no"), Page: page, PageSize: pageSize,
	})
	respond(c, gin.H{"items": rows, "total": total, "page": page, "page_size": pageSize}, err)
}

func audits(c *gin.Context) {
	page, pageSize, userID, err := adminPage(c)
	if err != nil {
		respond(c, nil, err)
		return
	}
	query := model.DB.WithContext(c.Request.Context()).Model(&policy.Audit{})
	if userID > 0 {
		query = query.Where("user_id = ?", userID)
	}
	if action := c.Query("action"); action != "" {
		switch action {
		case "settings", "claim", "account_active", "account_paused", "payment_reconcile", "payment_refund":
			query = query.Where("action = ?", action)
		default:
			respond(c, nil, policy.ErrInvalid)
			return
		}
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		respond(c, nil, err)
		return
	}
	rows := make([]policy.Audit, 0, pageSize)
	err = query.Order("id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&rows).Error
	respond(c, gin.H{"items": rows, "total": total, "page": page, "page_size": pageSize}, err)
}

func reconcile(c *gin.Context) {
	var input struct {
		UserID     int    `json:"user_id"`
		Source     string `json:"source"`
		TradeNo    string `json:"trade_no"`
		Reference  string `json:"reference"`
		Amount     string `json:"amount"`
		Currency   string `json:"currency"`
		USDPerUnit string `json:"usd_per_unit"`
		Reason     string `json:"reason"`
	}
	if common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 4096), &input) != nil || input.UserID <= 0 || input.TradeNo == "" || len(input.TradeNo) > 191 || len(strings.TrimSpace(input.Reference)) > 128 {
		respond(c, nil, policy.ErrInvalid)
		return
	}
	input.Reference = strings.TrimSpace(input.Reference)
	err := model.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if _, err := policy.LockSettings(tx); err != nil {
			return err
		}
		var provider string
		var paidAt int64
		// Payment callbacks lock the host order before settings. Reconciliation
		// reads a completed order without locking it, avoiding the reverse order.
		switch input.Source {
		case policy.PaymentSourceTopUp:
			var order model.TopUp
			if err := tx.Select("user_id", "payment_provider", "payment_method", "complete_time").Where("trade_no = ? AND user_id = ? AND status = ?", input.TradeNo, input.UserID, common.TopUpStatusSuccess).Take(&order).Error; errors.Is(err, gorm.ErrRecordNotFound) {
				return policy.ErrPaymentNotFound
			} else if err != nil {
				return err
			}
			provider, paidAt = order.PaymentProvider, order.CompleteTime
			if order.PaymentMethod == model.PaymentMethodBalance {
				return policy.ErrPaymentInvalid
			}
		case policy.PaymentSourceSubscription:
			var order model.SubscriptionOrder
			if err := tx.Select("user_id", "payment_provider", "payment_method", "complete_time").Where("trade_no = ? AND user_id = ? AND status = ?", input.TradeNo, input.UserID, common.TopUpStatusSuccess).Take(&order).Error; errors.Is(err, gorm.ErrRecordNotFound) {
				return policy.ErrPaymentNotFound
			} else if err != nil {
				return err
			}
			provider, paidAt = order.PaymentProvider, order.CompleteTime
			if order.PaymentMethod == model.PaymentMethodBalance {
				return policy.ErrPaymentInvalid
			}
		default:
			return policy.ErrPaymentInvalid
		}
		payment := ledger.Payment{Amount: input.Amount, Currency: input.Currency, USDPerUnit: input.USDPerUnit, Reference: input.Reference, PaidAt: paidAt}
		var previous policy.PaymentRecord
		if err := tx.Where("trade_no = ?", input.TradeNo).Take(&previous).Error; err == nil {
			if previous.UserID != input.UserID || previous.Source != input.Source || (provider != "" && provider != previous.Provider) || (input.Reference != "" && input.Reference != previous.Reference) {
				return policy.ErrPaymentConflict
			}
			provider, payment.Reference, payment.PaidAt = previous.Provider, previous.Reference, previous.PaidAt
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		// Historical orders may need the provider's actual payment reference for
		// later refunds. Existing ledger references remain immutable.
		if payment.Reference == "" {
			if len(input.TradeNo) > 128 {
				return policy.ErrPaymentReferenceRequired
			}
			payment.Reference = input.TradeNo
		}
		if provider == "" || provider == model.PaymentProviderBalance || payment.PaidAt <= 0 {
			return policy.ErrPaymentInvalid
		}
		return policy.ReconcilePayment(tx, input.UserID, input.TradeNo, provider, input.Source, payment, c.GetInt("id"), input.Reason)
	})
	respond(c, nil, err)
}

func refund(c *gin.Context) {
	var input struct {
		TradeNo string `json:"trade_no"`
		Amount  string `json:"amount"`
		Reason  string `json:"reason"`
	}
	if common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 4096), &input) != nil {
		respond(c, nil, policy.ErrInvalid)
		return
	}
	err := model.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if err := policy.RefundPayment(tx, input.TradeNo, input.Amount, input.Reason, c.GetInt("id")); err != nil {
			return err
		}
		var payment policy.PaymentRecord
		if err := tx.Where("trade_no = ?", input.TradeNo).Take(&payment).Error; err != nil {
			return err
		}
		return model.RecordPaymentRefund(tx, payment.Provider, payment.Reference, input.Amount, payment.Currency)
	})
	respond(c, nil, err)
}
