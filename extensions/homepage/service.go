package homepage

import (
	"errors"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
)

var ErrInvalidSettings = errors.New("invalid homepage settings")

func GetSettings(db *gorm.DB) (Settings, error) {
	settings := DefaultSettings()
	err := db.Where("id = ?", settingsID).First(&settings).Error
	return settings, err
}

func NormalizeAndValidateSettings(settings Settings) (Settings, error) {
	settings.ID = settingsID
	settings.Mode = strings.TrimSpace(settings.Mode)
	settings.Title = strings.TrimSpace(settings.Title)
	settings.Description = strings.TrimSpace(settings.Description)
	settings.ButtonText = strings.TrimSpace(settings.ButtonText)
	settings.ButtonURL = strings.TrimSpace(settings.ButtonURL)

	if settings.Mode != ModeShowcase && settings.Mode != ModeNotFound {
		return Settings{}, ErrInvalidSettings
	}
	if utf8.RuneCountInString(settings.Title) > 120 ||
		utf8.RuneCountInString(settings.Description) > 500 ||
		utf8.RuneCountInString(settings.ButtonText) > 50 ||
		len(settings.ButtonURL) > 2048 {
		return Settings{}, ErrInvalidSettings
	}
	if settings.ButtonURL == "" {
		return settings, nil
	}

	if strings.HasPrefix(settings.ButtonURL, "/") && !strings.HasPrefix(settings.ButtonURL, "//") {
		if _, err := url.ParseRequestURI(settings.ButtonURL); err == nil {
			return settings, nil
		}
		return Settings{}, ErrInvalidSettings
	}

	parsedURL, err := url.Parse(settings.ButtonURL)
	if err != nil || parsedURL.Host == "" || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") {
		return Settings{}, ErrInvalidSettings
	}
	return settings, nil
}

func UpdateSettings(db *gorm.DB, settings Settings) (Settings, error) {
	normalized, err := NormalizeAndValidateSettings(settings)
	if err != nil {
		return Settings{}, err
	}

	err = db.Model(&Settings{}).
		Where("id = ?", settingsID).
		Updates(map[string]any{
			"enabled":     normalized.Enabled,
			"mode":        normalized.Mode,
			"title":       normalized.Title,
			"description": normalized.Description,
			"button_text": normalized.ButtonText,
			"button_url":  normalized.ButtonURL,
			"updated_at":  time.Now(),
		}).Error
	if err != nil {
		return Settings{}, err
	}
	return GetSettings(db)
}
