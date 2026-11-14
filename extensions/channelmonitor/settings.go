package channelmonitor

import (
	"errors"
	"math"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/groupdiscount"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const settingsKey = groupdiscount.LegacyOptionKey

var (
	errInvalid  = common.NewMessage("Invalid channel monitor settings")
	errConflict = common.NewMessage("Channel monitor settings changed. Reload before saving.")
)

type GroupSettings struct {
	Group       string              `json:"group"`
	DisplayName string              `json:"display_name"`
	Description string              `json:"description"`
	Badge       string              `json:"badge"`
	Icon        string              `json:"icon,omitempty"`
	Promotion   *groupdiscount.Rule `json:"promotion"`
}

type Settings struct {
	Revision int64           `json:"revision"`
	Enabled  bool            `json:"enabled"`
	Groups   []GroupSettings `json:"groups"`
}

func orderGroups(groups []GroupSettings) []GroupSettings {
	byName := make(map[string]GroupSettings, len(groups))
	names := make([]string, 0, len(groups))
	for _, group := range groups {
		byName[group.Group] = group
		names = append(names, group.Group)
	}
	ordered := make([]GroupSettings, 0, len(groups))
	for _, name := range setting.OrderGroupNames(names) {
		ordered = append(ordered, byName[name])
	}
	return ordered
}

// Enabled reports the user-facing feature switch without loading a snapshot.
func Enabled(db *gorm.DB) (bool, error) {
	settings, _, err := getSettings(db)
	return settings.Enabled, err
}

func getSettings(db *gorm.DB) (Settings, string, error) {
	settings := Settings{Groups: []GroupSettings{}}
	var option model.Option
	err := db.Where(clause.Eq{Column: "key", Value: settingsKey}).Take(&option).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return settings, "", nil
	}
	if err != nil {
		return settings, "", err
	}
	if err = common.UnmarshalJsonStr(option.Value, &settings); err != nil {
		return settings, "", err
	}
	for i := range settings.Groups {
		settings.Groups[i].Promotion = nil
	}
	if settings.Groups == nil {
		settings.Groups = []GroupSettings{}
	}
	settings.Groups = orderGroups(settings.Groups)
	return settings, option.Value, nil
}

func saveSettings(db *gorm.DB, settings Settings) (Settings, error) {
	if settings.Revision < 0 || settings.Revision == math.MaxInt64 || len(settings.Groups) > 24 {
		return settings, errInvalid
	}
	seen := make(map[string]bool, len(settings.Groups))
	for i := range settings.Groups {
		group := &settings.Groups[i]
		group.DisplayName = strings.TrimSpace(group.DisplayName)
		group.Description = strings.TrimSpace(group.Description)
		group.Badge = strings.TrimSpace(group.Badge)
		group.Icon = strings.TrimSpace(group.Icon)
		if group.Group == "" || group.Group == "auto" || seen[group.Group] || !ratio_setting.ContainsGroupRatio(group.Group) ||
			utf8.RuneCountInString(group.DisplayName) > 80 || utf8.RuneCountInString(group.Description) > 240 || utf8.RuneCountInString(group.Badge) > 24 || utf8.RuneCountInString(group.Icon) > 128 {
			return settings, errInvalid
		}
		if group.Promotion != nil {
			return settings, errInvalid
		}

		seen[group.Group] = true
	}
	if settings.Groups == nil {
		settings.Groups = []GroupSettings{}
	}
	settings.Groups = orderGroups(settings.Groups)
	var encoded []byte
	err := db.Transaction(func(tx *gorm.DB) error {
		// Insert the empty sentinel only if needed. Subsequent updates compare the
		// entire saved value, so concurrent administrators cannot overwrite edits.
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.Option{Key: settingsKey, Value: `{"revision":0,"enabled":false,"groups":[]}`}).Error; err != nil {
			return err
		}
		current, raw, err := getSettings(tx)
		if err != nil {
			return err
		}
		if current.Revision != settings.Revision {
			return errConflict
		}
		settings.Revision++
		encoded, err = common.Marshal(settings)
		if err != nil {
			return err
		}
		result := tx.Model(&model.Option{}).Where(clause.Eq{Column: "key", Value: settingsKey}).Where("value = ?", raw).Update("value", string(encoded))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errConflict
		}
		return nil
	})
	return settings, err
}
