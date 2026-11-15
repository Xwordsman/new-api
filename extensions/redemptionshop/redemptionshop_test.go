package redemptionshop

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestSettingsValidation(t *testing.T) {
	base := Store{ID: "primary", Name: " Main shop ", URL: " https://shop.example/codes?lang=zh ", Description: " Instructions ", Enabled: true}
	normalized, err := normalizeSettings(Settings{Stores: []Store{base}})
	require.NoError(t, err)
	assert.Equal(t, "Main shop", normalized.Stores[0].Name)
	assert.Equal(t, "Instructions", normalized.Stores[0].Description)
	assert.Equal(t, "https://shop.example/codes?lang=zh", normalized.Stores[0].URL)
	for _, address := range []string{"", "javascript:alert(1)", "ftp://shop.example", "//shop.example", "https://@shop.example", "https://user:secret@shop.example", "https://shop.example/a b", "https://shop.example\\evil", "https://", "https://shop.example:" + strings.Repeat("a", 5)} {
		t.Run(address, func(t *testing.T) {
			store := base
			store.URL = address
			_, err := normalizeSettings(Settings{Stores: []Store{store}})
			assert.ErrorIs(t, err, errInvalid)
		})
	}
	for _, tc := range []struct {
		name     string
		settings Settings
	}{
		{"negative revision", Settings{Revision: -1}},
		{"unsafe revision", Settings{Revision: 1<<53 - 1}},
		{"duplicate identities", Settings{Stores: []Store{base, base}}},
		{"too many stores", Settings{Stores: make([]Store, 33)}},
		{"missing name", Settings{Stores: []Store{{ID: "empty", URL: "https://shop.example"}}}},
		{"oversized name", Settings{Stores: []Store{{ID: "long", Name: strings.Repeat("店", 81), URL: "https://shop.example"}}}},
		{"invalid identity", Settings{Stores: []Store{{ID: "../bad", Name: "Shop", URL: "https://shop.example"}}}},
	} {
		t.Run(tc.name, func(t *testing.T) { _, err := normalizeSettings(tc.settings); assert.ErrorIs(t, err, errInvalid) })
	}
}

func TestSettingsPersistenceAcrossDatabases(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector = sqlite.Open(t.TempDir() + "/shops.db")
			if dialect != "sqlite" {
				dsn := os.Getenv("REDEMPTION_STORE_TEST_" + strings.ToUpper(dialect) + "_DSN")
				if dsn == "" {
					t.Skip("dedicated database is not configured")
				}
				require.Contains(t, dsn, "/redemption_store_test_", "use a dedicated disposable database")
				if dialect == "mysql" {
					driver = mysql.Open(dsn)
				} else {
					driver = postgres.Open(dsn)
				}
			}
			db, err := gorm.Open(driver, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
			require.NoError(t, err)
			conn, err := db.DB()
			require.NoError(t, err)
			conn.SetMaxOpenConns(1)
			t.Cleanup(func() { require.NoError(t, conn.Close()) })
			var version string
			query := "SELECT version()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("%s %s", dialect, version)
			require.NoError(t, db.AutoMigrate(&model.Option{}))
			fresh, _, err := readSettings(db)
			require.NoError(t, err)
			assert.False(t, fresh.Enabled)
			assert.Empty(t, fresh.Stores)
			require.NoError(t, db.Create(&model.Option{Key: "ExistingRechargeSetting", Value: "preserved"}).Error)
			saved, err := saveSettings(db, Settings{Enabled: true, Stores: []Store{
				{ID: "second", Name: "Second shop", URL: "https://second.example", Description: "人民币兑换码", Enabled: true},
				{ID: "hidden", Name: "Hidden shop", URL: "https://hidden.example", Enabled: false},
				{ID: "first", Name: "First shop", URL: "https://first.example", Enabled: true},
			}})
			require.NoError(t, err)
			assert.EqualValues(t, 1, saved.Revision)
			_, err = saveSettings(db, Settings{Enabled: false})
			assert.ErrorIs(t, err, errConflict)
			public, err := PublicStores(db, true)
			require.NoError(t, err)
			assert.Equal(t, []PublicStore{
				{ID: "second", Name: "Second shop", URL: "https://second.example", Description: "人民币兑换码"},
				{ID: "first", Name: "First shop", URL: "https://first.example"},
			}, public)
			public, err = PublicStores(db, false)
			require.NoError(t, err)
			assert.Empty(t, public)
			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.Option{}))
				loaded, _, err := readSettings(db)
				require.NoError(t, err)
				assert.Equal(t, saved, loaded)
				var existing model.Option
				require.NoError(t, db.Where("value = ?", "preserved").Take(&existing).Error)
				assert.Equal(t, "ExistingRechargeSetting", existing.Key)
			}
			saved.Enabled = false
			saved, err = saveSettings(db, saved)
			require.NoError(t, err)
			assert.EqualValues(t, 2, saved.Revision)
			public, err = PublicStores(db, true)
			require.NoError(t, err)
			assert.Empty(t, public)
			require.NoError(t, db.Model(&model.Option{}).Where("value <> ?", "preserved").Update("value", "invalid json").Error)
			public, err = PublicStores(db, true)
			assert.Error(t, err)
			assert.Empty(t, public)
		})
	}
}

