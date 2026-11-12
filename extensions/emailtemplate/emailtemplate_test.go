package emailtemplate

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"net/url"
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
	xhtml "golang.org/x/net/html"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func preserveEmailOptions(t *testing.T) {
	t.Helper()
	common.OptionMapRWMutex.Lock()
	previous := common.OptionMap
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previous
		common.OptionMapRWMutex.Unlock()
	})
}

func TestBundledTemplatesRenderAllScenariosAndLanguages(t *testing.T) {
	for _, definition := range catalog() {
		for lang, source := range definition.Defaults {
			t.Run(definition.Type+"/"+lang, func(t *testing.T) {
				compiled, err := compileTemplate(source)
				require.NoError(t, err)
				values := sampleVariables(source.Type, lang)
				subject, body, err := compiled.render(values)
				require.NoError(t, err)
				assert.Equal(t, values["original_subject"], subject)
				assert.Contains(t, body, "Powered by new-api")
				assert.NotContains(t, body, "{{")
				if source.Type == common.EmailTemplateVerification || source.Type == common.EmailTemplateEmailBinding {
					assert.Contains(t, body, values["verification_code"])
					assert.Contains(t, body, values["expires_in_minutes"])
				}
			})
		}
	}
}

func TestTemplatesPreserveCodesExpiryAndResetDestinationsWithContextEscaping(t *testing.T) {
	source := defaultTemplate(common.EmailTemplateVerification, i18n.LangEn)
	compiled, err := compileTemplate(source)
	require.NoError(t, err)
	values := sampleVariables(source.Type, source.Language)
	values["verification_code"], values["expires_in_minutes"] = "048291", "7.5"
	values["site_name"], values["message"] = `<img src=x onerror="alert(1)">`, `<b>Confirm & continue</b>`
	_, body, err := compiled.render(values)
	require.NoError(t, err)
	assert.Contains(t, body, "048291")
	assert.Contains(t, body, "7.5 minutes")
	assert.Contains(t, body, "&lt;img")
	assert.Contains(t, body, "&lt;b&gt;Confirm &amp; continue&lt;/b&gt;")
	assert.NotContains(t, body, "<img")

	source = defaultTemplate(common.EmailTemplatePasswordReset, i18n.LangEn)
	compiled, err = compileTemplate(source)
	require.NoError(t, err)
	values = sampleVariables(source.Type, source.Language)
	values["reset_url"] = "https://site.example/user/reset?" + url.Values{"email": {"mail+tag@example.com"}, "token": {"a+b&c=1"}}.Encode()
	_, body, err = compiled.render(values)
	require.NoError(t, err)
	document, err := xhtml.Parse(strings.NewReader(body))
	require.NoError(t, err)
	links := 0
	var walk func(*xhtml.Node)
	walk = func(node *xhtml.Node) {
		for _, attr := range node.Attr {
			if node.Data == "a" && attr.Key == "href" {
				assert.Equal(t, values["reset_url"], attr.Val)
				parsed, parseErr := url.Parse(attr.Val)
				require.NoError(t, parseErr)
				assert.Equal(t, "mail+tag@example.com", parsed.Query().Get("email"))
				assert.Equal(t, "a+b&c=1", parsed.Query().Get("token"))
				links++
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(document)
	assert.Equal(t, 2, links, "the button and text fallback must retain the same usable link")
	values["reset_url"] = "javascript:alert(1)"
	_, _, err = compiled.render(values)
	assert.Error(t, err)
}

func TestEmailTemplateValidationRejectsUnsafeOrIncompleteEdits(t *testing.T) {
	base := defaultTemplate(common.EmailTemplateVerification, i18n.LangEn)
	for _, tc := range []struct{ name, subject, html string }{
		{"header injection", "Test\r\nBcc: other@example.com", base.HTML},
		{"template expression", base.Subject, base.HTML + `{{printf "%s" .}}`},
		{"unknown variable", base.Subject, base.HTML + `{{private_token}}`},
		{"code in subject", "{{verification_code}}", base.HTML},
		{"missing code", base.Subject, strings.ReplaceAll(base.HTML, "{{verification_code}}", "")},
		{"encoded placeholder", base.Subject, strings.ReplaceAll(base.HTML, "{{verification_code}}", "&#123;&#123;verification_code&#125;&#125;")},
		{"code in comment", base.Subject, strings.ReplaceAll(base.HTML, "{{verification_code}}", "<!--{{verification_code}}-->")},
		{"code in attribute", base.Subject, strings.ReplaceAll(base.HTML, "{{verification_code}}", `<p title="{{verification_code}}">Code</p>`)},
		{"script", base.Subject, base.HTML + `<script>alert(1)</script>`},
		{"inline handler", base.Subject, base.HTML + `<div onclick="alert(1)">x</div>`},
		{"refresh", base.Subject, base.HTML + `<meta http-equiv="refresh" content="0;url=https://example.com">`},
		{"embedded page", base.Subject, base.HTML + `<iframe src="https://example.com"></iframe>`},
		{"form", base.Subject, base.HTML + `<form action="https://example.com"></form>`},
		{"CSS request", base.Subject, base.HTML + `<p style="background:url(https://example.com)">x</p>`},
		{"CSS import", base.Subject, base.HTML + `<style>@import 'https://example.com/style.css';</style>`},
		{"unsafe link", base.Subject, base.HTML + `<a href="javascript:alert(1)">x</a>`},
		{"oversized body", base.Subject, base.HTML + strings.Repeat("x", 48*1024)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := base
			source.Subject, source.HTML = tc.subject, tc.html
			_, err := compileTemplate(source)
			assert.Error(t, err)
		})
	}
	reset := defaultTemplate(common.EmailTemplatePasswordReset, i18n.LangEn)
	reset.HTML = strings.ReplaceAll(reset.HTML, `href="{{reset_url}}"`, `href="https://example.com"`)
	_, err := compileTemplate(reset)
	assert.ErrorIs(t, err, errRequired)
}

func TestNotificationTemplatesKeepBusinessContentAndRemoveActiveMarkup(t *testing.T) {
	source := defaultTemplate(common.EmailTemplateChannel, i18n.LangEn)
	compiled, err := compileTemplate(source)
	require.NoError(t, err)
	values := sampleVariables(source.Type, source.Language)
	values["content"] = `<p>Channel A &amp; B: <strong>disabled</strong></p><a href="https://site.example/channels?id=2&amp;view=all">Details</a><script>attack()</script><img src="https://evil.example/tracker"><p onclick="attack()">Retry later</p><a href="javascript:attack()">Unsafe link</a>`
	_, body, err := compiled.render(values)
	require.NoError(t, err)
	assert.Contains(t, body, `<p>Channel A &amp; B: <strong>disabled</strong></p>`)
	assert.Contains(t, body, `href="https://site.example/channels?id=2&amp;view=all"`)
	assert.Contains(t, body, `<p>Retry later</p>`)
	assert.NotContains(t, body, "attack()")
	assert.NotContains(t, body, "evil.example")
	assert.NotContains(t, body, "onclick")
}

func TestRenderingFallsBackWhenDisabledInvalidOrMissingRequiredData(t *testing.T) {
	preserveEmailOptions(t)
	data := common.EmailTemplateData{Type: common.EmailTemplateVerification, Language: i18n.LangEn, Variables: map[string]string{"verification_code": "048291", "expires_in_minutes": "7.5", "message": "Confirm this operation"}}
	for _, raw := range []string{"", `{"enabled":false,"templates":[]}`, `not json`, `{"enabled":true,"templates":[{"type":"unknown"}]}`} {
		common.OptionMap[common.EmailTemplateOptionKey] = raw
		subject, content := Render("Original subject", "<p>Original body</p>", data)
		assert.Equal(t, "Original subject", subject)
		assert.Equal(t, "<p>Original body</p>", content)
	}
	common.OptionMap[common.EmailTemplateOptionKey] = `{"enabled":true,"templates":[]}`
	_, content := Render("Original subject", "Original body", data)
	assert.Contains(t, content, "048291")
	assert.Contains(t, content, "7.5 minutes")
	delete(data.Variables, "verification_code")
	subject, content := Render("Original subject", "Original body", data)
	assert.Equal(t, "Original subject", subject)
	assert.Equal(t, "Original body", content)
	data.Type = "future-notification"
	_, content = Render("Original subject", "Original body", data)
	assert.Equal(t, "Original body", content)
}

func TestEmailTemplateSettingsPersistenceAcrossDatabases(t *testing.T) {
	preserveEmailOptions(t)
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector = sqlite.Open(t.TempDir() + "/emails.db")
			if dialect != "sqlite" {
				dsn := os.Getenv("EMAIL_TEMPLATE_TEST_" + strings.ToUpper(dialect) + "_DSN")
				if dsn == "" {
					t.Skip("dedicated email template database is not configured")
				}
				require.Contains(t, dsn, "/emailtemplate_test_", "use a dedicated disposable test database")
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
			assert.Empty(t, fresh.Templates)
			require.NoError(t, db.Create(&model.Option{Key: "ExistingNotificationSetting", Value: "kept-existing-value"}).Error)
			source := defaultTemplate(common.EmailTemplateVerification, i18n.LangZhCN)
			source.Subject = "{{site_name}} · 测试验证"
			source.HTML = strings.ReplaceAll(source.HTML, "#5b53f5", "#6258ee")
			saved, err := saveSettings(db, Settings{Enabled: true, Templates: []Template{source}})
			require.NoError(t, err)
			assert.EqualValues(t, 1, saved.Revision)
			_, err = saveSettings(db, Settings{Enabled: false})
			assert.ErrorIs(t, err, errConflict)
			_, err = saveSettings(db, Settings{Revision: saved.Revision, Templates: []Template{source, source}})
			assert.Error(t, err)
			for range 2 {
				// Existing options retain the released schema; repeated startup reads
				// and AutoMigrate must not remove settings or rewrite custom HTML.
				require.NoError(t, db.AutoMigrate(&model.Option{}))
				loaded, raw, loadErr := readSettings(db)
				require.NoError(t, loadErr)
				assert.Equal(t, saved, loaded)
				assert.Equal(t, common.OptionMap[common.EmailTemplateOptionKey], raw)
				var existing model.Option
				require.NoError(t, db.Where("value = ?", "kept-existing-value").Take(&existing).Error)
				assert.Equal(t, "ExistingNotificationSetting", existing.Key)
			}
			saved.Enabled, saved.Templates = false, []Template{}
			restored, err := saveSettings(db, saved)
			require.NoError(t, err)
			assert.EqualValues(t, 2, restored.Revision)
			loaded, _, err := readSettings(db)
			require.NoError(t, err)
			assert.Equal(t, restored, loaded)
		})
	}
}

