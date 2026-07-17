package invitation

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
)

var (
	ErrCodeRequired  = errors.New("invitation code is required")
	ErrCodeInvalid   = errors.New("invitation code is invalid")
	ErrCodeDisabled  = errors.New("invitation code is disabled")
	ErrCodeExpired   = errors.New("invitation code has expired")
	ErrCodeExhausted = errors.New("invitation code has reached its usage limit")
)

func RegistrationEnabled(db *gorm.DB) (bool, error) {
	var settings Settings
	if err := db.Where("id = ?", settingsID).First(&settings).Error; err != nil {
		return false, err
	}
	return settings.Enabled, nil
}

func UpdateSettings(db *gorm.DB, enabled bool) error {
	return db.Model(&Settings{}).
		Where("id = ?", settingsID).
		Updates(map[string]any{
			"enabled":    enabled,
			"updated_at": time.Now(),
		}).Error
}

func NormalizeCode(code string) string {
	return strings.ToUpper(strings.TrimSpace(code))
}

// Consume conditionally increments usage so concurrent registrations cannot
// exceed an invitation code's configured limit.
func Consume(tx *gorm.DB, rawCode string) error {
	enabled, err := RegistrationEnabled(tx)
	if err != nil {
		return err
	}
	if !enabled {
		return nil
	}

	code := NormalizeCode(rawCode)
	if code == "" {
		return ErrCodeRequired
	}

	now := time.Now()
	result := tx.Model(&Code{}).
		Where(
			"code = ? AND status = ? AND (max_uses = 0 OR used_count < max_uses) AND (expires_at IS NULL OR expires_at > ?)",
			code,
			CodeStatusEnabled,
			now,
		).
		UpdateColumn("used_count", gorm.Expr("used_count + ?", 1))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}

	var invitationCode Code
	if err := tx.Where("code = ?", code).First(&invitationCode).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrCodeInvalid
		}
		return err
	}
	if invitationCode.Status != CodeStatusEnabled {
		return ErrCodeDisabled
	}
	if invitationCode.ExpiresAt != nil && !invitationCode.ExpiresAt.After(now) {
		return ErrCodeExpired
	}
	if invitationCode.MaxUses > 0 && invitationCode.UsedCount >= invitationCode.MaxUses {
		return ErrCodeExhausted
	}
	return ErrCodeInvalid
}

func ErrorMessageKey(err error) string {
	switch {
	case errors.Is(err, ErrCodeRequired):
		return "invitation.code_required"
	case errors.Is(err, ErrCodeDisabled):
		return "invitation.code_disabled"
	case errors.Is(err, ErrCodeExpired):
		return "invitation.code_expired"
	case errors.Is(err, ErrCodeExhausted):
		return "invitation.code_exhausted"
	default:
		return "invitation.code_invalid"
	}
}

func IsCodeError(err error) bool {
	return errors.Is(err, ErrCodeRequired) ||
		errors.Is(err, ErrCodeInvalid) ||
		errors.Is(err, ErrCodeDisabled) ||
		errors.Is(err, ErrCodeExpired) ||
		errors.Is(err, ErrCodeExhausted)
}