func TestAdminPermissionsOriginValidationAndRevision(t *testing.T) {
	require.NoError(t, i18n.Init())
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	conn, err := db.DB()
	require.NoError(t, err)
	conn.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, conn.Close()) })
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.User{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}))
	previousDB, previousLogs := model.DB, model.LOG_DB
	previousRedis, previousRate, previousSecret := common.RedisEnabled, common.CriticalRateLimitEnable, common.SessionSecret
	previousTrusted := common.SessionCookieTrustedURLs
	model.DB, model.LOG_DB, common.RedisEnabled, common.CriticalRateLimitEnable = db, db, false, false
	common.SessionSecret, common.SessionCookieTrustedURLs = "redemption-store-test-signing-key", nil
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogs
		common.RedisEnabled, common.CriticalRateLimitEnable, common.SessionSecret = previousRedis, previousRate, previousSecret
		common.SessionCookieTrustedURLs = previousTrusted
	})
	credentials := map[int]string{}
	for _, role := range []int{common.RoleCommonUser, common.RoleAdminUser, common.RoleRootUser} {
		name := "redemption-store-" + strconv.Itoa(role)
		user := model.User{Username: name, AffCode: name, Role: role, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1}
		require.NoError(t, db.Create(&user).Error)
		session := model.UserSession{SID: name, UserID: user.Id, Version: 1, UserAuthVersion: 1, Status: model.UserSessionStatusActive, RefreshHash: "unusable", LoginMethod: "test", LastActiveAt: time.Now().Unix(), ExpiresAt: time.Now().Unix() + 3600}
		require.NoError(t, model.CreateUserSession(&session))
		credentials[role], _, err = service.IssueAccessToken(service.AuthIdentity{UserID: user.Id, SessionID: session.SID, UserAuthVersion: 1, SessionVersion: 1})
		require.NoError(t, err)
	}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterRoutes(router.Group("/api"))
	request := func(method, credential, origin, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "http://shop.example/api/extensions/redemption-stores/admin/settings", bytes.NewBufferString(body))
		r.Header.Set("Content-Type", "application/json")
		if credential != "" {
			r.Header.Set("Authorization", "Bearer "+credential)
		}
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, r)
		return response
	}
	for _, role := range []int{0, common.RoleCommonUser, common.RoleAdminUser} {
		for _, method := range []string{"GET", "PUT"} {
			assert.Contains(t, []int{http.StatusUnauthorized, http.StatusForbidden}, request(method, credentials[role], "http://shop.example", `{}`).Code)
		}
	}
	root := credentials[common.RoleRootUser]
	assert.Equal(t, http.StatusOK, request("GET", root, "", "").Code)
	for _, origin := range []string{"", "https://untrusted.example"} {
		assert.Equal(t, http.StatusForbidden, request("PUT", root, origin, `{}`).Code)
	}
	for _, body := range []string{`{`, `{} {}`, strings.Repeat("x", maxSettingsSize+1), `{"stores":[{"id":"bad","name":"bad","url":"javascript:alert(1)"}]}`} {
		assert.Contains(t, request("PUT", root, "http://shop.example", body).Body.String(), `"success":false`)
	}
	response := request("PUT", root, "http://shop.example", `{"revision":0,"enabled":true,"stores":[{"id":"main","name":"Main shop","url":"https://shop.example","enabled":true}]}`)
	assert.Contains(t, response.Body.String(), `"success":true`)
	assert.Contains(t, request("PUT", root, "http://shop.example", `{"revision":0}`).Body.String(), `"success":false`)
	loaded, _, err := readSettings(db)
	require.NoError(t, err)
	assert.True(t, loaded.Enabled)
	assert.Len(t, loaded.Stores, 1)
	assert.Error(t, model.UpdateOption(OptionKey, `{}`), "generic settings cannot bypass validation or revision checks")
}
