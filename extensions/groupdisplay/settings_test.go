package groupdisplay_test

import (
	"errors"
	"maps"
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/extensions/groupdisplay"
	"github.com/QuantumNous/new-api/extensions/grouppricing"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/groupdiscount"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func displayTestDB(t *testing.T, dialect string) *gorm.DB {
	t.Helper()
	var driver gorm.Dialector
	if dialect == "sqlite" {
		driver = sqlite.Open(":memory:")
	} else {
		dsn := os.Getenv("GROUP_DISPLAY_TEST_" + strings.ToUpper(dialect) + "_DSN")
		if dsn == "" {
			if os.Getenv("GROUP_DISPLAY_TEST_REQUIRE_MATRIX") == "1" {
				t.Fatal("required database DSN is missing: " + dialect)
			}
			t.Skip("dedicated database DSN not set: " + dialect)
		}
		require.Contains(t, dsn, "/group_display_test?")
		if dialect == "mysql" {
			driver = mysql.Open(dsn)
		} else {
			driver = postgres.Open(dsn)
		}
	}
	db, err := gorm.Open(driver, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	connection, err := db.DB()
	require.NoError(t, err)
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, connection.Close()) })
	require.NoError(t, db.Migrator().DropTable(&model.Option{}))
	require.NoError(t, db.AutoMigrate(&model.Option{}))
	return db
}

func TestGroupAppearanceDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := displayTestDB(t, dialect)
			initial, _, err := groupdisplay.Read(db)
			require.NoError(t, err)
			assert.Empty(t, initial.Groups)
			assert.Empty(t, initial.Categories)
			// Representative pre-extension data must survive repeated startup.
			require.NoError(t, db.Create(&model.Option{Key: "unrelated", Value: "preserved"}).Error)
			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.Option{}))
			}
			initial.Categories = []groupdisplay.Category{{ID: "openai", Name: " OpenAI ", Icon: "OpenAI", Color: "#16a34a"}, {ID: "private", Name: "Private"}}
			initial.Groups = map[string]groupdisplay.Appearance{
				"public": {Category: "openai", DisplayName: "GPT standard", Description: "Stable route", Featured: true, Background: true, Border: "gradient", GradientTo: "#38bdf8", Tags: []groupdisplay.Tag{{Label: " Stable ", Color: "#16a34a"}}},
				"hidden": {Category: "private", DisplayName: "Private route"},
			}
			saved, err := groupdisplay.Save(db, initial)
			require.NoError(t, err)
			assert.EqualValues(t, 1, saved.Revision)
			assert.Equal(t, "OpenAI", saved.Categories[0].Name)
			assert.Equal(t, "Stable", saved.Groups["public"].Tags[0].Label)
			assert.NotNil(t, saved.Groups["hidden"].Tags)
			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.Option{}))
				reloaded, _, err := groupdisplay.Read(db)
				require.NoError(t, err)
				assert.Equal(t, saved, reloaded)
			}
			_, err = groupdisplay.Save(db, initial)
			assert.ErrorIs(t, err, groupdisplay.ErrConflict)
			invalid := saved
			invalid.Groups = maps.Clone(saved.Groups)
			invalid.Groups["public"] = groupdisplay.Appearance{Color: "url(https://invalid)"}
			_, err = groupdisplay.Save(db, invalid)
			assert.ErrorIs(t, err, groupdisplay.ErrInvalid)
			visible := saved.Visible([]string{"public", "unknown"})
			assert.EqualValues(t, 0, visible.Revision)
			assert.Equal(t, []groupdisplay.Category{saved.Categories[0]}, visible.Categories)
			assert.Equal(t, map[string]groupdisplay.Appearance{"public": saved.Groups["public"]}, visible.Groups)
			assert.Empty(t, saved.Visible(nil).Categories)

			rollback := errors.New("pricing save rejected")
			err = db.Transaction(func(tx *gorm.DB) error {
				require.NoError(t, groupdisplay.Rename(tx, map[string]string{"public": "gpt"}))
				return rollback
			})
			assert.ErrorIs(t, err, rollback)
			reloaded, _, err := groupdisplay.Read(db)
			require.NoError(t, err)
			assert.Equal(t, saved, reloaded, "failed pricing changes must not move appearance")
			err = db.Transaction(func(tx *gorm.DB) error { return groupdisplay.Rename(tx, map[string]string{"public": "hidden"}) })
			assert.ErrorIs(t, err, groupdisplay.ErrConflict)

			// Exercise the actual pricing transaction's rename integration.
			originalPricing, err := grouppricing.Read(db)
			require.NoError(t, err)
			common.OptionMapRWMutex.Lock()
			originalOptions := maps.Clone(common.OptionMap)
			if common.OptionMap == nil {
				common.OptionMap = map[string]string{}
			}
			common.OptionMapRWMutex.Unlock()
			originalRuntime := groupdiscount.Default
			groupdiscount.Default = &groupdiscount.Runtime{}
			t.Cleanup(func() {
				require.NoError(t, model.PublishCommittedOptions(originalPricing.Options))
				groupdiscount.Default = originalRuntime
				common.OptionMapRWMutex.Lock()
				common.OptionMap = originalOptions
				common.OptionMapRWMutex.Unlock()
			})
			pricing := originalPricing
			pricing.Options = maps.Clone(originalPricing.Options)
			pricing.Options["GroupRatio"] = `{"public":1}`
			pricing.Options["GroupDisplayOrder"] = `["public"]`
			pricing.Options["UserUsableGroups"] = `{"public":"Public"}`
			for key, value := range pricing.Options {
				require.NoError(t, db.Create(&model.Option{Key: key, Value: value}).Error)
			}
			update := grouppricing.Update{Snapshot: pricing, Baseline: maps.Clone(pricing.Options), Renames: map[string]string{"public": "gpt"}}
			update.Options = maps.Clone(pricing.Options)
			update.Options["GroupRatio"] = `{"gpt":1}`
			update.Options["GroupDisplayOrder"] = `["gpt"]`
			update.Options["UserUsableGroups"] = `{"gpt":"Public"}`
			_, err = grouppricing.Save(db, update)
			require.NoError(t, err)
			renamed, _, err := groupdisplay.Read(db)
			require.NoError(t, err)
			assert.Equal(t, saved.Revision+1, renamed.Revision)
			assert.Equal(t, saved.Groups["public"], renamed.Groups["gpt"])
			assert.NotContains(t, renamed.Groups, "public")
			_, err = groupdisplay.Save(db, saved)
			assert.ErrorIs(t, err, groupdisplay.ErrConflict, "a stale appearance editor must not restore a renamed key")
			var unrelated model.Option
			require.NoError(t, db.Where("value = ?", "preserved").Take(&unrelated).Error)
			assert.Equal(t, "unrelated", unrelated.Key)
		})
	}
}

func TestInvalidGroupAppearanceIsRejected(t *testing.T) {
	for _, test := range []struct {
		name  string
		group groupdisplay.Appearance
	}{
		{"missing category", groupdisplay.Appearance{Category: "missing"}},
		{"unsafe color", groupdisplay.Appearance{Color: "red;display:none"}},
		{"duplicate tags", groupdisplay.Appearance{Tags: []groupdisplay.Tag{{Label: "Stable"}, {Label: " Stable "}}}},
		{"negative order", groupdisplay.Appearance{SortOrder: -1}},
		{"unsupported border", groupdisplay.Appearance{Border: "animated"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			assert.ErrorIs(t, groupdisplay.Validate(groupdisplay.Settings{Groups: map[string]groupdisplay.Appearance{"public": test.group}}), groupdisplay.ErrInvalid)
		})
	}
}
