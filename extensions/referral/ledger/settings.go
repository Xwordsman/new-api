package ledger

import (
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrInvalid     = common.NewMessage("Invalid referral parameters")
	ErrUnavailable = common.NewMessage("Referral reward is not available")
	ErrReview      = common.NewMessage("Referral qualification requires review")
)

func Lock(tx *gorm.DB) *gorm.DB {
	if tx.Dialector.Name() == "sqlite" {
		return tx
	}
	return tx.Clauses(clause.Locking{Strength: "UPDATE"})
}

func Migrate(db *gorm.DB) error {
	upgradePolicy := db.Migrator().HasTable(&Settings{}) && !db.Migrator().HasColumn(&Settings{}, "SignupCoolingHours")
	upgradeDue := db.Migrator().HasTable(&Binding{}) && !db.Migrator().HasColumn(&Binding{}, "SignupBonusAvailableAt")
	if err := db.AutoMigrate(&Settings{}, &Account{}, &Binding{}, &Signal{}, &PaymentIdentity{}, &Reward{}, &Transfer{}, &Audit{}, &RefundNotice{}); err != nil {
		return err
	}
	if upgradePolicy {
		if err := db.Model(&Settings{}).Where("id = ?", 1).Updates(map[string]any{"signup_cooling_hours": 24, "review_shared_browser": true, "invite_burst_limit": 5, "invite_burst_minutes": 60}).Error; err != nil {
			return err
		}
	}
	if upgradeDue {
		if err := db.Model(&Binding{}).Where("signup_bonus_quota > 0 AND signup_bonus_paid_at = 0 AND (signup_bonus_available_at = 0 OR signup_bonus_available_at IS NULL)").Update("signup_bonus_available_at", gorm.Expr("registered_at + ?", 86400)).Error; err != nil {
			return err
		}
	}
	capQuota, err := common.WalletQuotaFromDecimalStrict(decimal.NewFromInt(100).Mul(decimal.NewFromFloat(common.QuotaPerUnit)))
	if err != nil {
		return err
	}
	settings := Settings{ID: 1, Enabled: true, SignupCoolingHours: 24, ReviewSharedBrowser: true, InviteBurstLimit: 5, InviteBurstMinutes: 60, RateBPS: 500, WindowDays: 30, CoolingHours: 24, CapQuota: capQuota, CNYPerUSD: "1", Version: 1, StartedAt: time.Now().Unix(), RiskSalt: common.GetRandomString(64)}
	return db.Clauses(clause.OnConflict{DoNothing: true}).Create(&settings).Error
}

func GetSettings(db *gorm.DB) (Settings, error) {
	var settings Settings
	err := db.First(&settings, 1).Error
	return settings, err
}

func UpdateSettings(db *gorm.DB, value Settings, actor int) error {
	rate, err := decimal.NewFromString(value.CNYPerUSD)
	if err != nil || rate.LessThan(decimal.NewFromFloat(0.01)) || rate.GreaterThan(decimal.NewFromInt(10000)) || value.RateBPS < 0 || value.RateBPS > 10000 || value.WindowDays < 1 || value.WindowDays > 3650 || value.CoolingHours < 0 || value.CoolingHours > 8760 || value.CapQuota < 1 || value.CapQuota > common.MaxWalletQuota/100 {
		return ErrInvalid
	}
	if value.SignupBonusQuota < 0 || value.SignupBonusQuota > common.MaxWalletQuota/100 || value.SignupBonusEnabled && value.SignupBonusQuota == 0 {
		return ErrInvalid
	}
	if value.SignupCoolingHours < 0 || value.SignupCoolingHours > 8760 || value.InviteBurstLimit != 0 && (value.InviteBurstLimit < 2 || value.InviteBurstLimit > 100000) || value.InviteBurstMinutes < 1 || value.InviteBurstMinutes > 10080 {
		return ErrInvalid
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var old Settings
		if err := Lock(tx).First(&old, 1).Error; err != nil {
			return err
		}
		if value.Version != old.Version {
			return ErrInvalid
		}
		value.ID, value.Version, value.StartedAt, value.RiskSalt = 1, old.Version+1, old.StartedAt, old.RiskSalt
		if err := tx.Save(&value).Error; err != nil {
			return err
		}
		detail, err := common.Marshal(value)
		if err != nil {
			return err
		}
		return tx.Create(&Audit{ActorID: actor, Action: "settings", Detail: string(detail), CreatedAt: time.Now().Unix()}).Error
	})
}

func lockAccount(tx *gorm.DB, userID int) (Account, error) {
	account := Account{UserID: userID}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
		return account, err
	}
	err := Lock(tx).First(&account, "user_id = ?", userID).Error
	return account, err
}

func activeUsers(tx *gorm.DB, inviter, invitee int) error {
	var count int64
	if err := tx.Model(&HostUser{}).Where("id IN ? AND status = ?", []int{inviter, invitee}, common.UserStatusEnabled).Count(&count).Error; err != nil {
		return err
	}
	if inviter == invitee || count != 2 {
		return ErrUnavailable
	}
	return nil
}

func checkedAdd(a, b int) (int, error) {
	if a < 0 || b < 0 || a > common.MaxWalletQuota-b {
		return 0, ErrInvalid
	}
	return a + b, nil
}

func isMissing(err error) bool { return errors.Is(err, gorm.ErrRecordNotFound) }
