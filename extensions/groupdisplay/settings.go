// Package groupdisplay owns presentation metadata, independently of routing and pricing.
package groupdisplay

import (
	"errors"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const OptionKey = "GroupDisplaySettings"
const maxRevision int64 = 1<<53 - 1 // JSON revisions must remain exact in browser clients.

var (
	ErrInvalid  = common.NewMessage("Invalid group appearance settings")
	ErrConflict = common.NewMessage("Group appearance changed. Reload before saving.")
	hexColor    = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
	categoryID  = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
)

type Category struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Icon  string `json:"icon"`
	Color string `json:"color"`
}

type Tag struct {
	Label string `json:"label"`
	Color string `json:"color"`
}

type Appearance struct {
	Category    string `json:"category"`
	DisplayName string `json:"display_name"`
	Description string `json:"description"`
	Icon        string `json:"icon"`
	Color       string `json:"color"`
	Tags        []Tag  `json:"tags"`
	Featured    bool   `json:"featured"`
	Background  bool   `json:"background"`
	Border      string `json:"border"`
	GradientTo  string `json:"gradient_to"`
	SortOrder   int    `json:"sort_order"`
}

type Settings struct {
	Revision   int64                 `json:"revision"`
	Categories []Category            `json:"categories"`
	Groups     map[string]Appearance `json:"groups"`
}

func Validate(s Settings) error {
	if s.Revision < 0 || s.Revision > maxRevision || len(s.Categories) > 64 || len(s.Groups) > 1024 {
		return ErrInvalid
	}
	categories := make(map[string]bool, len(s.Categories))
	for _, category := range s.Categories {
		if !categoryID.MatchString(category.ID) || categories[category.ID] || strings.TrimSpace(category.Name) == "" || utf8.RuneCountInString(category.Name) > 80 || len(category.Icon) > 128 || category.Color != "" && !hexColor.MatchString(category.Color) {
			return ErrInvalid
		}
		categories[category.ID] = true
	}
	for key, group := range s.Groups {
		if key == "" || strings.TrimSpace(key) != key || utf8.RuneCountInString(key) > 128 || group.Category != "" && !categories[group.Category] || utf8.RuneCountInString(group.DisplayName) > 120 || utf8.RuneCountInString(group.Description) > 600 || len(group.Icon) > 128 || len(group.Tags) > 6 || group.SortOrder < 0 || group.SortOrder > 100000 {
			return ErrInvalid
		}
		if group.Color != "" && !hexColor.MatchString(group.Color) || group.GradientTo != "" && !hexColor.MatchString(group.GradientTo) {
			return ErrInvalid
		}
		if group.Border != "" && group.Border != "solid" && group.Border != "gradient" {
			return ErrInvalid
		}
		seen := map[string]bool{}
		for _, tag := range group.Tags {
			label := strings.TrimSpace(tag.Label)
			if label == "" || utf8.RuneCountInString(label) > 32 || seen[label] || tag.Color != "" && !hexColor.MatchString(tag.Color) {
				return ErrInvalid
			}
			seen[label] = true
		}
	}
	return nil
}

func Read(db *gorm.DB) (Settings, string, error) {
	s := Settings{Categories: []Category{}, Groups: map[string]Appearance{}}
	var option model.Option
	err := db.Where(clause.Eq{Column: "key", Value: OptionKey}).Take(&option).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return s, "", nil
	}
	if err != nil {
		return s, "", err
	}
	if len(option.Value) > 1<<20 || common.UnmarshalJsonStr(option.Value, &s) != nil {
		return s, "", ErrInvalid
	}
	s = normalize(s)
	return s, option.Value, Validate(s)
}

