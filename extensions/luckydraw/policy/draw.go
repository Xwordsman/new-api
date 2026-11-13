package policy

import (
	"crypto/rand"
	"errors"
	"math/big"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	payments "github.com/QuantumNous/new-api/extensions/checkin/policy"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func ResultFor(db *gorm.DB, userID int, key string) (*Result, error) {
	if userID < 1 || !requestPattern.MatchString(key) {
		return nil, ErrInvalid
	}
	var record Record
	if err := db.Where("user_id = ? AND request_key = ?", userID, key).Take(&record).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	var snapshot Settings
	if err := common.UnmarshalJsonStr(record.Snapshot, &snapshot); err != nil {
		return nil, err
	}
	return &Result{Record: record, Prizes: snapshot.Prizes, Replay: true}, nil
}

func readState(tx *gorm.DB, userID int, settings Settings, now time.Time) (Account, Pool, error) {
	account := Account{UserID: userID, State: "active"}
	var pool Pool
	if err := tx.Where("user_id = ?", userID).Take(&account).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return account, pool, err
	}
	if err := tx.First(&pool, 1).Error; err != nil {
		return account, pool, err
	}
	if account.State != "active" && account.State != "paused" {
		return account, pool, ErrUnavailable
	}
	location, err := time.LoadLocation(settings.Timezone)
	if err != nil {
		return account, pool, err
	}
	local := now.In(location)
	next := time.Date(local.Year(), local.Month(), local.Day()+1, 0, 0, 0, 0, location).Unix()
	if now.Unix() >= account.NextResetAt {
		account.Attempts, account.NextResetAt = 0, next
	}
	if now.Unix() >= pool.NextResetAt {
		pool.DailyQuota, pool.NextResetAt = 0, next
	}
	return account, pool, nil
}

func eligibility(tx *gorm.DB, userID int, s Settings, now time.Time, a Account, lock bool) (payments.QualificationSummary, HostUser, error) {
	var user HostUser
	summary, err := payments.PaymentSummary(tx, userID, payments.Settings{ThresholdAmount: s.ThresholdAmount, Currency: s.Currency, RechargeMode: s.RechargeMode, LookbackDays: s.LookbackDays, IncludeSubscriptions: s.IncludeSubscriptions, EligibilityDays: s.EligibilityDays, RenewOnRecharge: s.RenewOnRecharge, Timezone: s.Timezone}, now)
	if err != nil {
		return summary, user, err
	}
	if !s.Enabled {
		return summary, user, ErrDisabled
	}
	if now.Unix() < s.StartsAt || (s.EndsAt > 0 && now.Unix() >= s.EndsAt) {
		return summary, user, ErrSchedule
	}
	if !summary.Eligible {
		if summary.ExpiresAt > 0 && now.Unix() >= summary.ExpiresAt {
			return summary, user, ErrExpired
		}
		return summary, user, ErrPayment
	}
	if a.State == "paused" {
		return summary, user, ErrPaused
	}
	query := tx
	if lock && tx.Dialector.Name() != "sqlite" {
		// Keep this scope reusable: the risk and wallet reads target different
		// tables and must not inherit each other's model or WHERE clauses.
		query = query.Clauses(clause.Locking{Strength: "UPDATE"}).Session(&gorm.Session{})
	}
	if s.FollowRegistrationRisk {
		var risk payments.RegistrationAccount
		err := query.Where("user_id = ?", userID).Take(&risk).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return summary, user, err
		}
		if err == nil && risk.State != "active" {
			return summary, user, ErrRisk
		}
	}
	if err := query.Where("id = ?", userID).Take(&user).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return summary, user, ErrAccount
	} else if err != nil {
		return summary, user, err
	}
	if user.Status != common.UserStatusEnabled {
		return summary, user, ErrAccount
	}
	if s.AllowedGroups != "" && !slices.Contains(strings.Split(s.AllowedGroups, ","), user.Group) {
		return summary, user, ErrGroup
	}
	return summary, user, nil
}

