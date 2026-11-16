package ledger

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type signupContextKey struct{}
type signupSignals struct{ Network, Client string }

func WithSignupContext(tx *gorm.DB, ip, agent string) *gorm.DB {
	return tx.WithContext(context.WithValue(tx.Statement.Context, signupContextKey{}, signupSignals{Network: ip, Client: agent}))
}

func digest(salt, value string) string {
	if value == "" {
		return ""
	}
	mac := hmac.New(sha256.New, []byte(salt))
	_, _ = mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil))
}

func Observe(tx *gorm.DB, userID int, ip, agent string) error {
	settings, err := GetSettings(tx)
	if err != nil {
		return err
	}
	if ip == "" {
		return nil
	}
	signal := Signal{UserID: userID, Network: digest(settings.RiskSalt, ip), Client: digest(settings.RiskSalt, ip+"|"+agent)}
	// Keep the original registration signal; changing a browser cannot erase it.
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&signal).Error
}

func Register(tx *gorm.DB, userID, inviterID int, registeredAt int64) error {
	return registerInvitation(tx, userID, inviterID, registeredAt, true)
}

func registerInvitation(tx *gorm.DB, userID, inviterID int, registeredAt int64, signup bool) error {
	settings, err := GetSettings(tx)
	// Model tests and installations before extension initialization have no tables.
	// Production migrations run before accepting registrations.
	if err != nil {
		return err
	}
	if signals, ok := tx.Statement.Context.Value(signupContextKey{}).(signupSignals); ok {
		if err := Observe(tx, userID, signals.Network, signals.Client); err != nil {
			return err
		}
	}
	if inviterID <= 0 || inviterID == userID {
		return nil
	}
	if registeredAt <= 0 {
		registeredAt = time.Now().Unix()
	}
	state, reason := "active", ""
	historical := registeredAt < settings.StartedAt
	if historical {
		state, reason = "historical", "Historical invitation requires approval"
	}
	if !settings.Enabled {
		state, reason = "ineligible", "Referral program was paused at registration"
	}
	binding := Binding{UserID: userID, InviterID: inviterID, RegisteredAt: registeredAt, ExpiresAt: registeredAt + int64(settings.WindowDays)*86400, RateBPS: settings.RateBPS, CapQuota: settings.CapQuota, CoolingHours: settings.CoolingHours, SettingsVersion: settings.Version, State: state, Reason: reason, Historical: historical}
	if signup && settings.Enabled && settings.SignupBonusEnabled && !historical {
		binding.SignupBonusQuota = settings.SignupBonusQuota
	}
	result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&binding)
	if result.Error != nil || result.RowsAffected == 0 {
		return result.Error
	}
	return checkQualification(tx, &binding)
}

// ImportHistory exposes existing invitations without awarding old payments.
func ImportHistory(tx *gorm.DB, inviterID int) error {
	var users []HostUser
	query := tx.Where("inviter_id > 0 AND NOT EXISTS (SELECT 1 FROM extension_referral_bindings b WHERE b.user_id = users.id)")
	if inviterID > 0 {
		query = query.Where("inviter_id = ?", inviterID)
	}
	return query.FindInBatches(&users, 200, func(batch *gorm.DB, _ int) error {
		for _, user := range users {
			var count int64
			if err := batch.Model(&Binding{}).Where("user_id = ?", user.ID).Count(&count).Error; err != nil {
				return err
			}
			if count == 0 {
				registeredAt := user.CreatedAt
				if registeredAt <= 0 {
					registeredAt = 1
				}
				if err := registerInvitation(batch, user.ID, user.InviterID, registeredAt, false); err != nil {
					return err
				}
			}
		}
		return nil
	}).Error
}

