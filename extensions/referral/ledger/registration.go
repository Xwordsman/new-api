package ledger

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"

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
				if err := Register(batch, user.ID, user.InviterID, registeredAt); err != nil {
					return err
				}
			}
		}
		return nil
	}).Error
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