// Every live prize must be payable before selecting a random number. Exhaustion
// pauses the unchanged distribution rather than changing a winner or rerolling.
func preflight(tx *gorm.DB, s Settings, a Account, pool Pool, user HostUser) error {
	if a.Attempts >= s.DailyAttempts {
		return ErrAttempts
	}
	for _, prize := range s.Prizes {
		if prize.Weight == 0 {
			continue
		}
		if prize.Stock > 0 {
			var stock Stock
			err := tx.Where("prize_id = ?", prize.ID).Take(&stock).Error
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if stock.Awarded >= prize.Stock {
				return ErrStock
			}
		}
		if pool.TotalQuota > common.MaxWalletQuota-prize.Quota || (s.TotalBudgetQuota > 0 && pool.TotalQuota > s.TotalBudgetQuota-prize.Quota) || (s.DailyBudgetQuota > 0 && pool.DailyQuota > s.DailyBudgetQuota-prize.Quota) {
			return ErrBudget
		}
		if a.TotalQuota > common.MaxWalletQuota-prize.Quota || (s.UserCapQuota > 0 && a.TotalQuota > s.UserCapQuota-prize.Quota) {
			return ErrCap
		}
		if user.Quota > common.MaxWalletQuota-prize.Quota {
			return ErrWallet
		}
	}
	return nil
}

func Dashboard(db *gorm.DB, userID int, now time.Time) (DashboardData, error) {
	var data DashboardData
	if userID <= 0 || now.Unix() < 0 {
		return data, ErrInvalid
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		s, err := GetSettings(tx)
		if err != nil {
			return err
		}
		a, pool, err := readState(tx, userID, s, now)
		if err != nil {
			return err
		}
		summary, user, eligibilityErr := eligibility(tx, userID, s, now, a, false)
		data.Rules, data.Account = s, a
		data.QualifiedAmount, data.ExpiresAt = summary.QualifiedAmount.String(), summary.ExpiresAt
		threshold, _ := decimal.NewFromString(s.ThresholdAmount)
		data.RemainingAmount = decimal.Max(decimal.Zero, threshold.Sub(summary.QualifiedAmount)).String()
		data.RemainingAttempts = max(0, s.DailyAttempts-a.Attempts)
		data.VerificationRequired = s.RequireTurnstile || common.TurnstileCheckEnabled
		if eligibilityErr == nil {
			eligibilityErr = preflight(tx, s, a, pool, user)
		}
		if eligibilityErr == nil && data.VerificationRequired && (!common.TurnstileCheckEnabled || common.TurnstileSiteKey == "" || common.TurnstileSecretKey == "") {
			eligibilityErr = ErrVerifyConfig
		}
		if eligibilityErr != nil {
			if !IsPolicyError(eligibilityErr) {
				return eligibilityErr
			}
			var message *common.Message
			if errors.As(eligibilityErr, &message) {
				data.Reason = message.Key
			}
		}
		data.Drawable = data.Reason == ""
		return nil
	})
	return data, err
}

