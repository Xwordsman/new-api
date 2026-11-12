package documentationcenter

import (
	_ "embed"
	"errors"
	"math"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	OptionKey       = "DocumentationCenterSettings"
	maxSettingsSize = 4 << 20
	maxArticleSize  = 128 << 10
)

var (
	//go:embed seed.json
	seedJSON []byte

	errInvalid  = common.NewMessage("Invalid documentation settings")
	errConflict = common.NewMessage("Documentation changed. Reload before saving.")
	safeID      = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,99}$`)
	settingsMu  sync.Mutex
)

type Settings struct {
	Revision    int64      `json:"revision"`
	Enabled     bool       `json:"enabled"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Categories  []Category `json:"categories"`
	Articles    []Article  `json:"articles"`
}

type Category struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	SortOrder   int    `json:"sort_order"`
}

type Article struct {
	ID          string `json:"id"`
	CategoryID  string `json:"category_id"`
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Content     string `json:"content"`
	Status      string `json:"status"`
	SortOrder   int    `json:"sort_order"`
	UpdatedAt   int64  `json:"updated_at"`
}

func defaultSettings() (Settings, error) {
	s := Settings{Enabled: true, Title: "文档中心", Description: "从快速接入到进阶使用，找到所需的指南与帮助。"}
	if err := common.Unmarshal(seedJSON, &s); err != nil {
		return s, err
	}
	for i := range s.Articles {
		s.Articles[i].UpdatedAt = time.Now().Unix()
	}
	return s, validateSettings(s)
}

// Migrate seeds only an absent catalog. Operator edits and deletions survive
// restarts and upstream upgrades, including an intentionally empty catalog.
func Migrate(db *gorm.DB) error {
	s, err := defaultSettings()
	if err != nil {
		return err
	}
	encoded, err := common.Marshal(s)
	if err != nil {
		return err
	}
	return db.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.Option{Key: OptionKey, Value: string(encoded)}).Error
}

func readSettings(db *gorm.DB) (Settings, string, error) {
	var option model.Option
	if err := db.Where(clause.Eq{Column: "key", Value: OptionKey}).Take(&option).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			s, err := defaultSettings()
			return s, "", err
		}
		return Settings{}, "", err
	}
	var s Settings
	if len(option.Value) > maxSettingsSize || common.UnmarshalJsonStr(option.Value, &s) != nil {
		return s, "", errInvalid
	}
	if s.Categories == nil {
		s.Categories = []Category{}
	}
	if s.Articles == nil {
		s.Articles = []Article{}
	}
	if err := validateSettings(s); err != nil {
		return s, "", err
	}
	return s, option.Value, nil
}

func Enabled(db *gorm.DB) (bool, error) {
	s, _, err := readSettings(db)
	return err == nil && s.Enabled, err
}

func validateSettings(s Settings) error {
	if s.Revision < 0 || strings.TrimSpace(s.Title) == "" || utf8.RuneCountInString(s.Title) > 120 || utf8.RuneCountInString(s.Description) > 600 || len(s.Categories) > 64 || len(s.Articles) > 500 {
		return errInvalid
	}
	categories := make(map[string]bool, len(s.Categories))
	for _, category := range s.Categories {
		if !safeID.MatchString(category.ID) || categories[category.ID] || strings.TrimSpace(category.Title) == "" || utf8.RuneCountInString(category.Title) > 120 || utf8.RuneCountInString(category.Description) > 600 || category.SortOrder < 0 || category.SortOrder > 100000 {
			return errInvalid
		}
		categories[category.ID] = true
	}
	ids, slugs := make(map[string]bool, len(s.Articles)), make(map[string]bool, len(s.Articles))
	for _, article := range s.Articles {
		if !safeID.MatchString(article.ID) || ids[article.ID] || !safeID.MatchString(article.Slug) || slugs[article.Slug] || !categories[article.CategoryID] || strings.TrimSpace(article.Title) == "" || utf8.RuneCountInString(article.Title) > 160 || utf8.RuneCountInString(article.Description) > 600 || len(article.Content) > maxArticleSize || article.SortOrder < 0 || article.SortOrder > 100000 {
			return errInvalid
		}
		if article.Status != "draft" && article.Status != "published" || article.Status == "published" && strings.TrimSpace(article.Content) == "" {
			return errInvalid
		}
		ids[article.ID], slugs[article.Slug] = true, true
	}
	encoded, err := common.Marshal(s)
	if err != nil || len(encoded) > maxSettingsSize {
		return errInvalid
	}
	return nil
}

func saveSettings(db *gorm.DB, s Settings) (Settings, error) {
	if s.Revision == math.MaxInt64 {
		return s, errInvalid
	}
	if err := validateSettings(s); err != nil {
		return s, err
	}
	if s.Categories == nil {
		s.Categories = []Category{}
	}
	if s.Articles == nil {
		s.Articles = []Article{}
	}
	settingsMu.Lock()
	defer settingsMu.Unlock()
	var encoded []byte
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := Migrate(tx); err != nil {
			return err
		}
		current, raw, err := readSettings(tx)
		if err != nil {
			return err
		}
		if s.Revision != current.Revision {
			return errConflict
		}
		previous := make(map[string]Article, len(current.Articles))
		for _, article := range current.Articles {
			previous[article.ID] = article
		}
		now := time.Now().Unix()
		for i := range s.Articles {
			article := &s.Articles[i]
			old, exists := previous[article.ID]
			article.UpdatedAt = old.UpdatedAt
			if !exists || *article != old {
				article.UpdatedAt = now
			}
		}
		s.Revision++
		encoded, err = common.Marshal(s)
		if err != nil {
			return err
		}
		if len(encoded) > maxSettingsSize {
			return errInvalid
		}
		result := tx.Model(&model.Option{}).Where(clause.Eq{Column: "key", Value: OptionKey}).Where("value = ?", raw).Update("value", string(encoded))
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
	common.OptionMap[OptionKey] = string(encoded)
	common.OptionMapRWMutex.Unlock()
	return s, nil
}
