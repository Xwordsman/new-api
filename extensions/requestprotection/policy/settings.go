// Package policy owns request inspection and temporary API restrictions. It
// deliberately has no dependency on host credentials, billing or channel health.
package policy

import (
	"errors"
	"math"
	"net/mail"
	"path"
	"regexp"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const SettingsKey = "RequestProtectionExtensionSettings"

var (
	ErrInvalid     = common.NewMessage("Invalid request protection settings or input")
	ErrConflict    = common.NewMessage("Request protection changed. Reload and try again.")
	ErrUnavailable = common.NewMessage("Request protection is temporarily unavailable")
)

type Rule struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Enabled        bool     `json:"enabled"`
	Kind           string   `json:"kind"`
	Patterns       []string `json:"patterns"`
	Sources        []string `json:"sources"`
	Action         string   `json:"action"`
	HighConfidence bool     `json:"high_confidence"`
	CountPenalty   bool     `json:"count_penalty"`
}

type Settings struct {
	Revision           int64    `json:"revision"`
	Enabled            bool     `json:"enabled"`
	Mode               string   `json:"mode"`
	Groups             []string `json:"groups"`
	Models             []string `json:"models"`
	Protocols          []string `json:"protocols"`
	ExemptUserIDs      []int    `json:"exempt_user_ids"`
	MaxBodyBytes       int      `json:"max_body_bytes"`
	MaxTextBytes       int      `json:"max_text_bytes"`
	UninspectedAction  string   `json:"uninspected_action"`
	FailClosed         bool     `json:"fail_closed"`
	Rules              []Rule   `json:"rules"`
	WindowMinutes      int      `json:"window_minutes"`
	KeyThreshold       int      `json:"key_threshold"`
	KeySuspendMinutes  int      `json:"key_suspend_minutes"`
	UserThreshold      int      `json:"user_threshold"`
	UserSuspendMinutes int      `json:"user_suspend_minutes"`
	DuplicateSeconds   int      `json:"duplicate_seconds"`
	RetentionDays      int      `json:"retention_days"`
	UpstreamCodes      []string `json:"upstream_codes"`
	AlertEnabled       bool     `json:"alert_enabled"`
	AlertEmails        []string `json:"alert_emails"`
	AlertMinutes       int      `json:"alert_minutes"`
	AlertThreshold     int      `json:"alert_threshold"`
}

type option struct {
	Key   string `gorm:"primaryKey;size:191"`
	Value string `gorm:"type:text"`
}

func (option) TableName() string { return "options" }

func Defaults() Settings {
	return Settings{Mode: "observe", Groups: []string{}, Models: []string{}, Protocols: []string{}, ExemptUserIDs: []int{},
		MaxBodyBytes: 2 * 1024 * 1024, MaxTextBytes: 256 * 1024, UninspectedAction: "observe", FailClosed: true,
		WindowMinutes: 10, KeyThreshold: 3, KeySuspendMinutes: 30, UserThreshold: 10, UserSuspendMinutes: 60,
		DuplicateSeconds: 60, RetentionDays: 30, AlertMinutes: 15, AlertThreshold: 10, AlertEmails: []string{},
		UpstreamCodes: []string{"content_policy_violation", "content_filter", "safety_violation"},
		Rules: []Rule{
			{ID: "instruction-override", Name: "Instruction override", Enabled: true, Kind: "all", Patterns: []string{"ignore all previous instructions", "without restrictions"}, Sources: []string{"current", "system"}, Action: "observe"},
			{ID: "cn-instruction-override", Name: "Chinese instruction override", Enabled: true, Kind: "all", Patterns: []string{"忽略之前的所有指令", "不受任何限制"}, Sources: []string{"current", "system"}, Action: "observe"},
			{ID: "template-marker", Name: "Known jailbreak template markers", Enabled: true, Kind: "any", Patterns: []string{"[developer mode enabled]", "[jailbreak successful]"}, Sources: []string{"current", "system"}, Action: "observe"},
		},
	}
}

