package emailtemplate

import (
	"errors"
	"math"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	errConflict = common.NewMessage("Email templates changed. Reload before saving.")
	settingsMu  sync.Mutex
)

type Settings struct {
	Revision  int64      `json:"revision"`
	Enabled   bool       `json:"enabled"`
	Templates []Template `json:"templates"`
}

func readSettings(db *gorm.DB) (Settings, string, error) {
	s := Settings{Templates: []Template{}}
	var option model.Option
	err := db.Where(clause.Eq{Column: "key", Value: common.EmailTemplateOptionKey}).Take(&option).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return s, "", nil
	}
	if err != nil {
		return s, "", err
	}
	if err = common.UnmarshalJsonStr(option.Value, &s); err != nil {
		return s, "", err
	}
	if s.Templates == nil {
		s.Templates = []Template{}
	}
	return s, option.Value, nil
}

func compileSettings(s Settings) (map[string]*compiledTemplate, error) {
	if s.Revision < 0 || s.Revision == math.MaxInt64 || len(s.Templates) > len(kinds)*len(languages) {
		return nil, errInvalid
	}
	compiled := map[string]*compiledTemplate{}
	for _, kind := range kinds {
		for _, lang := range languages {
			item, err := compileTemplate(defaultTemplate(kind.id, lang))
			if err != nil {
				return nil, err
			}
			compiled[templateKey(kind.id, lang)] = item
		}
	}
	seen := map[string]bool{}
	total := 0
	for _, source := range s.Templates {
		key := templateKey(source.Type, source.Language)
		if seen[key] {
			return nil, errInvalid
		}
		seen[key] = true
		total += len(source.HTML) + len(source.Subject)
		if total > 1024*1024 {
			return nil, errInvalid
		}
		item, err := compileTemplate(source)
		if err != nil {
			return nil, err
		}
		compiled[key] = item
	}
	return compiled, nil
}

func saveSettings(db *gorm.DB, s Settings) (Settings, error) {
	if _, err := compileSettings(s); err != nil {
		return s, err
	}
	if s.Templates == nil {
		s.Templates = []Template{}
	}
	settingsMu.Lock()
	defer settingsMu.Unlock()
	var encoded []byte
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.Option{Key: common.EmailTemplateOptionKey, Value: `{"revision":0,"enabled":false,"templates":[]}`}).Error; err != nil {
			return err
		}
		current, raw, err := readSettings(tx)
		if err != nil {
			return err
		}
		if s.Revision != current.Revision {
			return errConflict
		}
		s.Revision++
		encoded, err = common.Marshal(s)
		if err != nil {
			return err
		}
		result := tx.Model(&model.Option{}).Where(clause.Eq{Column: "key", Value: common.EmailTemplateOptionKey}).Where("value = ?", raw).Update("value", string(encoded))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errConflict
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
	common.OptionMap[common.EmailTemplateOptionKey] = string(encoded)
	common.OptionMapRWMutex.Unlock()
	return s, nil
}
