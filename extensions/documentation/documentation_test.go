package documentationcenter

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

func documentationDB(t *testing.T) *gorm.DB {
	t.Helper()
	require.NoError(t, i18n.Init())
	gin.SetMode(gin.TestMode)
	dialect := os.Getenv("DOCUMENTATION_TEST_DIALECT")
	if dialect == "" {
		dialect = "sqlite"
	}
	require.Contains(t, []string{"sqlite", "mysql", "postgres"}, dialect)
	dsn := "local"
	if dialect != "sqlite" {
		dsn = os.Getenv("DOCUMENTATION_TEST_" + strings.ToUpper(dialect) + "_DSN")
		require.Contains(t, dsn, "/documentation_extension_test?", "use an isolated disposable documentation test database")
	}
	oldDB, oldLog, oldType := model.DB, model.LOG_DB, common.MainDatabaseType()
	oldLogType, oldMaster, oldSQLite := common.LogDatabaseType(), common.IsMasterNode, common.SQLitePath
	oldRedis, oldMemory, oldRate := common.RedisEnabled, common.MemoryCacheEnabled, common.CriticalRateLimitEnable
	oldSecret, oldSecure, oldTrusted := common.SessionSecret, common.SessionCookieSecure, common.SessionCookieTrustedURLs
	common.OptionMapRWMutex.Lock()
	oldOptions := common.OptionMap
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()
	common.RedisEnabled, common.MemoryCacheEnabled, common.CriticalRateLimitEnable = false, false, false
	common.SessionSecret, common.SessionCookieSecure, common.SessionCookieTrustedURLs = "documentation-test-secret", false, nil
	t.Setenv("SQL_DSN", dsn)
	t.Setenv("LOG_SQL_DSN", "")
	common.IsMasterNode, common.SQLitePath = false, ":memory:"
	require.NoError(t, model.InitDB())
	db := model.DB.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	model.DB, model.LOG_DB = db, db
	conn, err := db.DB()
	require.NoError(t, err)
	conn.SetMaxOpenConns(1)
	t.Cleanup(func() {
		require.NoError(t, conn.Close())
		model.DB, model.LOG_DB = oldDB, oldLog
		common.SetMainDatabaseType(oldType)
		common.SetLogDatabaseType(oldLogType)
		common.IsMasterNode, common.SQLitePath = oldMaster, oldSQLite
		common.RedisEnabled, common.MemoryCacheEnabled, common.CriticalRateLimitEnable = oldRedis, oldMemory, oldRate
		common.SessionSecret, common.SessionCookieSecure, common.SessionCookieTrustedURLs = oldSecret, oldSecure, oldTrusted
		common.OptionMapRWMutex.Lock()
		common.OptionMap = oldOptions
		common.OptionMapRWMutex.Unlock()
	})
	// The extension owns no schema; this is the released host Option layout
	// plus the unchanged host authentication tables used by endpoint tests.
	tables := []any{&model.Option{}, &model.User{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}}
	for _, table := range tables {
		require.NoError(t, db.Migrator().DropTable(table))
	}
	require.NoError(t, db.AutoMigrate(tables...))
	var version string
	query := "SELECT sqlite_version()"
	if dialect != "sqlite" {
		query = "SELECT version()"
	}
	require.NoError(t, db.Raw(query).Scan(&version).Error)
	t.Logf("database: %s %s", dialect, version)
	return db
}

func documentationUser(t *testing.T, db *gorm.DB, name string, role int) (model.User, string) {
	t.Helper()
	user := model.User{Username: name, AffCode: name, Role: role, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1}
	require.NoError(t, db.Create(&user).Error)
	session := model.UserSession{SID: "documentation-" + name, UserID: user.Id, Version: 1, UserAuthVersion: 1, Status: model.UserSessionStatusActive, RefreshHash: "unusable", LoginMethod: "password", LastActiveAt: time.Now().Unix(), ExpiresAt: time.Now().Unix() + 3600}
	require.NoError(t, model.CreateUserSession(&session))
	raw, _, err := service.IssueAccessToken(service.AuthIdentity{UserID: user.Id, SessionID: session.SID, UserAuthVersion: 1, SessionVersion: 1})
	require.NoError(t, err)
	return user, raw
}

