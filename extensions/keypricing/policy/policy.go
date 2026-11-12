// Package policy stores Key price consent independently of token credentials and caches.
package policy

import (
	"errors"
	"math"
	"slices"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const SettingsKey = "KeyPriceProtectionExtensionSettings"

var (
	ErrInvalid     = common.NewMessage("Invalid Key price protection settings")
	ErrConflict    = common.NewMessage("Key price protection changed. Reload and confirm again.")
	ErrPaused      = common.NewMessage("API key paused by group price protection. Review and accept current multipliers in the console.")
	ErrOptOut      = common.NewMessage("The administrator requires price protection for this API key")
	ErrUnavailable = common.NewMessage("Key price protection is temporarily unavailable")
)

type Settings struct {
	Revision        int64   `json:"revision"`
	Enabled         bool    `json:"enabled"`
	DefaultProtect  bool    `json:"default_protect"`
	AllowOptOut     bool    `json:"allow_opt_out"`
	LegacyMode      string  `json:"legacy_mode"`
	IncreasePercent float64 `json:"increase_percent"`
	QuoteTTLSeconds int     `json:"quote_ttl_seconds"`
}

type option struct {
	Key   string `gorm:"primaryKey;size:191"`
	Value string `gorm:"type:text"`
}

func (option) TableName() string { return "options" }

// State never changes the host token status. Disabling this extension therefore
// cannot enable a manually disabled, expired, or exhausted token.
type State struct {
	TokenID       int     `gorm:"primaryKey;autoIncrement:false" json:"token_id"`
	UserID        int     `gorm:"index" json:"user_id"`
	Version       int64   `json:"version"`
	Protected     bool    `json:"protected"`
	Paused        bool    `gorm:"index" json:"paused"`
	RouteHash     string  `gorm:"size:64" json:"-"`
	Accepted      string  `gorm:"type:text" json:"-"`
	AcceptedAt    int64   `json:"accepted_at"`
	PausedAt      int64   `json:"paused_at"`
	Reason        string  `gorm:"size:40" json:"reason"`
	GroupName     string  `gorm:"size:191" json:"group"`
	PreviousRatio float64 `json:"previous_ratio"`
	CurrentRatio  float64 `json:"current_ratio"`
}

func (State) TableName() string { return "extension_key_price_states" }

type Event struct {
	ID            int     `gorm:"primaryKey" json:"id"`
	TokenID       int     `gorm:"index" json:"token_id"`
	UserID        int     `gorm:"index" json:"user_id"`
	ActorID       int     `json:"actor_id"`
	CreatedAt     int64   `gorm:"index" json:"created_at"`
	Action        string  `gorm:"size:24" json:"action"`
	Reason        string  `gorm:"size:40" json:"reason"`
	GroupName     string  `gorm:"size:191" json:"group"`
	PreviousRatio float64 `json:"previous_ratio"`
	CurrentRatio  float64 `json:"current_ratio"`
	Revision      int64   `json:"revision"`
}

func (Event) TableName() string { return "extension_key_price_events" }

// Quotes are single-use consent challenges, never authentication credentials.
// Only their SHA-256 digests are persisted, and neither form enters the audit log.
type Quote struct {
	Hash             string `gorm:"primaryKey;size:64"`
	TokenID          int    `gorm:"index"`
	UserID           int
	StateVersion     int64
	SettingsRevision int64
	RouteHash        string `gorm:"size:64"`
	Rates            string `gorm:"type:text"`
	ExpiresAt        int64  `gorm:"index"`
}

func (Quote) TableName() string { return "extension_key_price_quotes" }

func Defaults() Settings {
	return Settings{DefaultProtect: true, AllowOptOut: true, LegacyMode: "ignore", QuoteTTLSeconds: 300}
}

func Migrate(db *gorm.DB) error {
	return db.AutoMigrate(&State{}, &Event{}, &Quote{})
}

func GetSettings(db *gorm.DB) (Settings, error) {
	s := Defaults()
	var row option
	err := db.Where(clause.Eq{Column: "key", Value: SettingsKey}).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	err = common.UnmarshalJsonStr(row.Value, &s)
	return s, err
}

func SaveSettings(db *gorm.DB, s Settings, actor int, now int64) (Settings, error) {
	if s.Revision < 0 || s.Revision == math.MaxInt64 || !slices.Contains([]string{"ignore", "confirm"}, s.LegacyMode) ||
		math.IsNaN(s.IncreasePercent) || math.IsInf(s.IncreasePercent, 0) || s.IncreasePercent < 0 || s.IncreasePercent > 100 ||
		s.QuoteTTLSeconds < 60 || s.QuoteTTLSeconds > 900 {
		return s, ErrInvalid
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		initial, err := common.Marshal(Defaults())
		if err != nil {
			return err
		}
		if err = tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&option{Key: SettingsKey, Value: string(initial)}).Error; err != nil {
			return err
		}
		var current option
		if err = tx.Where(clause.Eq{Column: "key", Value: SettingsKey}).Take(&current).Error; err != nil {
			return err
		}
		var old Settings
		if err = common.UnmarshalJsonStr(current.Value, &old); err != nil {
			return err
		}
		if old.Revision != s.Revision {
			return ErrConflict
		}
		s.Revision++
		encoded, err := common.Marshal(s)
		if err != nil {
			return err
		}
		r := tx.Model(&option{}).Where(clause.Eq{Column: "key", Value: SettingsKey}).Where("value = ?", current.Value).Update("value", string(encoded))
		if r.Error != nil {
			return r.Error
		}
		if r.RowsAffected != 1 {
			return ErrConflict
		}
		return tx.Create(&Event{ActorID: actor, Action: "settings", CreatedAt: now, Revision: s.Revision}).Error
	})
	return s, err
}