func Validate(s Settings) error {
	if s.Revision < 0 || s.Revision == math.MaxInt64 || !slices.Contains([]string{"observe", "enforce"}, s.Mode) ||
		!slices.Contains([]string{"allow", "observe", "block"}, s.UninspectedAction) || s.MaxBodyBytes < 1024 || s.MaxBodyBytes > 8*1024*1024 ||
		s.MaxTextBytes < 256 || s.MaxTextBytes > 512*1024 || s.MaxTextBytes > s.MaxBodyBytes || len(s.Rules) > 100 ||
		s.WindowMinutes < 1 || s.WindowMinutes > 1440 || s.KeyThreshold < 0 || s.KeyThreshold > 10000 || s.UserThreshold < 0 || s.UserThreshold > 10000 ||
		s.KeySuspendMinutes < 1 || s.KeySuspendMinutes > 43200 || s.UserSuspendMinutes < 1 || s.UserSuspendMinutes > 43200 ||
		s.DuplicateSeconds < 1 || s.DuplicateSeconds > 86400 || s.RetentionDays < 2 || s.RetentionDays > 365 ||
		s.AlertMinutes < 1 || s.AlertMinutes > 1440 || s.AlertThreshold < 1 || s.AlertThreshold > 100000 || len(s.AlertEmails) > 10 ||
		len(s.ExemptUserIDs) > 100 || len(s.Groups) > 100 || len(s.Models) > 100 || len(s.Protocols) > 30 || len(s.UpstreamCodes) > 30 {
		return ErrInvalid
	}
	for _, list := range [][]string{s.Groups, s.Models, s.Protocols, s.UpstreamCodes} {
		for _, v := range list {
			if len(v) == 0 || len(v) > 191 || strings.TrimSpace(v) != v {
				return ErrInvalid
			}
		}
	}
	for _, id := range s.ExemptUserIDs {
		if id <= 0 {
			return ErrInvalid
		}
	}
	for _, pattern := range s.Models {
		if _, err := path.Match(pattern, ""); err != nil {
			return ErrInvalid
		}
	}
	for _, email := range s.AlertEmails {
		address, err := mail.ParseAddress(email)
		if err != nil || address.Address != email || len(email) > 254 {
			return ErrInvalid
		}
	}
	if s.AlertEnabled && len(s.AlertEmails) == 0 {
		return ErrInvalid
	}
	ids := map[string]bool{}
	patterns, patternBytes := 0, 0
	idPattern := regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
	for _, r := range s.Rules {
		if !idPattern.MatchString(r.ID) || ids[r.ID] || strings.TrimSpace(r.Name) == "" || len(r.Name) > 120 ||
			!slices.Contains([]string{"any", "all", "regex"}, r.Kind) || len(r.Patterns) == 0 || len(r.Patterns) > 20 || len(r.Sources) == 0 || len(r.Sources) > 4 ||
			!slices.Contains([]string{"observe", "block"}, r.Action) || (r.CountPenalty && (!r.HighConfidence || r.Action != "block")) {
			return ErrInvalid
		}
		ids[r.ID] = true
		sources := map[string]bool{}
		for _, source := range r.Sources {
			if !slices.Contains([]string{"current", "history", "system", "tool"}, source) || sources[source] {
				return ErrInvalid
			}
			sources[source] = true
		}
		for _, p := range r.Patterns {
			patterns++
			patternBytes += len(p)
			if strings.TrimSpace(p) == "" || len(p) > 1000 || Normalize(p) == "" {
				return ErrInvalid
			}
			if r.Kind == "regex" {
				if _, err := regexp.Compile(p); err != nil {
					return ErrInvalid
				}
			}
		}
	}
	if patterns > 200 || patternBytes > 32000 {
		return ErrInvalid
	}
	return nil
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
	if err = common.UnmarshalJsonStr(row.Value, &s); err != nil {
		return s, err
	}
	return s, Validate(s)
}

func SaveSettings(db *gorm.DB, s Settings, actor int, now int64) (Settings, error) {
	if err := Validate(s); err != nil {
		return s, err
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		initial, err := common.Marshal(Defaults())
		if err != nil {
			return err
		}
		if err = tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&option{Key: SettingsKey, Value: string(initial)}).Error; err != nil {
			return err
		}
		var old option
		if err = tx.Where(clause.Eq{Column: "key", Value: SettingsKey}).Take(&old).Error; err != nil {
			return err
		}
		var current Settings
		if err = common.UnmarshalJsonStr(old.Value, &current); err != nil {
			return err
		}
		if current.Revision != s.Revision {
			return ErrConflict
		}
		s.Revision++
		encoded, err := common.Marshal(s)
		if err != nil {
			return err
		}
		r := tx.Model(&option{}).Where(clause.Eq{Column: "key", Value: SettingsKey}).Where("value = ?", old.Value).Update("value", string(encoded))
		if r.Error != nil {
			return r.Error
		}
		if r.RowsAffected != 1 {
			return ErrConflict
		}
		return tx.Create(&Audit{ActorID: actor, CreatedAt: now, Action: "settings", Revision: s.Revision}).Error
	})
	return s, err
}
