package policy

import (
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrInvalid      = common.NewMessage("Invalid lucky draw parameters")
	ErrConflict     = common.NewMessage("Lucky draw settings changed. Reload before continuing.")
	ErrDisabled     = common.NewMessage("Lucky draw is not enabled")
	ErrUnavailable  = common.NewMessage("Lucky draw is temporarily unavailable")
	ErrAccount      = common.NewMessage("Lucky draw is unavailable for this account")
	ErrPaused       = common.NewMessage("Lucky draw is paused for this account")
	ErrRisk         = common.NewMessage("Lucky draw is unavailable while the account is under review")
	ErrPayment      = common.NewMessage("Lucky draw recharge requirement has not been met")
	ErrExpired      = common.NewMessage("Lucky draw qualification has expired")
	ErrSchedule     = common.NewMessage("Lucky draw is outside the activity period")
	ErrGroup        = common.NewMessage("Your group cannot participate in this lucky draw")
	ErrAttempts     = common.NewMessage("No lucky draw attempts remain today")
	ErrStock        = common.NewMessage("Lucky draw is paused because a prize is out of stock")
	ErrBudget       = common.NewMessage("Lucky draw is paused because its budget cannot cover every prize")
	ErrCap          = common.NewMessage("Your lucky draw reward limit cannot cover every prize")
	ErrWallet       = common.NewMessage("Wallet quota limit exceeded")
	ErrVerify       = common.NewMessage("Complete human verification before drawing")
	ErrVerifyConfig = common.NewMessage("Lucky draw human verification is not configured")
)

// Lowercase identifiers keep uniqueness identical on case-insensitive MySQL
// collations and case-sensitive PostgreSQL/SQLite indexes.
var identifier = regexp.MustCompile(`^[a-z0-9_-]{1,40}$`)
var colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
var amountPattern = regexp.MustCompile(`^(0|[1-9][0-9]{0,12})(\.[0-9]{1,6})?$`)
var requestPattern = regexp.MustCompile(`^[a-z0-9_-]{16,64}$`)

func IsPolicyError(err error) bool {
	for _, known := range []error{ErrInvalid, ErrConflict, ErrDisabled, ErrUnavailable, ErrAccount, ErrPaused, ErrRisk, ErrPayment, ErrExpired, ErrSchedule, ErrGroup, ErrAttempts, ErrStock, ErrBudget, ErrCap, ErrWallet, ErrVerify, ErrVerifyConfig} {
		if errors.Is(err, known) {
			return true
		}
	}
	return false
}

func DefaultSettings() (Settings, error) {
	settings := Settings{ID: 1, Version: 1, ThresholdAmount: "100", Currency: "CNY", RechargeMode: "lifetime", LookbackDays: 30, RenewOnRecharge: true, DailyAttempts: 1, Timezone: "Asia/Shanghai", FollowRegistrationRisk: true}
	for i, item := range []struct {
		amount string
		weight int
		color  string
	}{
		{"0", 500000, "#64748b"}, {"0.01", 300000, "#0d9488"}, {"0.05", 150000, "#2563eb"}, {"0.1", 40000, "#7c3aed"}, {"1", 9000, "#d97706"}, {"10", 1000, "#e11d48"},
	} {
		amount := decimal.RequireFromString(item.amount)
		quota, err := common.WalletQuotaFromDecimalStrict(amount.Mul(decimal.NewFromFloat(common.QuotaPerUnit)))
		if err != nil {
			return settings, err
		}
		prize := Prize{ID: string(rune('a' + i)), Name: "$" + item.amount, Kind: "credit", Quota: quota, Weight: item.weight, Color: item.color}
		if quota == 0 {
			prize.Kind, prize.Name = "none", "Better luck next time"
		}
		settings.Prizes = append(settings.Prizes, prize)
	}
	return settings, nil
}

