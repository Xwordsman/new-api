package controller

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	checkinpolicy "github.com/QuantumNous/new-api/extensions/checkin/policy"
	"github.com/QuantumNous/new-api/extensions/invitation"
	"github.com/QuantumNous/new-api/extensions/referral/ledger"
	"github.com/QuantumNous/new-api/extensions/registrationrisk/guard"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/groupdiscount"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

// Read the actual public response: navigation must receive only global switches,
// never private extension configuration or a stale copy of its settings.
func extensionStatusResponse(t *testing.T) map[string]bool {
	t.Helper()
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)
	GetStatus(context)
	require.Equal(t, http.StatusOK, response.Code)
	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			Features map[string]bool `json:"extension_features"`
			Sidebar  string          `json:"SidebarModulesAdmin"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
	require.True(t, payload.Success)
	assert.Equal(t, common.OptionMap["SidebarModulesAdmin"], payload.Data.Sidebar)
	assert.NotContains(t, response.Body.String(), "private-referral-risk-salt")
	assert.NotContains(t, response.Body.String(), "private-documentation-draft")
	return payload.Data.Features
}

func TestGetStatusExtensionFeaturesWithoutDatabase(t *testing.T) {
	previousDB := model.DB
	model.DB = nil
	t.Cleanup(func() { model.DB = previousDB })
	assert.Equal(t, map[string]bool{
		"channel_monitor": false, "benchmark": false, "referrals": false, "checkin": false, "leaderboard": false, "documentation": false,
	}, extensionStatusResponse(t))
}

func TestGetStatusExtensionFeaturesFromPersistedSettings(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(":memory:")
			case "mysql", "postgres":
				key := "SIDEBAR_TEST_" + strings.ToUpper(dialect) + "_DSN"
				dsn := os.Getenv(key)
				if dsn == "" {
					t.Skip(key + " is not configured")
				}
				if dialect == "mysql" {
					driver = mysql.Open(dsn)
				} else {
					driver = postgres.Open(dsn)
				}
			}
			database, err := gorm.Open(driver, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
			require.NoError(t, err)
			connection, err := database.DB()
			require.NoError(t, err)
			connection.SetMaxOpenConns(1)
			t.Cleanup(func() { require.NoError(t, connection.Close()) })
			var version string
			query := "SELECT version()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, database.Raw(query).Scan(&version).Error)
			t.Logf("database version: %s", version)
			require.NoError(t, database.AutoMigrate(&model.Option{}, &ledger.Settings{}, &invitation.Settings{}, &guard.Secret{}, &checkinpolicy.Settings{}))

			// All fixture writes roll back; the DSNs point to dedicated test databases.
			tx := database.Begin()
			require.NoError(t, tx.Error)
			t.Cleanup(func() { require.NoError(t, tx.Rollback().Error) })
			previousDB, previousOptions := model.DB, common.OptionMap
			model.DB = tx
			common.OptionMap = map[string]string{"SidebarModulesAdmin": `{"personal":{"tickets":false}}`}
			t.Cleanup(func() { model.DB, common.OptionMap = previousDB, previousOptions })
			require.NoError(t, tx.Create(&invitation.Settings{ID: 1}).Error)
			require.NoError(t, tx.Create(&guard.Secret{ID: 1, Salt: strings.Repeat("a", 64)}).Error)
			require.NoError(t, tx.Create(&ledger.Settings{ID: 1, Enabled: true, RiskSalt: "private-referral-risk-salt"}).Error)
			checkinSettings, err := checkinpolicy.DefaultSettings()
			require.NoError(t, err)
			require.NoError(t, tx.Create(&checkinSettings).Error)
			assert.Equal(t, map[string]bool{
				"channel_monitor": false, "benchmark": false, "referrals": true, "checkin": false, "leaderboard": true, "documentation": true,
			}, extensionStatusResponse(t))

			for _, enabled := range []bool{true, false, true} {
				value, err := common.Marshal(map[string]any{"enabled": enabled, "title": "private-documentation-draft"})
				require.NoError(t, err)
				for _, key := range []string{groupdiscount.OptionKey, "BenchmarkExtensionSettings", "LeaderboardExtensionSettings", "DocumentationCenterSettings"} {
					require.NoError(t, tx.Clauses(clause.OnConflict{
						Columns: []clause.Column{{Name: "key"}}, DoUpdates: clause.AssignmentColumns([]string{"value"}),
					}).Create(&model.Option{Key: key, Value: string(value)}).Error)
				}
				require.NoError(t, tx.Model(&ledger.Settings{}).Where("id = ?", 1).Update("enabled", enabled).Error)
				require.NoError(t, tx.Model(&checkinpolicy.Settings{}).Where("id = ?", 1).Update("enabled", enabled).Error)
				assert.Equal(t, map[string]bool{
					"channel_monitor": enabled, "benchmark": enabled, "referrals": enabled, "checkin": enabled, "leaderboard": enabled, "documentation": enabled,
				}, extensionStatusResponse(t))
			}

			// An unreadable setting hides only its own entry; other status remains usable.
			require.NoError(t, tx.Model(&model.Option{}).Where(clause.Eq{Column: "key", Value: "BenchmarkExtensionSettings"}).Update("value", `{"enabled":`).Error)
			require.NoError(t, tx.Delete(&ledger.Settings{}, 1).Error)
			assert.Equal(t, map[string]bool{
				"channel_monitor": true, "benchmark": false, "referrals": false, "checkin": true, "leaderboard": true, "documentation": true,
			}, extensionStatusResponse(t))
		})
	}
}

func TestGetOptionsExcludesDocumentationDrafts(t *testing.T) {
	previousOptions := common.OptionMap
	common.OptionMap = map[string]string{
		"DocumentationCenterSettings": `{"articles":[{"content":"private-documentation-draft"}]}`,
		"SystemName": "new-api",
	}
	t.Cleanup(func() { common.OptionMap = previousOptions })
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(http.MethodGet, "/api/option", nil)
	GetOptions(context)
	require.Equal(t, http.StatusOK, response.Code)
	assert.NotContains(t, response.Body.String(), "DocumentationCenterSettings")
	assert.NotContains(t, response.Body.String(), "private-documentation-draft")
	assert.Contains(t, response.Body.String(), "SystemName")
}
