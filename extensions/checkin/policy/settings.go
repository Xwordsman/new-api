package policy

import (
	"errors"
	"strings"
	"time"
	_ "time/tzdata"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrInvalid                  = common.NewMessage("Invalid check-in parameters")
	ErrConflict                 = common.NewMessage("Check-in settings changed. Reload before saving.")
	ErrDisabled                 = common.NewMessage("Check-in feature is not enabled")
	ErrAlreadyChecked           = common.NewMessage("Already checked in today")
	ErrInactive                 = common.NewMessage("This account cannot receive check-in rewards")
	ErrPaused                   = common.NewMessage("Check-in rewards are paused for this account")
	ErrRechargeRequired         = common.NewMessage("Recharge requirement has not been met")
	ErrEligibilityExpired       = common.NewMessage("Check-in qualification has expired")
	ErrRiskReview               = common.NewMessage("Check-in rewards are unavailable while the account is under review")
	ErrMonthlyCap               = common.NewMessage("Monthly check-in reward limit reached")
	ErrLifetimeCap              = common.NewMessage("Lifetime check-in reward limit reached")
	ErrDailyBudget              = common.NewMessage("Today's check-in reward budget is exhausted")
	ErrWalletLimit              = common.NewMessage("Wallet quota limit exceeded")
	ErrVerificationRequired     = common.NewMessage("Complete human verification before checking in")
	ErrVerificationUnavailable  = common.NewMessage("Check-in human verification is not configured")
	ErrPaymentReferenceRequired = common.NewMessage("Provide a payment reference for order numbers longer than 128 bytes")
	ErrUnavailable              = common.NewMessage("Check-in is temporarily unavailable")
)

func IsPolicyError(err error) bool {
	for _, known := range []error{
		ErrInvalid, ErrConflict, ErrDisabled, ErrAlreadyChecked, ErrInactive,
		ErrPaused, ErrRechargeRequired, ErrEligibilityExpired, ErrRiskReview,
		ErrMonthlyCap, ErrLifetimeCap, ErrDailyBudget, ErrWalletLimit,
		ErrVerificationRequired, ErrVerificationUnavailable, ErrUnavailable,
		ErrPaymentInvalid, ErrPaymentConflict, ErrPaymentNotFound, ErrPaymentReferenceRequired,
	} {
		if errors.Is(err, known) {
			return true
		}
	}
	return false
}

func DefaultSettings() (Settings, error) {
	reward, err := common.WalletQuotaFromDecimalStrict(decimal.RequireFromString("0.01").Mul(decimal.NewFromFloat(common.QuotaPerUnit)))
	if err != nil || reward <= 0 {
		return Settings{}, ErrInvalid
	}
	return Settings{
		ID: 1, Version: 1, ThresholdAmount: "50", Currency: "CNY", CNYPerUSD: "7.2",
		RechargeMode: "lifetime", LookbackDays: 30, RenewOnRecharge: true,
		RewardMode: "fixed", RewardMinQuota: reward, RewardMaxQuota: reward,
		Timezone: "Asia/Shanghai", FollowRegistrationRisk: true,
	}, nil
}

func Migrate(db *gorm.DB) error {
	models := []any{&Settings{}, &Account{}, &Audit{}}
	models = append(models, PaymentModels()...)
	if err := db.AutoMigrate(models...); err != nil {
		return err
	}
	settings, err := DefaultSettings()
	if err != nil {
		return err
	}
	return db.Clauses(clause.OnConflict{DoNothing: true}).Create(&settings).Error
}

func ValidateSettings(settings Settings) error {
	threshold, err := paymentDecimal(settings.ThresholdAmount, true)
	if err != nil || threshold.IsNegative() {
		return ErrInvalid
	}
	rate, err := paymentDecimal(settings.CNYPerUSD, false)
	if err != nil || rate.LessThan(decimal.RequireFromString("0.01")) || rate.GreaterThan(decimal.NewFromInt(10000)) {
		return ErrInvalid
	}
	if settings.Version < 1 || settings.Version >= common.MaxWalletQuota ||
		(settings.Currency != "CNY" && settings.Currency != "USD") ||
		(settings.RechargeMode != "lifetime" && settings.RechargeMode != "rolling") ||
		settings.LookbackDays < 1 || settings.LookbackDays > 3650 ||
		settings.EligibilityDays < 0 || settings.EligibilityDays > 3650 ||
		(settings.RewardMode != "fixed" && settings.RewardMode != "random") ||
		settings.RewardMinQuota < 1 || settings.RewardMaxQuota < settings.RewardMinQuota || settings.RewardMaxQuota > common.MaxWalletQuota ||
		(settings.RewardMode == "fixed" && settings.RewardMinQuota != settings.RewardMaxQuota) ||
		settings.MonthlyCapQuota < 0 || settings.MonthlyCapQuota > common.MaxWalletQuota ||
		settings.LifetimeCapQuota < 0 || settings.LifetimeCapQuota > common.MaxWalletQuota ||
		settings.DailyBudgetQuota < 0 || settings.DailyBudgetQuota > common.MaxWalletQuota ||
		settings.Timezone == "" || settings.Timezone == "Local" || len(settings.Timezone) > 64 || strings.TrimSpace(settings.Timezone) != settings.Timezone {
		return ErrInvalid
	}
	if _, err := time.LoadLocation(settings.Timezone); err != nil {
		return ErrInvalid
	}
	return nil
}

func GetSettings(db *gorm.DB) (Settings, error) {
	var settings Settings
	if err := db.First(&settings, 1).Error; err != nil {
		return settings, err
	}
	return settings, ValidateSettings(settings)
}

// LockSettings is the first lock of every check-in write transaction. A no-op
// write obtains SQLite's writer lock before any reads; the other dialects lock
// the singleton row. Qualification and awards therefore share one ordering.
func LockSettings(tx *gorm.DB) (Settings, error) {
	if tx.Dialector.Name() == "sqlite" {
		result := tx.Model(&Settings{}).Where("id = ?", 1).UpdateColumn("version", gorm.Expr("version"))
		if result.Error != nil {
			return Settings{}, result.Error
		}
		if result.RowsAffected != 1 {
			return Settings{}, gorm.ErrRecordNotFound
		}
		return GetSettings(tx)
	}
	return GetSettings(tx.Clauses(clause.Locking{Strength: "UPDATE"}))
}

func UpdateSettings(db *gorm.DB, value Settings, actorID int) (Settings, error) {
	if actorID <= 0 || ValidateSettings(value) != nil {
		return Settings{}, ErrInvalid
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		previous, err := LockSettings(tx)
		if err != nil {
			return err
		}
		if previous.Version != value.Version {
			return ErrConflict
		}
		threshold, _ := paymentDecimal(value.ThresholdAmount, true)
		rate, _ := paymentDecimal(value.CNYPerUSD, false)
		value.ID, value.Version = 1, previous.Version+1
		value.ThresholdAmount, value.CNYPerUSD = threshold.String(), rate.String()
		if err := tx.Save(&value).Error; err != nil {
			return err
		}
		detail, err := common.Marshal(map[string]any{"previous": previous, "current": value})
		if err != nil {
			return err
		}
		return tx.Create(&Audit{ActorID: actorID, Action: "settings", Detail: string(detail), CreatedAt: time.Now().Unix(), SettingsVersion: value.Version}).Error
	})
	return value, err
}
