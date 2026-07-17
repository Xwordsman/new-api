package homepage

import (
	"fmt"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func newHomepageTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, Migrate(db))
	return db
}

func TestMigrateCreatesDisabledShowcaseSettings(t *testing.T) {
	db := newHomepageTestDB(t)

	settings, err := GetSettings(db)
	require.NoError(t, err)
	assert.False(t, settings.Enabled)
	assert.Equal(t, ModeShowcase, settings.Mode)
}

func TestUpdateSettingsPersistsHomepageReplacement(t *testing.T) {
	db := newHomepageTestDB(t)

	settings, err := UpdateSettings(db, Settings{
		Enabled:     true,
		Mode:        ModeNotFound,
		Title:       "  Temporarily unavailable  ",
		Description: "  Please use the console.  ",
		ButtonText:  "  Open console  ",
		ButtonURL:   "  /console  ",
	})
	require.NoError(t, err)
	assert.True(t, settings.Enabled)
	assert.Equal(t, ModeNotFound, settings.Mode)
	assert.Equal(t, "Temporarily unavailable", settings.Title)
	assert.Equal(t, "Please use the console.", settings.Description)
	assert.Equal(t, "Open console", settings.ButtonText)
	assert.Equal(t, "/console", settings.ButtonURL)
}

func TestNormalizeAndValidateSettingsRejectsUnsafeValues(t *testing.T) {
	tests := []struct {
		name     string
		settings Settings
	}{
		{name: "unknown mode", settings: Settings{Mode: "redirect"}},
		{name: "protocol relative URL", settings: Settings{Mode: ModeShowcase, ButtonURL: "//example.com"}},
		{name: "script URL", settings: Settings{Mode: ModeShowcase, ButtonURL: "javascript:alert(1)"}},
		{name: "title too long", settings: Settings{Mode: ModeShowcase, Title: strings.Repeat("a", 121)}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := NormalizeAndValidateSettings(test.settings)
			assert.ErrorIs(t, err, ErrInvalidSettings)
		})
	}
}

func TestNormalizeAndValidateSettingsAcceptsWebDestinations(t *testing.T) {
	for _, destination := range []string{"/console?tab=home", "https://example.com/welcome", "http://localhost:3000"} {
		t.Run(destination, func(t *testing.T) {
			settings, err := NormalizeAndValidateSettings(Settings{
				Mode:      ModeShowcase,
				ButtonURL: destination,
			})
			require.NoError(t, err)
			assert.Equal(t, destination, settings.ButtonURL)
		})
	}
}
