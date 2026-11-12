package policy

import (
	"errors"
	"math"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const OptionKey = "ConcurrencyManagementSettings"

var (
	ErrInvalid     = common.NewMessage("Invalid concurrency settings")
	ErrConflict    = common.NewMessage("Concurrency settings changed. Reload before saving.")
	ErrUnavailable = common.NewMessage("Concurrency management is temporarily unavailable")
	settingsMu     sync.Mutex
	settingsCache  struct {
		sync.Mutex
		raw   string
		value Settings
		err   error
	}
)

type UserRule struct {
	UserID int `json:"user_id"`
	Limit  int `json:"limit"`
}

type GroupRule struct {
	Group string `json:"group"`
	Limit int    `json:"limit"`
}

type ChannelRule struct {
	ChannelID int `json:"channel_id"`
	Limit     int `json:"limit"`
	KeyLimit  int `json:"key_limit"`
}

type Settings struct {
	Revision            int64         `json:"revision"`
	Enabled             bool          `json:"enabled"`
	DefaultUserLimit    int           `json:"default_user_limit"`
	DefaultChannelLimit int           `json:"default_channel_limit"`
	DefaultKeyLimit     int           `json:"default_key_limit"`
	QueueTimeoutMS      int           `json:"queue_timeout_ms"`
	MaxQueuedPerUser    int           `json:"max_queued_per_user"`
	LeaseSeconds        int           `json:"lease_seconds"`
	Users               []UserRule    `json:"users"`
	Groups              []GroupRule   `json:"groups"`
	Channels            []ChannelRule `json:"channels"`
}

func DefaultSettings() Settings {
	return Settings{DefaultUserLimit: 5, LeaseSeconds: 120, Users: []UserRule{}, Groups: []GroupRule{}, Channels: []ChannelRule{}}
}

func (s Settings) Validate() error {
	if s.Revision < 0 || s.Revision == math.MaxInt64 || s.DefaultUserLimit < 0 || s.DefaultUserLimit > 100000 || s.DefaultChannelLimit < 0 || s.DefaultChannelLimit > 100000 || s.DefaultKeyLimit < 0 || s.DefaultKeyLimit > 100000 || s.LeaseSeconds < 30 || s.LeaseSeconds > 600 || s.QueueTimeoutMS < 0 || s.QueueTimeoutMS > 30000 || s.MaxQueuedPerUser < 0 || s.MaxQueuedPerUser > 100 || (s.QueueTimeoutMS == 0) != (s.MaxQueuedPerUser == 0) || len(s.Users) > 200 || len(s.Groups) > 200 || len(s.Channels) > 200 {
		return ErrInvalid
	}
	users, groups, channels := map[int]bool{}, map[string]bool{}, map[int]bool{}
	for _, rule := range s.Users {
		if rule.UserID <= 0 || rule.Limit < 0 || rule.Limit > 100000 || users[rule.UserID] {
			return ErrInvalid
		}
		users[rule.UserID] = true
	}
	for _, rule := range s.Groups {
		if rule.Group == "" || strings.TrimSpace(rule.Group) != rule.Group || len(rule.Group) > 64 || rule.Limit < 0 || rule.Limit > 100000 || groups[rule.Group] {
			return ErrInvalid
		}
		groups[rule.Group] = true
	}
	for _, rule := range s.Channels {
		if rule.ChannelID <= 0 || rule.Limit < 0 || rule.Limit > 100000 || rule.KeyLimit < 0 || rule.KeyLimit > 100000 || channels[rule.ChannelID] {
			return ErrInvalid
		}
		channels[rule.ChannelID] = true
	}
	return nil
}

func (s Settings) UserLimit(userID int, group string) int {
	for _, rule := range s.Users {
		if rule.UserID == userID {
			return rule.Limit
		}
	}
	for _, rule := range s.Groups {
		if rule.Group == group {
			return rule.Limit
		}
	}
	return s.DefaultUserLimit
}

func (s Settings) ChannelLimits(channelID int) (int, int) {
	for _, rule := range s.Channels {
		if rule.ChannelID == channelID {
			return rule.Limit, rule.KeyLimit
		}
	}
	return s.DefaultChannelLimit, s.DefaultKeyLimit
}

func ReadSettings(db *gorm.DB) (Settings, error) {
	s, _, err := readSettings(db)
	return s, err
}

func readSettings(db *gorm.DB) (Settings, string, error) {
	s := DefaultSettings()
	var option model.Option
	err := db.Where(clause.Eq{Column: "key", Value: OptionKey}).Take(&option).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return s, "", nil
	}
	if err != nil {
		return s, "", err
	}
	if err = common.UnmarshalJsonStr(option.Value, &s); err != nil {
		return s, "", err
	}
	return s, option.Value, s.Validate()
}

// CachedSettings follows the host's option refresh cycle on other gateway nodes.
// Invalid saved configuration fails closed instead of silently removing limits.
func CachedSettings() (Settings, error) {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[OptionKey]
	common.OptionMapRWMutex.RUnlock()
	settingsCache.Lock()
	defer settingsCache.Unlock()
	if raw == "" {
		return DefaultSettings(), nil
	}
	if raw != settingsCache.raw {
		s := DefaultSettings()
		err := common.UnmarshalJsonStr(raw, &s)
		if err == nil {
			err = s.Validate()
		}
		settingsCache.raw, settingsCache.value, settingsCache.err = raw, s, err
	}
	return settingsCache.value, settingsCache.err
}

func SaveSettings(db *gorm.DB, s Settings) (Settings, error) {
	if err := s.Validate(); err != nil {
		return s, err
	}
	if s.Users == nil {
		s.Users = []UserRule{}
	}
	if s.Groups == nil {
		s.Groups = []GroupRule{}
	}
	if s.Channels == nil {
		s.Channels = []ChannelRule{}
	}
	settingsMu.Lock()
	defer settingsMu.Unlock()
	var encoded []byte
	err := db.Transaction(func(tx *gorm.DB) error {
		initial, err := common.Marshal(DefaultSettings())
		if err != nil {
			return err
		}
		if err = tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.Option{Key: OptionKey, Value: string(initial)}).Error; err != nil {
			return err
		}
		current, raw, err := readSettings(tx)
		if err != nil {
			return err
		}
		if current.Revision != s.Revision {
			return ErrConflict
		}
		s.Revision++
		encoded, err = common.Marshal(s)
		if err != nil {
			return err
		}
		result := tx.Model(&model.Option{}).Where(clause.Eq{Column: "key", Value: OptionKey}).Where("value = ?", raw).Update("value", string(encoded))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrConflict
		}
		return nil
	})
	if err != nil {
		return s, err
	}
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = map[string]string{}
	}
	common.OptionMap[OptionKey] = string(encoded)
	common.OptionMapRWMutex.Unlock()
	return s, nil
}