func ValidateSettings(s Settings) error {
	threshold, err := decimal.NewFromString(s.ThresholdAmount)
	if !amountPattern.MatchString(s.ThresholdAmount) || err != nil || threshold.GreaterThan(decimal.NewFromInt(1000000000000)) || s.Version < 1 || s.Version >= 2147483647 || (s.Currency != "CNY" && s.Currency != "USD") || (s.RechargeMode != "lifetime" && s.RechargeMode != "rolling") || s.LookbackDays < 1 || s.LookbackDays > 3650 || s.EligibilityDays < 0 || s.EligibilityDays > 3650 || s.DailyAttempts < 1 || s.DailyAttempts > 100 || s.StartsAt < 0 || s.EndsAt < 0 || s.StartsAt > 253402214400 || s.EndsAt > 253402214400 || (s.EndsAt > 0 && s.EndsAt <= s.StartsAt) || len(s.AllowedGroups) > 2000 || len(s.Timezone) > 64 || s.Timezone == "" || s.Timezone == "Local" || strings.TrimSpace(s.Timezone) != s.Timezone {
		return ErrInvalid
	}
	if _, err := time.LoadLocation(s.Timezone); err != nil {
		return ErrInvalid
	}
	if s.AllowedGroups != "" {
		for group := range strings.SplitSeq(s.AllowedGroups, ",") {
			if strings.TrimSpace(group) != group || group == "" || utf8.RuneCountInString(group) > 64 {
				return ErrInvalid
			}
		}
	}
	for _, limit := range []int{s.DailyBudgetQuota, s.TotalBudgetQuota, s.UserCapQuota} {
		if limit < 0 || limit > common.MaxWalletQuota {
			return ErrInvalid
		}
	}
	if len(s.Prizes) < 6 || len(s.Prizes) > 8 {
		return ErrInvalid
	}
	ids, total, paid := map[string]bool{}, 0, false
	for _, p := range s.Prizes {
		if !identifier.MatchString(p.ID) || ids[p.ID] || strings.TrimSpace(p.Name) == "" || utf8.RuneCountInString(p.Name) > 100 || !colorPattern.MatchString(p.Color) || p.Weight < 0 || p.Weight > ProbabilityTotal || p.Stock < 0 || p.Stock > 1000000000 || p.Quota < 0 || p.Quota > common.MaxWalletQuota {
			return ErrInvalid
		}
		if (p.Kind == "none" && (p.Quota != 0 || p.Stock != 0)) || (p.Kind == "credit" && p.Quota < 1) || (p.Kind != "none" && p.Kind != "credit") {
			return ErrInvalid
		}
		ids[p.ID], total = true, total+p.Weight
		paid = paid || (p.Kind == "credit" && p.Weight > 0)
	}
	if total != ProbabilityTotal || !paid {
		return ErrInvalid
	}
	return nil
}

func Migrate(db *gorm.DB) error {
	if err := db.AutoMigrate(&Settings{}, &Account{}, &Pool{}, &Stock{}, &Record{}, &Audit{}); err != nil {
		return err
	}
	s, err := DefaultSettings()
	if err != nil {
		return err
	}
	encoded, err := common.Marshal(s.Prizes)
	if err != nil {
		return err
	}
	s.PrizeJSON = string(encoded)
	if err := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&s).Error; err != nil {
		return err
	}
	return db.Clauses(clause.OnConflict{DoNothing: true}).Create(&Pool{ID: 1}).Error
}

func GetSettings(db *gorm.DB) (Settings, error) {
	var s Settings
	if err := db.First(&s, 1).Error; err != nil {
		return s, err
	}
	if err := common.UnmarshalJsonStr(s.PrizeJSON, &s.Prizes); err != nil {
		return s, err
	}
	return s, ValidateSettings(s)
}

// Callers that inspect payment facts first acquire check-in's payment lock.
// All lottery writes then lock this singleton before accounts, risk and wallet.
func lockSettings(tx *gorm.DB) (Settings, error) {
	if tx.Dialector.Name() == "sqlite" {
		if err := tx.Model(&Settings{}).Where("id = ?", 1).UpdateColumn("version", gorm.Expr("version")).Error; err != nil {
			return Settings{}, err
		}
		return GetSettings(tx)
	}
	return GetSettings(tx.Clauses(clause.Locking{Strength: "UPDATE"}))
}

func UpdateSettings(db *gorm.DB, s Settings, actor int) (Settings, error) {
	if actor < 1 || ValidateSettings(s) != nil {
		return s, ErrInvalid
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		previous, err := lockSettings(tx)
		if err != nil {
			return err
		}
		if previous.Version != s.Version {
			return ErrConflict
		}
		s.ID, s.Version = 1, s.Version+1
		encoded, err := common.Marshal(s.Prizes)
		if err != nil {
			return err
		}
		s.PrizeJSON = string(encoded)
		if err := tx.Save(&s).Error; err != nil {
			return err
		}
		detail, err := common.Marshal(map[string]any{"previous": previous, "current": s})
		if err != nil {
			return err
		}
		return tx.Create(&Audit{ActorID: actor, Action: "settings", Detail: string(detail), CreatedAt: time.Now().Unix()}).Error
	})
	return s, err
}