func Draw(db *gorm.DB, userID int, key string, version int, now time.Time, verified bool) (*Result, error) {
	if userID <= 0 || !requestPattern.MatchString(key) || now.Unix() < 0 {
		return nil, ErrInvalid
	}
	var result *Result
	err := db.Transaction(func(tx *gorm.DB) error {
		// Payment/refund transactions acquire this same lock. Always acquire it
		// before the lottery singleton; no lottery path locks a payment order.
		if _, err := payments.LockSettings(tx); err != nil {
			return err
		}
		s, err := lockSettings(tx)
		if err != nil {
			return err
		}
		result, err = ResultFor(tx, userID, key)
		if err != nil || result != nil {
			return err
		}
		if s.Version != version {
			return ErrConflict
		}
		if s.RequireTurnstile || common.TurnstileCheckEnabled {
			if !common.TurnstileCheckEnabled || common.TurnstileSiteKey == "" || common.TurnstileSecretKey == "" {
				return ErrVerifyConfig
			}
			if !verified {
				return ErrVerify
			}
		}
		a, pool, err := readState(tx, userID, s, now)
		if err != nil {
			return err
		}
		_, user, err := eligibility(tx, userID, s, now, a, true)
		if err != nil {
			return err
		}
		if err := preflight(tx, s, a, pool, user); err != nil {
			return err
		}
		number, err := rand.Int(rand.Reader, big.NewInt(ProbabilityTotal))
		if err != nil {
			return err
		}
		prize, err := SelectPrize(s.Prizes, int(number.Int64()))
		if err != nil {
			return err
		}
		snapshot, err := common.Marshal(s)
		if err != nil {
			return err
		}
		record := Record{UserID: userID, RequestKey: key, PrizeID: prize.ID, PrizeName: prize.Name, QuotaAwarded: prize.Quota, CreatedAt: now.Unix(), SettingsVersion: s.Version, Snapshot: string(snapshot)}
		if err := tx.Create(&record).Error; err != nil {
			return err
		}
		if prize.Quota > 0 {
			credit := tx.Model(&HostUser{}).Where("id = ? AND status = ? AND quota <= ?", userID, common.UserStatusEnabled, common.MaxWalletQuota-prize.Quota).UpdateColumn("quota", gorm.Expr("quota + ?", prize.Quota))
			if credit.Error != nil {
				return credit.Error
			}
			if credit.RowsAffected != 1 {
				return ErrWallet
			}
		}
		stock := Stock{PrizeID: prize.ID}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&stock).Error; err != nil {
			return err
		}
		if err := tx.Model(&stock).UpdateColumn("awarded", gorm.Expr("awarded + 1")).Error; err != nil {
			return err
		}
		a.Attempts++
		a.TotalDraws++
		a.TotalQuota += prize.Quota
		pool.DailyQuota += prize.Quota
		pool.TotalQuota += prize.Quota
		pool.TotalDraws++
		if err := tx.Save(&a).Error; err != nil {
			return err
		}
		if err := tx.Save(&pool).Error; err != nil {
			return err
		}
		result = &Result{Record: record, Prizes: s.Prizes}
		return nil
	})
	return result, err
}

// SelectPrize maps the cryptographic draw to the exact published integer weights.
func SelectPrize(prizes []Prize, number int) (Prize, error) {
	if number < 0 || number >= ProbabilityTotal {
		return Prize{}, ErrInvalid
	}
	for _, prize := range prizes {
		if number < prize.Weight {
			return prize, nil
		}
		number -= prize.Weight
	}
	return Prize{}, ErrInvalid
}

func UpdateAccount(db *gorm.DB, userID, actor int, state, reason string) (Account, error) {
	var account Account
	reason = strings.TrimSpace(reason)
	if userID < 1 || actor < 1 || (state != "active" && state != "paused") || len([]rune(reason)) < 3 || len([]rune(reason)) > 500 {
		return account, ErrInvalid
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		if _, err := lockSettings(tx); err != nil {
			return err
		}
		account = Account{UserID: userID, State: "active"}
		if err := tx.Where("user_id = ?", userID).Take(&account).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var user HostUser
		if err := tx.Where("id = ?", userID).Take(&user).Error; errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrAccount
		} else if err != nil {
			return err
		}
		account.State, account.Reason, account.UpdatedBy, account.UpdatedAt = state, reason, actor, time.Now().Unix()
		if err := tx.Save(&account).Error; err != nil {
			return err
		}
		detail, err := common.Marshal(account)
		if err != nil {
			return err
		}
		return tx.Create(&Audit{ActorID: actor, UserID: userID, Action: "account_" + state, Detail: string(detail), CreatedAt: time.Now().Unix()}).Error
	})
	return account, err
}