func IsPolicyError(err error) bool {
	return errors.Is(err, ErrInvalid) || errors.Is(err, ErrConflict) || errors.Is(err, ErrPaused) || errors.Is(err, ErrOptOut) || errors.Is(err, ErrUnavailable)
}

func ReadState(db *gorm.DB, tokenID, userID int) (State, bool, error) {
	var state State
	err := db.Where("token_id = ? AND user_id = ?", tokenID, userID).Take(&state).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return State{TokenID: tokenID, UserID: userID}, false, nil
	}
	return state, err == nil, err
}

// Check compares the already frozen billing multiplier; it does not recalculate
// discounts or alter pricing, pre-consumption, settlement, or refunds.
func Check(db *gorm.DB, s Settings, tokenID, userID int, routeHash, group string, ratio float64, now int64) error {
	if !s.Enabled {
		return nil
	}
	if ratio < 0 || math.IsNaN(ratio) || math.IsInf(ratio, 0) {
		return ErrUnavailable
	}
	for range 3 {
		state, exists, err := ReadState(db, tokenID, userID)
		if err != nil {
			return err
		}
		if !exists && s.LegacyMode == "ignore" {
			return nil
		}
		if state.Paused {
			return ErrPaused
		}
		if exists && (!state.Protected && s.AllowOptOut) {
			return nil
		}
		reason := ""
		previous := float64(0)
		var rates map[string]float64
		if exists {
			if err = common.UnmarshalJsonStr(state.Accepted, &rates); err != nil {
				return err
			}
		}
		switch {
		case !exists:
			reason = "confirmation_required"
		case state.RouteHash != routeHash:
			reason = "group_changed"
		default:
			var accepted bool
			previous, accepted = rates[group]
			limit := previous * (1 + s.IncreasePercent/100)
			if !accepted {
				reason = "new_group"
			} else if ratio > limit && ratio-limit > math.Abs(limit)*1e-12 {
				reason = "ratio_increased"
			}
		}
		if reason == "" {
			return nil
		}
		err = db.Transaction(func(tx *gorm.DB) error {
			if !exists {
				state = State{TokenID: tokenID, UserID: userID, Version: 1, Protected: true, Paused: true, Accepted: "{}", PausedAt: now, Reason: reason, GroupName: group, CurrentRatio: ratio}
				r := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&state)
				if r.Error != nil {
					return r.Error
				}
				if r.RowsAffected != 1 {
					return ErrConflict
				}
			} else {
				r := tx.Model(&State{}).Where("token_id = ? AND user_id = ? AND version = ?", tokenID, userID, state.Version).Updates(map[string]any{
					"version": state.Version + 1, "paused": true, "paused_at": now, "reason": reason, "group_name": group, "previous_ratio": previous, "current_ratio": ratio,
				})
				if r.Error != nil {
					return r.Error
				}
				if r.RowsAffected != 1 {
					return ErrConflict
				}
			}
			return tx.Create(&Event{TokenID: tokenID, UserID: userID, CreatedAt: now, Action: "paused", Reason: reason, GroupName: group, PreviousRatio: previous, CurrentRatio: ratio, Revision: s.Revision}).Error
		})
		if errors.Is(err, ErrConflict) {
			continue
		}
		if err != nil {
			return err
		}
		return ErrPaused
	}
	return ErrUnavailable
}