func TestEmailTemplateAdminPermissionsOriginAndSampleOnlyPreview(t *testing.T) {
	require.NoError(t, i18n.Init())
	preserveEmailOptions(t)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	connection, err := db.DB()
	require.NoError(t, err)
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, connection.Close()) })
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.User{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}))
	previousDB, previousLogs := model.DB, model.LOG_DB
	previousRedis, previousRate, previousSecret := common.RedisEnabled, common.CriticalRateLimitEnable, common.SessionSecret
	previousTrusted := common.SessionCookieTrustedURLs
	model.DB, model.LOG_DB, common.RedisEnabled, common.CriticalRateLimitEnable = db, db, false, false
	common.SessionSecret, common.SessionCookieTrustedURLs = "email-template-test-signing-key", nil
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogs
		common.RedisEnabled, common.CriticalRateLimitEnable, common.SessionSecret = previousRedis, previousRate, previousSecret
		common.SessionCookieTrustedURLs = previousTrusted
	})
	credentials := map[int]string{}
	for _, role := range []int{common.RoleCommonUser, common.RoleAdminUser, common.RoleRootUser} {
		name := "email-template-" + strconv.Itoa(role)
		user := model.User{Username: name, AffCode: name, Role: role, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1}
		require.NoError(t, db.Create(&user).Error)
		session := model.UserSession{SID: user.Username, UserID: user.Id, Version: 1, UserAuthVersion: 1, Status: model.UserSessionStatusActive, RefreshHash: "unusable", LoginMethod: "test", LastActiveAt: time.Now().Unix(), ExpiresAt: time.Now().Unix() + 3600}
		require.NoError(t, model.CreateUserSession(&session))
		credentials[role], _, err = service.IssueAccessToken(service.AuthIdentity{UserID: user.Id, SessionID: session.SID, UserAuthVersion: 1, SessionVersion: 1})
		require.NoError(t, err)
	}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterRoutes(router.Group("/api"))
	request := func(method, path, credential, origin string, body any) *httptest.ResponseRecorder {
		encoded, encodeErr := common.Marshal(body)
		require.NoError(t, encodeErr)
		r := httptest.NewRequest(method, "http://mail.example/api/extensions/email-templates/admin"+path, bytes.NewReader(encoded))
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
		for _, route := range []struct{ method, path string }{{"GET", "/settings"}, {"PUT", "/settings"}, {"POST", "/preview"}} {
			response := request(route.method, route.path, credentials[role], "http://mail.example", Settings{})
			assert.Contains(t, []int{http.StatusUnauthorized, http.StatusForbidden}, response.Code)
		}
	}
	root := credentials[common.RoleRootUser]
	assert.Equal(t, http.StatusOK, request("GET", "/settings", root, "", nil).Code)
	for _, origin := range []string{"", "https://untrusted.example"} {
		assert.Equal(t, http.StatusForbidden, request("PUT", "/settings", root, origin, Settings{}).Code)
		assert.Equal(t, http.StatusForbidden, request("POST", "/preview", root, origin, defaultTemplate(common.EmailTemplateVerification, i18n.LangEn)).Code)
	}
	previewResponse := request("POST", "/preview", root, "http://mail.example", defaultTemplate(common.EmailTemplateVerification, i18n.LangEn))
	require.Equal(t, http.StatusOK, previewResponse.Code)
	assert.Contains(t, previewResponse.Body.String(), `"success":true`)
	assert.Contains(t, previewResponse.Body.String(), "482916")
	assert.False(t, common.VerifyCodeWithKey("preview@example.com", "482916", common.EmailVerificationPurpose))
	var optionsCount int64
	require.NoError(t, db.Model(&model.Option{}).Count(&optionsCount).Error)
	assert.Zero(t, optionsCount, "preview cannot save settings or activate templates")
	response := request("PUT", "/settings", root, "http://mail.example", Settings{Enabled: true})
	assert.Contains(t, response.Body.String(), `"success":true`)
	saved, _, err := readSettings(db)
	require.NoError(t, err)
	assert.True(t, saved.Enabled)
	assert.EqualValues(t, 1, saved.Revision)
	assert.Error(t, model.UpdateOption(common.EmailTemplateOptionKey, `{}`), "generic settings must not bypass validation or revision checks")
	var entries []model.AuditLog
	require.NoError(t, db.Find(&entries).Error)
	encoded, err := common.Marshal(entries)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "482916")
	assert.NotContains(t, string(encoded), "<html")
	assert.NotContains(t, string(encoded), root)
}
