// Package grouppricing owns public promotions and their small integration with
// upstream group settings. Monitoring visibility never owns billing rules.
package grouppricing

import (
	"errors"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/groupdiscount"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var optionKeys = []string{"GroupRatio", "GroupDisplayOrder", "TopupGroupRatio", "UserUsableGroups", "GroupGroupRatio", "AutoGroups", "MaxTokenAutoGroups", "DefaultUseAutoGroup", "group_ratio_setting.group_special_usable_group"}
var saveMutex sync.Mutex
var ErrInvalid = common.NewMessage("Invalid group pricing settings")
var ErrConflict = common.NewMessage("Group pricing changed. Reload before saving.")

type Group struct {
	Group     string              `json:"group"`
	Promotion *groupdiscount.Rule `json:"promotion"`
}
type Promotions struct {
	Revision int64   `json:"revision"`
	Groups   []Group `json:"groups"`
}
type Snapshot struct {
	Options    map[string]string `json:"options"`
	Promotions Promotions        `json:"promotions"`
}
type Update struct {
	Snapshot
	Baseline map[string]string `json:"baseline"`
	Renames  map[string]string `json:"renames"`
}

// Migrate copies legacy rules exactly once. Persist even an empty sentinel so
// an intentionally removed promotion can never reappear on a later restart.
func Migrate(db *gorm.DB) error {
	var existing model.Option
	err := db.Where(clause.Eq{Column: "key", Value: groupdiscount.OptionKey}).Take(&existing).Error
	if err == nil {
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	saved := Promotions{Groups: []Group{}}
	var legacy model.Option
	err = db.Where(clause.Eq{Column: "key", Value: groupdiscount.LegacyOptionKey}).Take(&legacy).Error
	if err == nil {
		if err = common.UnmarshalJsonStr(legacy.Value, &saved); err != nil {
			return err
		}
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	groups := make([]Group, 0, len(saved.Groups))
	for _, group := range saved.Groups {
		if group.Promotion != nil {
			groups = append(groups, group)
		}
	}
	saved.Groups = groups
	raw, err := common.Marshal(saved)
	if err != nil {
		return err
	}
	validator := &groupdiscount.Runtime{}
	if err = validator.Load(string(raw)); err != nil {
		return err
	}
	return db.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.Option{Key: groupdiscount.OptionKey, Value: string(raw)}).Error
}

func Read(db *gorm.DB) (Snapshot, error) {
	result := Snapshot{Options: map[string]string{}, Promotions: Promotions{Groups: []Group{}}}
	common.OptionMapRWMutex.RLock()
	for _, key := range optionKeys {
		result.Options[key] = common.OptionMap[key]
	}
	common.OptionMapRWMutex.RUnlock()
	// Defaults also support a fresh database before its first administrator save.
	defaults := map[string]string{
		"GroupRatio":        ratio_setting.GroupRatio2JSONString(),
		"GroupDisplayOrder": setting.GroupDisplayOrderJSONString(),
		"TopupGroupRatio":   common.TopupGroupRatio2JSONString(), "UserUsableGroups": setting.UserUsableGroups2JSONString(),
		"GroupGroupRatio": ratio_setting.GroupGroupRatio2JSONString(), "AutoGroups": setting.AutoGroups2JsonString(),
		"MaxTokenAutoGroups": strconv.Itoa(setting.GetMaxTokenAutoGroups()), "DefaultUseAutoGroup": strconv.FormatBool(setting.DefaultUseAutoGroup),
		"group_ratio_setting.group_special_usable_group": ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.MarshalJSONString(),
	}
	for key, value := range result.Options {
		if value == "" {
			result.Options[key] = defaults[key]
		}
	}
	var options []model.Option
	keys := append(slices.Clone(optionKeys), groupdiscount.OptionKey)
	if err := db.Where(clause.IN{Column: "key", Values: stringValues(keys)}).Find(&options).Error; err != nil {
		return result, err
	}
	for _, option := range options {
		if option.Key == groupdiscount.OptionKey {
			if err := common.UnmarshalJsonStr(option.Value, &result.Promotions); err != nil {
				return result, err
			}
		} else {
			result.Options[option.Key] = option.Value
		}
	}
	if result.Promotions.Groups == nil {
		result.Promotions.Groups = []Group{}
	}
	return result, nil
}

func stringValues(values []string) []any {
	result := make([]any, len(values))
	for i, value := range values {
		result[i] = value
	}
	return result
}

func validGroup(name string) bool {
	return name != "" && name != "auto" && strings.TrimSpace(name) == name && utf8.RuneCountInString(name) <= 128
}

func validate(update Update) error {
	if len(update.Options) != len(optionKeys) || len(update.Baseline) != len(optionKeys) || len(update.Renames) > 1024 {
		return ErrInvalid
	}
	for _, key := range optionKeys {
		if _, ok := update.Options[key]; !ok {
			return ErrInvalid
		}
		if _, ok := update.Baseline[key]; !ok {
			return ErrInvalid
		}
	}
	for _, key := range []string{"GroupRatio", "TopupGroupRatio"} {
		var ratios map[string]float64
		raw := update.Options[key]
		if !strings.HasPrefix(strings.TrimSpace(raw), "{") || common.UnmarshalJsonStr(raw, &ratios) != nil || len(ratios) > 1024 {
			return ErrInvalid
		}
		for group, ratio := range ratios {
			if !validGroup(group) || math.IsNaN(ratio) || math.IsInf(ratio, 0) || ratio < 0 {
				return ErrInvalid
			}
		}
	}
	var nested map[string]map[string]float64
	if !strings.HasPrefix(strings.TrimSpace(update.Options["GroupGroupRatio"]), "{") || common.UnmarshalJsonStr(update.Options["GroupGroupRatio"], &nested) != nil {
		return ErrInvalid
	}
	for _, ratios := range nested {
		for _, ratio := range ratios {
			if math.IsNaN(ratio) || math.IsInf(ratio, 0) || ratio < 0 {
				return ErrInvalid
			}
		}
	}
	var usable map[string]string
	if !strings.HasPrefix(strings.TrimSpace(update.Options["UserUsableGroups"]), "{") || common.UnmarshalJsonStr(update.Options["UserUsableGroups"], &usable) != nil {
		return ErrInvalid
	}
	var special map[string]map[string]string
	if !strings.HasPrefix(strings.TrimSpace(update.Options["group_ratio_setting.group_special_usable_group"]), "{") || common.UnmarshalJsonStr(update.Options["group_ratio_setting.group_special_usable_group"], &special) != nil {
		return ErrInvalid
	}
	var auto []string
	if !strings.HasPrefix(strings.TrimSpace(update.Options["AutoGroups"]), "[") || common.UnmarshalJsonStr(update.Options["AutoGroups"], &auto) != nil {
		return ErrInvalid
	}
	if setting.ValidateGroupDisplayOrder(update.Options["GroupDisplayOrder"]) != nil || setting.ValidateMaxTokenAutoGroups(update.Options["MaxTokenAutoGroups"]) != nil {
		return ErrInvalid
	}
	if update.Options["DefaultUseAutoGroup"] != "true" && update.Options["DefaultUseAutoGroup"] != "false" {
		return ErrInvalid
	}
	if update.Promotions.Revision < 0 || update.Promotions.Revision == math.MaxInt64 || len(update.Promotions.Groups) > 1024 {
		return ErrInvalid
	}
	seen := map[string]bool{}
	for i := range update.Promotions.Groups {
		group := &update.Promotions.Groups[i]
		if !validGroup(group.Group) || seen[group.Group] {
			return ErrInvalid
		}
		seen[group.Group] = true
		if group.Promotion != nil {
			if group.Promotion.Ratio == nil {
				return ErrInvalid
			}
			rule, err := groupdiscount.Normalize(*group.Promotion)
			if err != nil {
				return ErrInvalid
			}
			group.Promotion = &rule
		}
	}
	var before, after map[string]float64
	if common.UnmarshalJsonStr(update.Baseline["GroupRatio"], &before) != nil || common.UnmarshalJsonStr(update.Options["GroupRatio"], &after) != nil {
		return ErrInvalid
	}
	targets := map[string]bool{}
	for old, name := range update.Renames {
		_, exists := before[old]
		_, collision := before[name]
		_, created := after[name]
		_, remains := after[old]
		if !validGroup(old) || !validGroup(name) || old == name || !exists || collision || !created || remains || targets[name] {
			return ErrInvalid
		}
		targets[name] = true
	}
	return nil
}

// Save commits pricing, promotions and monitor rename references together. Each
// option is compared with its loaded value, including the monitor's own revision.
func Save(db *gorm.DB, update Update) (Snapshot, error) {
	if err := validate(update); err != nil {
		return Snapshot{}, err
	}
	saveMutex.Lock()
	defer saveMutex.Unlock()
	var result Snapshot
	err := db.Transaction(func(tx *gorm.DB) error {
		current, err := Read(tx)
		if err != nil {
			return err
		}
		if current.Promotions.Revision != update.Promotions.Revision {
			return ErrConflict
		}
		for _, key := range optionKeys {
			if current.Options[key] != update.Baseline[key] {
				return ErrConflict
			}
		}
		next := update.Promotions
		next.Revision++
		if next.Groups == nil {
			next.Groups = []Group{}
		}
		raw, err := common.Marshal(next)
		if err != nil {
			return err
		}
		values := map[string]string{groupdiscount.OptionKey: string(raw)}
		for _, key := range optionKeys {
			values[key] = update.Options[key]
		}
		// Monitor metadata and visibility are preserved; only the routing identifier changes.
		var monitor model.Option
		err = tx.Where(clause.Eq{Column: "key", Value: groupdiscount.LegacyOptionKey}).Take(&monitor).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err == nil && len(update.Renames) > 0 {
			var document struct {
				Revision int64 `json:"revision"`
				Enabled  bool  `json:"enabled"`
				Groups   []struct {
					Group       string `json:"group"`
					DisplayName string `json:"display_name"`
					Description string `json:"description"`
					Badge       string `json:"badge"`
				} `json:"groups"`
			}
			if common.UnmarshalJsonStr(monitor.Value, &document) != nil {
				return ErrInvalid
			}
			changed := false
			seen := map[string]bool{}
			for i := range document.Groups {
				if name, ok := update.Renames[document.Groups[i].Group]; ok {
					document.Groups[i].Group = name
					changed = true
				}
				if seen[document.Groups[i].Group] {
					return ErrInvalid
				}
				seen[document.Groups[i].Group] = true
			}
			if changed {
				if document.Revision == math.MaxInt64 {
					return ErrInvalid
				}
				document.Revision++
				encoded, err := common.Marshal(document)
				if err != nil {
					return err
				}
				query := tx.Model(&model.Option{}).Where(clause.Eq{Column: "key", Value: monitor.Key}).Where("value = ?", monitor.Value).Update("value", string(encoded))
				if query.Error != nil {
					return query.Error
				}
				if query.RowsAffected != 1 {
					return ErrConflict
				}
			}
		}
		// A consistent order prevents two nodes from locking these rows in opposite orders.
		keys := append(slices.Clone(optionKeys), groupdiscount.OptionKey)
		slices.Sort(keys)
		for _, key := range keys {
			var option model.Option
			err := tx.Where(clause.Eq{Column: "key", Value: key}).Take(&option).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				created := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.Option{Key: key, Value: values[key]})
				if created.Error != nil {
					return created.Error
				}
				if created.RowsAffected != 1 {
					return ErrConflict
				}
				continue
			}
			if err != nil {
				return err
			}
			expected := update.Baseline[key]
			if key == groupdiscount.OptionKey {
				var saved Promotions
				if common.UnmarshalJsonStr(option.Value, &saved) != nil || saved.Revision != update.Promotions.Revision {
					return ErrConflict
				}
				expected = option.Value
			}
			if option.Value != expected {
				return ErrConflict
			}
			if option.Value == values[key] {
				continue
			}
			changed := tx.Model(&model.Option{}).Where(clause.Eq{Column: "key", Value: key}).Where("value = ?", expected).Update("value", values[key])
			if changed.Error != nil {
				return changed.Error
			}
			if changed.RowsAffected != 1 {
				return ErrConflict
			}
		}
		result = Snapshot{Options: update.Options, Promotions: next}
		return nil
	})
	if err != nil {
		return result, err
	}
	// Only publish after all persisted values are committed.
	if err = model.PublishCommittedOptions(result.Options); err != nil {
		return result, err
	}
	raw, err := common.Marshal(result.Promotions)
	if err != nil {
		return result, err
	}
	if err = model.PublishCommittedOptions(map[string]string{groupdiscount.OptionKey: string(raw)}); err != nil {
		return result, err
	}
	return result, nil
}

func RegisterRoutes(api *gin.RouterGroup) {
	admin := api.Group("/extensions/group-pricing/admin", middleware.RootAuth(), middleware.DisableCache())
	admin.GET("/settings", func(c *gin.Context) {
		data, err := Read(model.DB.WithContext(c.Request.Context()))
		respond(c, data, err)
	})
	admin.PUT("/settings", middleware.SessionCookieOriginGuard(), middleware.UserCriticalRateLimit("group-pricing-admin"), func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
		var update Update
		if common.DecodeJson(c.Request.Body, &update) != nil {
			respond(c, nil, ErrInvalid)
			return
		}
		data, err := Save(model.DB.WithContext(c.Request.Context()), update)
		respond(c, data, err)
	})
}
func respond(c *gin.Context, data any, err error) {
	if err == nil {
		common.ApiSuccess(c, data)
		return
	}
	if errors.Is(err, ErrInvalid) || errors.Is(err, ErrConflict) {
		common.ApiError(c, err)
		return
	}
	common.SysError("group pricing: " + err.Error())
	common.ApiErrorT(c, "Unable to save group pricing settings")
}