func TestDocumentationPublishedExamples(t *testing.T) {
	db := documentationDB(t)
	require.NoError(t, Migrate(db))
	oldURL := system_setting.ServerAddress
	system_setting.ServerAddress = "https://configured.example/"
	t.Cleanup(func() { system_setting.ServerAddress = oldURL })
	router := gin.New()
	RegisterRoutes(router.Group("/api"))
	for _, tc := range []struct {
		path string
		want []string
	}{
		{"/articles/quick-start/markdown", []string{"https://configured.example/v1/chat/completions"}},
		{"/articles/protocols/markdown", []string{
			"POST https://configured.example/v1/chat/completions",
			"POST https://configured.example/v1/responses",
			"POST https://configured.example/v1/messages",
			"POST https://configured.example/v1beta/models/YOUR_MODEL_ID:generateContent",
		}},
		{"/articles/openai-sdk/markdown", []string{
			`base_url="https://configured.example/v1"`,
			"baseURL: 'https://configured.example/v1'",
		}},
		{"/articles/anthropic-sdk/markdown", []string{
			`base_url="https://configured.example"`,
			"baseURL: 'https://configured.example'",
		}},
		{"/llms-full.txt", []string{"Source: https://configured.example/docs/guides/quick-start"}},
	} {
		t.Run(tc.path, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "http://attacker.example/api/extensions/docs"+tc.path, nil)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			require.Equal(t, http.StatusOK, response.Code)
			body := response.Body.String()
			for _, want := range tc.want {
				assert.Contains(t, body, want)
			}
			assert.NotContains(t, body, "https://configured.example/v1/v1", "published examples must not append another API version")
			assert.NotContains(t, body, "{{site_url}}")
			assert.NotContains(t, body, "{{api_base_url}}")
			assert.NotContains(t, body, "attacker.example")
		})
	}
}

