package leaderboard

import (
	"context"
	"errors"
	"math"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/extensions/leaderboard/record"
	"github.com/QuantumNous/new-api/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const settingsKey = "LeaderboardExtensionSettings"

var policySync sync.Once

var errInvalid = common.NewMessage("Invalid leaderboard settings")
var errConflict = common.NewMessage("Leaderboard settings changed. Reload before saving.")

type Settings struct {
	Revision           int64    `json:"revision"`
	Enabled            bool     `json:"enabled"`
	IntervalMinutes    int      `json:"interval_minutes"`
	TopN               int      `json:"top_n"`
	Invitations        bool     `json:"invitations"`
	Income             bool     `json:"income"`
	Tokens             bool     `json:"tokens"`
	Savings            bool     `json:"savings"`
	Cyber              bool     `json:"cyber"`
	MaskNames          bool     `json:"mask_names"`
	ExcludeAdmins      bool     `json:"exclude_admins"`
	ExcludedUserIDs    []int    `json:"excluded_user_ids"`
	InvitationPaidOnly bool     `json:"invitation_paid_only"`
	WarningRetention   int      `json:"warning_retention_days"`
	ModelPrefixes      []string `json:"model_prefixes"`
	SafetyCodes        []string `json:"safety_codes"`
}

func defaults() Settings {
	return Settings{Enabled: true, IntervalMinutes: 30, TopN: 10, Invitations: true, Income: true, Tokens: true,
		Savings: true, Cyber: true, MaskNames: true, ExcludeAdmins: true, ExcludedUserIDs: []int{},
		InvitationPaidOnly: true, WarningRetention: 90, ModelPrefixes: []string{"gpt-", "chatgpt-", "o1", "o3", "o4"},
		SafetyCodes: []string{"content_policy_violation", "content_filter", "safety_violation", "safety_warning"}}
}

// Enabled reports the user-facing feature switch without building rankings.
func Enabled(db *gorm.DB) (bool, error) {
	settings, _, err := getSettings(db)
	return settings.Enabled, err
}

func getSettings(db *gorm.DB) (Settings, string, error) {
	s := defaults()
	var option model.Option
	err := db.Where(clause.Eq{Column: "key", Value: settingsKey}).Take(&option).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return s, "", nil
	}
	if err != nil {
		return s, "", err
	}
	err = common.UnmarshalJsonStr(option.Value, &s)
	return s, option.Value, err
}

func (s Settings) policy() record.Policy {
	return record.Policy{Enabled: s.Enabled, Savings: s.Savings, Cyber: s.Cyber, ModelPrefixes: s.ModelPrefixes, SafetyCodes: s.SafetyCodes}
}

func Initialize(db *gorm.DB) {
	s, _, err := getSettings(db)
	if err != nil {
		common.SysError("leaderboard settings: " + err.Error())
	} else {
		record.Configure(db, s.policy())
	}
	// Relay nodes do not run the master's system-task scheduler. Refresh their
	// collection policy independently so a saved switch applies to every node.
	policySync.Do(func() {
		go func() {
			for range time.NewTicker(30 * time.Second).C {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				s, _, err := getSettings(db.WithContext(ctx))
				cancel()
				if err == nil {
					record.Configure(db, s.policy())
				} else {
					common.SysError("leaderboard policy reload: " + err.Error())
				}
			}
		}()
	})
}

func saveSettings(db *gorm.DB, s Settings) (Settings, error) {
	if s.Revision < 0 || s.Revision == math.MaxInt64 || s.IntervalMinutes < 1 || s.IntervalMinutes > 1440 || s.TopN < 4 || s.TopN > 50 ||
		s.WarningRetention < 1 || s.WarningRetention > 3650 || len(s.ExcludedUserIDs) > 500 || len(s.ModelPrefixes) > 50 || len(s.SafetyCodes) > 100 ||
		(s.Cyber && (len(s.ModelPrefixes) == 0 || len(s.SafetyCodes) == 0)) {
		return s, errInvalid
	}
	for _, id := range s.ExcludedUserIDs {
		if id <= 0 {
			return s, errInvalid
		}
	}
	for _, list := range [][]string{s.ModelPrefixes, s.SafetyCodes} {
		for i, value := range list {
			value = strings.TrimSpace(strings.ToLower(value))
			if value == "" || len(value) > 100 || strings.ContainsRune(value, '*') || strings.ContainsFunc(value, unicode.IsSpace) {
				return s, errInvalid
			}
			list[i] = value
		}
	}
	slices.Sort(s.ExcludedUserIDs)
	s.ExcludedUserIDs = slices.Compact(s.ExcludedUserIDs)
	if s.ExcludedUserIDs == nil {
		s.ExcludedUserIDs = []int{}
	}
	if s.ModelPrefixes == nil {
		s.ModelPrefixes = []string{}
	}
	if s.SafetyCodes == nil {
		s.SafetyCodes = []string{}
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		initial, err := common.Marshal(defaults())
		if err != nil {
			return err
		}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.Option{Key: settingsKey, Value: string(initial)}).Error; err != nil {
			return err
		}
		current, raw, err := getSettings(tx)
		if err != nil {
			return err
		}
		if current.Revision != s.Revision {
			return errConflict
		}
		s.Revision++
		encoded, err := common.Marshal(s)
		if err != nil {
			return err
		}
		r := tx.Model(&model.Option{}).Where(clause.Eq{Column: "key", Value: settingsKey}).Where("value = ?", raw).Update("value", string(encoded))
		if r.Error != nil {
			return r.Error
		}
		if r.RowsAffected != 1 {
			return errConflict
		}
		return nil
	})
	if err == nil {
		record.Configure(db, s.policy())
	}
	return s, err
}

func (s Settings) boards() map[string]bool {
	return map[string]bool{"invitations": s.Invitations, "income": s.Income, "tokens": s.Tokens, "savings": s.Savings, "cyber": s.Cyber}
}