func normalize(s Settings) Settings {
	if s.Categories == nil {
		s.Categories = []Category{}
	}
	for i := range s.Categories {
		s.Categories[i].Name = strings.TrimSpace(s.Categories[i].Name)
	}
	if s.Groups == nil {
		s.Groups = map[string]Appearance{}
	}
	for key, group := range s.Groups {
		if group.Tags == nil {
			group.Tags = []Tag{}
		}
		for i := range group.Tags {
			group.Tags[i].Label = strings.TrimSpace(group.Tags[i].Label)
		}
		s.Groups[key] = group
	}
	return s
}

// Visible returns metadata only for the already authorized routing keys. Empty
// categories and administrator revisions never reach the user's group response.
func (s Settings) Visible(keys []string) Settings {
	result := Settings{Categories: []Category{}, Groups: map[string]Appearance{}}
	used := map[string]bool{}
	for _, key := range keys {
		if appearance, ok := s.Groups[key]; ok {
			result.Groups[key] = appearance
			used[appearance.Category] = true
		}
	}
	for _, category := range s.Categories {
		if used[category.ID] {
			result.Categories = append(result.Categories, category)
		}
	}
	return result
}

// write uses an optimistic compare-and-swap, including first creation, so edits
// from another node or a concurrent pricing rename cannot be overwritten.
func write(db *gorm.DB, s Settings, raw string) (Settings, error) {
	if s.Revision == maxRevision {
		return s, ErrInvalid
	}
	if err := Validate(s); err != nil {
		return s, err
	}
	s = normalize(s)
	s.Revision++
	encoded, err := common.Marshal(s)
	if err != nil {
		return s, err
	}
	if len(encoded) > 1<<20 {
		return s, ErrInvalid
	}
	if raw == "" {
		result := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.Option{Key: OptionKey, Value: string(encoded)})
		if result.Error != nil {
			return s, result.Error
		}
		if result.RowsAffected != 1 {
			return s, ErrConflict
		}
		return s, nil
	}
	result := db.Model(&model.Option{}).Where(clause.Eq{Column: "key", Value: OptionKey}).Where("value = ?", raw).Update("value", string(encoded))
	if result.Error != nil {
		return s, result.Error
	}
	if result.RowsAffected != 1 {
		return s, ErrConflict
	}
	return s, nil
}

func Save(db *gorm.DB, s Settings) (Settings, error) {
	if err := Validate(s); err != nil {
		return s, err
	}
	current, raw, err := Read(db)
	if err != nil {
		return s, err
	}
	if current.Revision != s.Revision {
		return s, ErrConflict
	}
	return write(db, s, raw)
}

// Rename runs inside the pricing transaction, preserving every presentation
// field while invalidating any appearance editor loaded before the rename.
func Rename(tx *gorm.DB, renames map[string]string) error {
	if len(renames) == 0 {
		return nil
	}
	s, raw, err := Read(tx)
	if err != nil {
		return err
	}
	changed := false
	for old, name := range renames {
		appearance, exists := s.Groups[old]
		if !exists {
			continue
		}
		if _, collision := s.Groups[name]; collision {
			return ErrConflict
		}
		delete(s.Groups, old)
		s.Groups[name] = appearance
		changed = true
	}
	if !changed {
		return nil
	}
	_, err = write(tx, s, raw)
	return err
}

func RegisterRoutes(api *gin.RouterGroup) {
	admin := api.Group("/extensions/group-display/admin", middleware.RootAuth(), middleware.DisableCache())
	admin.GET("/settings", func(c *gin.Context) {
		s, _, err := Read(model.DB.WithContext(c.Request.Context()))
		respond(c, s, err)
	})
	admin.PUT("/settings", middleware.SessionCookieOriginGuard(), middleware.UserCriticalRateLimit("group-display-admin"), func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
		var s Settings
		if common.DecodeJson(c.Request.Body, &s) != nil {
			respond(c, nil, ErrInvalid)
			return
		}
		saved, err := Save(model.DB.WithContext(c.Request.Context()), s)
		respond(c, saved, err)
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
	common.SysError("group appearance: " + err.Error())
	common.ApiErrorT(c, "Unable to save group appearance settings")
}