func TestDocumentationStorageAndPublication(t *testing.T) {
	db := documentationDB(t)
	require.NoError(t, db.Create(&model.Option{Key: "existing-site-option", Value: "保留已有站点设置"}).Error)
	require.NoError(t, Migrate(db))
	seeded, rawSeed, err := readSettings(db)
	require.NoError(t, err)
	assert.True(t, seeded.Enabled)
	assert.NotEmpty(t, seeded.Articles)
	require.NoError(t, Migrate(db))
	_, repeatedSeed, err := readSettings(db)
	require.NoError(t, err)
	assert.Equal(t, rawSeed, repeatedSeed, "restarting must not rewrite publication times")
	s := Settings{Revision: seeded.Revision, Enabled: true, Title: "{{site_name}} 文档", Description: "接入指南", Categories: []Category{
		{ID: "later", Title: "进阶", SortOrder: 20},
		{ID: "first", Title: "入门", SortOrder: 10},
		{ID: "drafts", Title: "未公开分类", SortOrder: 30},
	}, Articles: []Article{
		{ID: "third", CategoryID: "later", Slug: "third", Title: "进阶排查", Content: "第三篇操作说明", Status: "published", SortOrder: 1},
		{ID: "draft", CategoryID: "drafts", Slug: "private-draft", Title: "Private-only title", Content: "private-only body secret", Status: "draft", SortOrder: 1},
		{ID: "second", CategoryID: "first", Slug: "second", Title: "第二篇说明", Content: "这是中文全文检索关键词的使用说明。", Status: "published", SortOrder: 20},
		{ID: "first", CategoryID: "first", Slug: "first", Title: "{{site_name}} 快速接入", Description: "设置 API 地址", Content: "# 接入\n\n{{site_url}} {{api_base_url}} first-body", Status: "published", SortOrder: 10, UpdatedAt: math.MaxInt64},
	}}
	saved, err := saveSettings(db, s)
	require.NoError(t, err)
	assert.EqualValues(t, 1, saved.Revision)
	assert.InDelta(t, time.Now().Unix(), saved.Articles[3].UpdatedAt, 5, "clients cannot forge publication timestamps")
	_, err = saveSettings(db, s)
	assert.ErrorIs(t, err, errConflict, "a stale tab must not overwrite a newer catalog")
	assert.Error(t, model.UpdateOption(OptionKey, "{}"), "generic options cannot bypass validation or CAS")
	loaded, raw, err := readSettings(db)
	require.NoError(t, err)
	assert.Equal(t, saved, loaded)
	require.NoError(t, Migrate(db))
	require.NoError(t, Migrate(db))
	_, migratedRaw, err := readSettings(db)
	require.NoError(t, err)
	assert.Equal(t, raw, migratedRaw, "upgrades must not restore edited or deleted seed articles")
	var existing model.Option
	require.NoError(t, db.Where(clause.Eq{Column: "key", Value: "existing-site-option"}).Take(&existing).Error)
	assert.Equal(t, "保留已有站点设置", existing.Value)
	assert.Error(t, db.Create(&model.Option{Key: "existing-site-option", Value: "overwrite"}).Error, "host option primary-key uniqueness survives migration")
	oldName, oldURL := common.SystemName, system_setting.ServerAddress
	common.SystemName, system_setting.ServerAddress = "测试站", "https://configured.example/"
	t.Cleanup(func() { common.SystemName, system_setting.ServerAddress = oldName, oldURL })
	router := gin.New()
	RegisterRoutes(router.Group("/api"))
	router.GET("/llms-full.txt", ExportLLMs)
	request := func(path string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "http://attacker.example"+path, nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	w := request("/api/extensions/docs")
	require.Equal(t, 200, w.Code)
	assert.Contains(t, w.Header().Get("Cache-Control"), "no-store")
	assert.NotContains(t, w.Body.String(), "private-only")
	assert.NotContains(t, w.Body.String(), "first-body", "catalog metadata must not include content")
	var catalog struct {
		Data struct {
			Title      string            `json:"title"`
			Categories []Category        `json:"categories"`
			Articles   []ArticleMetadata `json:"articles"`
			Variables  map[string]string `json:"variables"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(w.Body.Bytes(), &catalog))
	assert.Equal(t, "测试站 文档", catalog.Data.Title)
	require.Len(t, catalog.Data.Categories, 2)
	assert.Equal(t, "first", catalog.Data.Categories[0].ID)
	require.Len(t, catalog.Data.Articles, 3)
	assert.Equal(t, []string{"first", "second", "third"}, []string{catalog.Data.Articles[0].Slug, catalog.Data.Articles[1].Slug, catalog.Data.Articles[2].Slug})
	assert.Equal(t, "https://configured.example/v1", catalog.Data.Variables["api_base_url"])
	w = request("/api/extensions/docs/articles/second")
	var detail struct {
		Data struct {
			Article  Article          `json:"article"`
			Previous *ArticleMetadata `json:"previous"`
			Next     *ArticleMetadata `json:"next"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(w.Body.Bytes(), &detail))
	assert.Equal(t, "second", detail.Data.Article.ID)
	require.NotNil(t, detail.Data.Previous)
	require.NotNil(t, detail.Data.Next)
	assert.Equal(t, "first", detail.Data.Previous.Slug)
	assert.Equal(t, "third", detail.Data.Next.Slug)
	for _, path := range []string{"/api/extensions/docs/articles/private-draft", "/api/extensions/docs/articles/private-draft/markdown", "/api/extensions/docs/articles/missing"} {
		w = request(path)
		assert.Equal(t, 404, w.Code, path)
		assert.NotContains(t, w.Body.String(), "secret")
	}
	for _, path := range []string{"/api/extensions/docs/articles/first/markdown", "/api/extensions/docs/llms-full.txt", "/llms-full.txt"} {
		w = request(path)
		assert.Equal(t, 200, w.Code, path)
		assert.Equal(t, "text/plain; charset=utf-8", w.Header().Get("Content-Type"))
		assert.Equal(t, "nosniff", w.Header().Get("X-Content-Type-Options"))
		assert.Contains(t, w.Body.String(), "https://configured.example/v1")
		assert.NotContains(t, w.Body.String(), "attacker.example")
		assert.NotContains(t, w.Body.String(), "private-only")
		assert.NotContains(t, w.Body.String(), "{{site_url}}")
	}
	w = request("/api/extensions/docs/search?q=" + url.QueryEscape("全文检索关键词"))
	assert.Contains(t, w.Body.String(), `"slug":"second"`)
	assert.Contains(t, w.Body.String(), `"excerpt":`)
	w = request("/api/extensions/docs/search?q=private-only")
	assert.Contains(t, w.Body.String(), `"data":[]`)
	w = request("/api/extensions/docs/search?q=" + strings.Repeat("a", 121))
	assert.Contains(t, w.Body.String(), `"success":false`)
	w = request("/api/extensions/docs/search?q=")
	assert.Contains(t, w.Body.String(), `"data":[]`)
	// Disabling hides every public entry, including exports mounted outside the
	// extension group, while the persisted catalog remains intact.
	saved.Enabled = false
	saved, err = saveSettings(db, saved)
	require.NoError(t, err)
	for _, path := range []string{"/api/extensions/docs", "/api/extensions/docs/articles/first", "/api/extensions/docs/articles/first/markdown", "/api/extensions/docs/search?q=first", "/api/extensions/docs/llms-full.txt", "/llms-full.txt"} {
		w = request(path)
		assert.Equal(t, 404, w.Code, path)
		assert.NotContains(t, w.Body.String(), "first-body")
	}
	// Intentionally deleting every article remains empty after restarting.
	saved.Articles, saved.Categories = nil, nil
	saved, err = saveSettings(db, saved)
	require.NoError(t, err)
	require.NoError(t, Migrate(db))
	require.NoError(t, Migrate(db))
	loaded, _, err = readSettings(db)
	require.NoError(t, err)
	assert.Equal(t, saved, loaded)
	assert.Empty(t, loaded.Articles)
}

func TestDocumentationValidationAndTimestamps(t *testing.T) {
	db := documentationDB(t)
	s := Settings{Enabled: true, Title: "文档", Categories: []Category{{ID: "guide", Title: "指南"}}, Articles: []Article{{ID: "start", CategoryID: "guide", Slug: "start", Title: "开始", Content: "原始正文", Status: "published", UpdatedAt: 1700000000}}}
	encoded, err := common.Marshal(s)
	require.NoError(t, err)
	require.NoError(t, db.Create(&model.Option{Key: OptionKey, Value: string(encoded)}).Error)
	unchanged, err := saveSettings(db, s)
	require.NoError(t, err)
	assert.EqualValues(t, 1700000000, unchanged.Articles[0].UpdatedAt)
	unchanged.Articles[0].Content = "编辑后的正文"
	unchanged.Articles[0].UpdatedAt = math.MaxInt64
	updated, err := saveSettings(db, unchanged)
	require.NoError(t, err)
	assert.InDelta(t, time.Now().Unix(), updated.Articles[0].UpdatedAt, 5)
	for _, tc := range []struct {
		name   string
		change func(*Settings)
	}{
		{"duplicate category", func(s *Settings) { s.Categories = append(s.Categories, s.Categories[0]) }},
		{"duplicate article", func(s *Settings) { s.Articles = append(s.Articles, s.Articles[0]) }},
		{"duplicate slug", func(s *Settings) { other := s.Articles[0]; other.ID = "other"; s.Articles = append(s.Articles, other) }},
		{"missing category", func(s *Settings) { s.Articles[0].CategoryID = "missing" }},
		{"unsafe download name", func(s *Settings) { s.Articles[0].Slug = "../bad\r\nX-Header: injected" }},
		{"unknown status", func(s *Settings) { s.Articles[0].Status = "unlisted" }},
		{"empty publication", func(s *Settings) { s.Articles[0].Content = " " }},
		{"oversized article", func(s *Settings) { s.Articles[0].Content = strings.Repeat("x", maxArticleSize+1) }},
		{"negative order", func(s *Settings) { s.Articles[0].SortOrder = -1 }},
		{"revision overflow", func(s *Settings) { s.Revision = math.MaxInt64 }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			candidate, _, err := readSettings(db)
			require.NoError(t, err)
			tc.change(&candidate)
			_, err = saveSettings(db, candidate)
			assert.ErrorIs(t, err, errInvalid)
		})
	}
	loaded, _, err := readSettings(db)
	require.NoError(t, err)
	assert.Equal(t, updated, loaded, "invalid edits must be atomic and leave the catalog untouched")
	// Option values hold the entire catalog, so verify near-limit storage and
	// Unicode content against the real dialect instead of relying on its type.
	loaded.Articles = []Article{}
	largeBody := strings.Repeat("文档", 20000)
	for i := range 34 {
		id := fmt.Sprintf("large-%d", i)
		loaded.Articles = append(loaded.Articles, Article{ID: id, CategoryID: "guide", Slug: id, Title: "完整中文指南", Content: largeBody, Status: "published"})
	}
	large, err := saveSettings(db, loaded)
	require.NoError(t, err)
	roundTrip, _, err := readSettings(db)
	require.NoError(t, err)
	assert.Equal(t, large, roundTrip, "a near-4MiB catalog must round-trip without truncation")
	loaded = roundTrip
	loaded.Articles = append(loaded.Articles, Article{ID: "too-large", CategoryID: "guide", Slug: "too-large", Title: "超过总限制", Content: largeBody, Status: "published"})
	_, err = saveSettings(db, loaded)
	assert.ErrorIs(t, err, errInvalid, "the serialized catalog size is bounded independently of each article")
}

func TestDocumentationAdminAuthorizationAndOrigin(t *testing.T) {
	db := documentationDB(t)
	require.NoError(t, Migrate(db))
	require.NoError(t, model.EnsureLegacyAccessTokenRetireAt(time.Now().Unix()))
	rootUser, root := documentationUser(t, db, "docs-root", common.RoleRootUser)
	_, admin := documentationUser(t, db, "docs-admin", common.RoleAdminUser)
	_, normal := documentationUser(t, db, "docs-user", common.RoleCommonUser)
	_, expired := documentationUser(t, db, "docs-expired", common.RoleRootUser)
	require.NoError(t, db.Model(&model.UserSession{}).Where("sid = ?", "documentation-docs-expired").Update("expires_at", time.Now().Unix()-1).Error)
	revokedUser, revoked := documentationUser(t, db, "docs-revoked", common.RoleRootUser)
	_, err := model.RevokeUserSession(revokedUser.Id, "documentation-docs-revoked", "test")
	require.NoError(t, err)
	patRaw := "nap_documentation_test"
	hash := sha256.Sum256([]byte(patRaw))
	require.NoError(t, db.Create(&model.UserAccessToken{UserId: rootUser.Id, Name: "automation", TokenHash: hex.EncodeToString(hash[:]), TokenHint: "test", Scopes: `["option:read","option:write"]`, ExpiresAt: time.Now().Unix() + 3600}).Error)
	router := gin.New()
	RegisterRoutes(router.Group("/api"))
	for _, route := range router.Routes() {
		if !strings.Contains(route.Path, "/admin/") {
			continue
		}
		rule, ok := middleware.AccessTokenRouteRule(route.Method + " " + route.Path)
		require.True(t, ok)
		assert.Equal(t, "session", rule.Kind())
	}
	s, _, err := readSettings(db)
	require.NoError(t, err)
	encoded, err := common.Marshal(s)
	require.NoError(t, err)
	request := func(method, token, origin string, body []byte) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "http://docs.example/api/extensions/docs/admin/settings", bytes.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	for _, tc := range []struct {
		method, token, origin string
		status                int
	}{
		{"GET", "", "", 401},
		{"GET", normal, "", 403},
		{"GET", admin, "", 403},
		{"GET", expired, "", 401},
		{"GET", revoked, "", 401},
		{"GET", patRaw, "", 403},
		{"GET", root, "", 200},
		{"PUT", admin, "http://docs.example", 403},
		{"PUT", root, "", 403},
		{"PUT", root, "http://evil.example", 403},
		{"PUT", root, "null", 403},
		{"PUT", root, "http://docs.example.evil.example", 403},
	} {
		w := request(tc.method, tc.token, tc.origin, encoded)
		assert.Equal(t, tc.status, w.Code, tc.method+" "+tc.origin)
	}
	w := request("GET", root, "", nil)
	assert.Contains(t, w.Header().Get("Cache-Control"), "no-store")
	assert.Contains(t, w.Body.String(), `"revision":0`)
	w = request("PUT", root, "http://docs.example", encoded)
	assert.Contains(t, w.Body.String(), `"success":true`)
	w = request("PUT", root, "http://docs.example", encoded)
	assert.Contains(t, w.Body.String(), `"success":false`)
	assert.Contains(t, w.Body.String(), "Reload before saving")
	w = request("PUT", root, "http://docs.example", append(encoded, []byte(` {"enabled":false}`)...))
	assert.Contains(t, w.Body.String(), "Invalid documentation settings", "concatenated JSON documents are rejected")
	w = request("PUT", root, "http://docs.example", []byte(strings.Repeat("x", maxSettingsSize+1)))
	assert.Contains(t, w.Body.String(), "Invalid documentation settings", "request bodies are bounded before decoding")
}