// CompleteSignup runs after registration risk checks, inside the signup or
// review transaction. The binding is the one-time gift ledger; payment rewards
// and their cap/window/cooling rules are deliberately independent.
func CompleteSignup(tx *gorm.DB, userID int) error {
	var binding Binding
	if err := tx.First(&binding, "user_id = ?", userID).Error; err != nil {
		if isMissing(err) {
			return nil
		}
		return err
	}
	if binding.SignupBonusQuota <= 0 || binding.SignupBonusPaidAt > 0 || binding.State != "active" || binding.Historical {
		return nil
	}
	settings, err := GetSettings(tx)
	if err != nil {
		return err
	}
	if !settings.Enabled {
		return nil
	}
	account, err := lockAccount(tx, binding.InviterID)
	if err != nil {
		return err
	}
	if err := Lock(tx).First(&binding, binding.ID).Error; err != nil {
		return err
	}
	if binding.SignupBonusPaidAt > 0 || binding.State != "active" || binding.Historical {
		return nil
	}
	if err := activeUsers(tx, binding.InviterID, binding.UserID); err != nil {
		if err != ErrUnavailable {
			return err
		}
		return tx.Model(&binding).Updates(map[string]any{"state": "review", "reason": "Account eligibility requires review", "reviewed_at": 0}).Error
	}
	offset := min(binding.SignupBonusQuota, account.Debt)
	balance, balanceErr := checkedAdd(account.Balance, binding.SignupBonusQuota-offset)
	earned, earnedErr := checkedAdd(account.Earned, binding.SignupBonusQuota)
	if balanceErr != nil || earnedErr != nil {
		// A full inviter account must not prevent a new user from registering.
		return tx.Model(&binding).Updates(map[string]any{"state": "review", "reason": "Referral reward balance requires review", "reviewed_at": 0}).Error
	}
	account.Balance, account.Earned, account.Debt = balance, earned, account.Debt-offset
	if err := tx.Save(&account).Error; err != nil {
		return err
	}
	binding.SignupBonusPaidAt = time.Now().Unix()
	if err := tx.Model(&binding).Update("signup_bonus_paid_at", binding.SignupBonusPaidAt).Error; err != nil {
		return err
	}
	return tx.Create(&Audit{UserID: binding.UserID, Action: "signup_bonus", Detail: common.GetJsonString(map[string]any{"inviter_id": binding.InviterID, "quota": binding.SignupBonusQuota, "offset": offset, "settings_version": binding.SettingsVersion}), CreatedAt: binding.SignupBonusPaidAt}).Error
}

func checkQualification(tx *gorm.DB, binding *Binding) error {
	if binding.State == "ineligible" || binding.State == "historical" {
		return nil
	}
	if err := activeUsers(tx, binding.InviterID, binding.UserID); err != nil {
		if err != ErrUnavailable {
			return err
		}
		binding.State, binding.Reason = "review", "Account eligibility requires review"
		return tx.Model(binding).Updates(map[string]any{"state": binding.State, "reason": binding.Reason}).Error
	}
	if binding.ReviewedAt > 0 {
		return nil
	}
	var sharedPayment int64
	identities := tx.Model(&PaymentIdentity{}).Select("digest").Where("user_id = ?", binding.UserID)
	if err := tx.Model(&PaymentIdentity{}).Where("user_id <> ? AND digest IN (?)", binding.UserID, identities).Count(&sharedPayment).Error; err != nil {
		return err
	}
	if sharedPayment > 0 {
		binding.State, binding.Reason = "review", "Shared payment account requires review"
		return tx.Model(binding).Updates(map[string]any{"state": binding.State, "reason": binding.Reason}).Error
	}
	var own Signal
	if err := tx.First(&own, "user_id = ?", binding.UserID).Error; err != nil {
		if !isMissing(err) {
			return err
		}
		binding.State, binding.Reason = "review", "Registration evidence requires review"
	} else {
		var related int64
		if err := tx.Model(&Signal{}).Where("user_id <> ? AND network = ? AND network <> ?", binding.UserID, own.Network, "").Count(&related).Error; err != nil {
			return err
		}
		if related > 0 {
			binding.State, binding.Reason = "review", "Shared network or client requires review"
		}
	}
	return tx.Model(&Binding{}).Where("user_id = ?", binding.UserID).Updates(map[string]any{"state": binding.State, "reason": strings.TrimSpace(binding.Reason)}).Error
}
