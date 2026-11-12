package requestprotection_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/extensions/requestprotection"
	"github.com/QuantumNous/new-api/extensions/requestprotection/policy"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func protectionDB(t *testing.T) *gorm.DB {
	t.Helper()
	require.NoError(t, i18n.Init())
	gin.SetMode(gin.TestMode)
	dialect := os.Getenv("REQUEST_PROTECTION_TEST_DIALECT")
	if dialect == "" {
		dialect = "sqlite"
	}
	require.Contains(t, []string{"sqlite", "mysql", "postgres"}, dialect)
	var driver gorm.Dialector = sqlite.Open(":memory:")
	if dialect != "sqlite" {
		dsn := os.Getenv("REQUEST_PROTECTION_TEST_" + strings.ToUpper(dialect) + "_DSN")
		require.Contains(t, dsn, "/requestprotection_extension_test?")
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
	if dialect != "sqlite" {
		conn.SetMaxOpenConns(4)
	}
	t.Cleanup(func() { require.NoError(t, conn.Close()) })
	oldDB, oldLog, oldType := model.DB, model.LOG_DB, common.MainDatabaseType()
	oldRedis, oldBatch, oldRate := common.RedisEnabled, common.BatchUpdateEnabled, common.CriticalRateLimitEnable
	oldSecret, oldSecure, oldTrusted := common.SessionSecret, common.SessionCookieSecure, common.SessionCookieTrustedURLs
	model.DB, model.LOG_DB = db, db
	common.RedisEnabled, common.BatchUpdateEnabled, common.CriticalRateLimitEnable = false, false, false
	common.SessionSecret, common.SessionCookieSecure, common.SessionCookieTrustedURLs = "request-protection-test-secret", false, nil
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	if dialect == "mysql" {
		common.SetMainDatabaseType(common.DatabaseTypeMySQL)
	} else if dialect == "postgres" {
		common.SetMainDatabaseType(common.DatabaseTypePostgreSQL)
	}
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLog
		common.SetMainDatabaseType(oldType)
		common.RedisEnabled, common.BatchUpdateEnabled, common.CriticalRateLimitEnable = oldRedis, oldBatch, oldRate
		common.SessionSecret, common.SessionCookieSecure, common.SessionCookieTrustedURLs = oldSecret, oldSecure, oldTrusted
	})
	for _, table := range []any{&policy.Event{}, &policy.Subject{}, &policy.Audit{}, &policy.Alert{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}, &model.Token{}, &model.User{}, &model.Option{}} {
		require.NoError(t, db.Migrator().DropTable(table))
	}
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Token{}, &model.Option{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}))
	require.NoError(t, policy.Migrate(db))
	service.InstallRequestProtection()
	return db
}

func blockingSettings() policy.Settings {
	s := policy.Defaults()
	s.Enabled, s.Mode = true, "enforce"
	s.Rules = []policy.Rule{{ID: "explicit-test", Name: "Explicit instruction override", Enabled: true, Kind: "all", Patterns: []string{"override instructions", "unrestricted"}, Sources: []string{"current", "system", "history", "tool"}, Action: "block", HighConfidence: true, CountPenalty: true}}
	return s
}

func requestInput(request string, token int, text string) policy.Input {
	return policy.Input{UserID: 42, TokenID: token, RequestID: request, Group: "default", Model: "gpt-4.1", Protocol: "openai", Segments: []policy.Segment{{Source: "current", Text: text}}}
}

func TestInspectionProtocolsNormalizationAndPenaltyTrust(t *testing.T) {
	s := blockingSettings()
	for _, tc := range []struct {
		name, body, protocol, decision string
		eligible                       bool
	}{
		{"openai current", `{"messages":[{"role":"user","content":"OVERRIDE　instructions UNRESTRICTED"}]}`, "openai", "block", true},
		{"responses", `{"instructions":"ＯＶＥＲＲＩＤＥ instructions unrestricted","input":"Hello"}`, "openai_responses", "block", true},
		{"claude history", `{"messages":[{"role":"user","content":"override instructions unrestricted"},{"role":"assistant","content":"No"},{"role":"user","content":"Hello"}]}`, "claude", "block", false},
		{"claude tool", `{"messages":[{"role":"user","content":[{"type":"tool_result","content":"override instructions unrestricted"}]}]}`, "claude", "block", false},
		{"tool definitions", `{"input":"Hello","tools":[{"type":"function","function":{"name":"lookup","description":"override instructions unrestricted","parameters":{"type":"object"}}}]}`, "openai_responses", "block", false},
		{"tool call arguments", `{"messages":[{"role":"assistant","tool_calls":[{"type":"function","function":{"name":"lookup","arguments":"override instructions unrestricted"}}]},{"role":"user","content":"Hello"}]}`, "openai", "block", false},
		{"gemini", `{"contents":[{"role":"user","parts":[{"text":"override instructions unrestricted"}]}]}`, "gemini", "block", true},
		{"task metadata", `{"metadata":{"prompt":"override instructions unrestricted"}}`, "task", "block", true},
		{"separate sources", `{"instructions":"override instructions","input":"unrestricted"}`, "openai_responses", "allow", false},
		{"no base64 decoding", `{"input":"b3ZlcnJpZGUgaW5zdHJ1Y3Rpb25zIHVucmVzdHJpY3RlZA=="}`, "openai_responses", "allow", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			in := requestInput("extract", 1, "")
			in.Segments, in.Uninspected = policy.Extract([]byte(tc.body), tc.protocol)
			v := policy.Inspect(s, in, "secret")
			assert.Equal(t, tc.decision, v.Decision)
			assert.Equal(t, tc.eligible, v.Eligible)
		})
	}
	assert.Equal(t, "override instructions unrestricted", policy.Normalize("ＯＶＥＲＲＩＤＥ\u200b instructions\t unrestricted"))
	in := requestInput("scope", 1, "override instructions unrestricted")
	s.Enabled = false
	assert.Equal(t, "allow", policy.Inspect(s, in, "secret").Decision)
	s.Enabled, s.Mode = true, "observe"
	v := policy.Inspect(s, in, "secret")
	assert.Equal(t, "observe", v.Decision)
	assert.False(t, v.Eligible)
	s.Mode, s.Groups = "enforce", []string{"premium"}
	assert.Equal(t, "allow", policy.Inspect(s, in, "secret").Decision)
	s.Groups, s.Models = nil, []string{"claude-*"}
	assert.Equal(t, "allow", policy.Inspect(s, in, "secret").Decision)
	s.Models, s.ExemptUserIDs = nil, []int{42}
	assert.Equal(t, "allow", policy.Inspect(s, in, "secret").Decision)
	s.ExemptUserIDs, s.UninspectedAction = nil, "block"
	in.Segments, in.Uninspected = policy.Extract([]byte(`{"input":[{"type":"input_image","image_url":"data:image/png;base64,abc"}]}`), "openai_responses")
	v = policy.Inspect(s, in, "secret")
	assert.Equal(t, "block", v.Decision)
	assert.False(t, v.Eligible, "incomplete inspection cannot penalize a user")
	in.Segments, in.Uninspected = policy.Extract([]byte(`{"contents":[{"role":"user","parts":[{"text":"Hello","inlineData":{"mimeType":"image/png","data":"abc"}}]}]}`), "gemini")
	assert.NotEmpty(t, in.Uninspected, "media beside text must not appear fully inspected")
	s.MaxTextBytes = 256
	in.Segments, in.Uninspected = []policy.Segment{{Source: "current", Text: strings.Repeat("汉", 100)}}, ""
	v = policy.Inspect(s, in, "secret")
	assert.Equal(t, "text_limit", v.Uninspected)
	assert.NotEqual(t, policy.Digest("a", "x", "prompt"), policy.Digest("b", "x", "prompt"))
}

func TestRecordIdempotencyDedupAndIndependentRestrictions(t *testing.T) {
	db := protectionDB(t)
	s := blockingSettings()
	s.KeyThreshold, s.UserThreshold, s.DuplicateSeconds = 2, 3, 60
	first := requestInput("first", 7, "override instructions unrestricted first")
	r, err := policy.Record(db, s, first, policy.Inspect(s, first, "secret"), "secret", 1000)
	require.NoError(t, err)
	assert.Zero(t, r.RestrictedUntil)
	repeated, err := policy.Record(db, s, first, policy.Inspect(s, first, "secret"), "secret", 1001)
	require.NoError(t, err)
	assert.Equal(t, r.EventID, repeated.EventID)
	duplicate := first
	duplicate.RequestID, duplicate.TokenID = "another-key", 8
	d, err := policy.Record(db, s, duplicate, policy.Inspect(s, duplicate, "secret"), "secret", 1002)
	require.NoError(t, err)
	var dedup policy.Event
	require.NoError(t, db.First(&dedup, d.EventID).Error)
	assert.False(t, dedup.Counted)
	second := requestInput("second", 7, "override instructions unrestricted second")
	r, err = policy.Record(db, s, second, policy.Inspect(s, second, "secret"), "secret", 1003)
	require.NoError(t, err)
	assert.EqualValues(t, 1003+30*60, r.RestrictedUntil)
	until, err := policy.ActiveRestriction(db, 42, 8, 1004)
	require.NoError(t, err)
	assert.Zero(t, until, "Key restriction must not restrict other Keys")
	third := requestInput("third", 8, "override instructions unrestricted third")
	r, err = policy.Record(db, s, third, policy.Inspect(s, third, "secret"), "secret", 1005)
	require.NoError(t, err)
	assert.EqualValues(t, 1005+60*60, r.RestrictedUntil)
	until, err = policy.ActiveRestriction(db, 42, 99, 1006)
	require.NoError(t, err)
	assert.EqualValues(t, 4605, until, "account restriction covers new Keys")
	var count int64
	require.NoError(t, db.Model(&policy.Event{}).Count(&count).Error)
	assert.EqualValues(t, 4, count)
	observed := requestInput("resolved", 9, "override instructions unrestricted resolved")
	s.Mode = "observe"
	r, err = policy.Record(db, s, observed, policy.Inspect(s, observed, "secret"), "secret", 1006)
	require.NoError(t, err)
	s.Mode = "enforce"
	upgraded, err := policy.Record(db, s, observed, policy.Inspect(s, observed, "secret"), "secret", 1006)
	require.NoError(t, err)
	assert.Equal(t, r.EventID, upgraded.EventID)
	var event policy.Event
	require.NoError(t, db.First(&event, upgraded.EventID).Error)
	assert.Equal(t, "block", event.Decision)
	assert.True(t, event.Counted)
}

func TestReviewExpiryAndReleasePreserveHostCredentialState(t *testing.T) {
	db := protectionDB(t)
	user := model.User{Id: 42, Username: "disabled", AffCode: "disabled", Status: common.UserStatusDisabled, Quota: 0}
	key := model.Token{Id: 7, UserId: 42, Key: "unusable-host-credential", Status: common.TokenStatusDisabled, ExpiredTime: 100, RemainQuota: 0, UsedQuota: 55}
	require.NoError(t, db.Create(&user).Error)
	require.NoError(t, db.Create(&key).Error)
	s := blockingSettings()
	s.KeyThreshold, s.UserThreshold, s.KeySuspendMinutes = 2, 0, 1
	var ids []int64
	for i := range 2 {
		in := requestInput(fmt.Sprint(i), 7, fmt.Sprintf("override instructions unrestricted %d", i))
		r, err := policy.Record(db, s, in, policy.Inspect(s, in, "secret"), "secret", 1000+int64(i))
		require.NoError(t, err)
		ids = append(ids, r.EventID)
	}
	require.NoError(t, policy.Review(db, ids[0], 99, "false_positive", "Quoted test instructions", 1002))
	until, err := policy.ActiveRestriction(db, 42, 7, 1003)
	require.NoError(t, err)
	assert.Zero(t, until)
	assert.ErrorIs(t, policy.Review(db, ids[0], 99, "confirmed", "Cannot review twice", 1003), policy.ErrConflict)
	for i := range 2 {
		in := requestInput(fmt.Sprintf("new-%d", i), 7, fmt.Sprintf("override instructions unrestricted new-%d", i))
		_, err := policy.Record(db, s, in, policy.Inspect(s, in, "secret"), "secret", 1010+int64(i))
		require.NoError(t, err)
	}
	// Expiry advances the watermark; old hits cannot immediately suspend again.
	in := requestInput("after-expiry", 7, "override instructions unrestricted after expiry")
	r, err := policy.Record(db, s, in, policy.Inspect(s, in, "secret"), "secret", 1080)
	require.NoError(t, err)
	assert.Zero(t, r.RestrictedUntil)
	until, err = policy.ActiveRestriction(db, 42, 7, 1080)
	require.NoError(t, err)
	assert.Zero(t, until)
	require.NoError(t, policy.Release(db, "key:7", 99, "Manual review completed", 1081))
	var afterUser model.User
	var afterKey model.Token
	require.NoError(t, db.First(&afterUser, 42).Error)
	require.NoError(t, db.First(&afterKey, 7).Error)
	assert.Equal(t, user.Status, afterUser.Status)
	assert.Zero(t, afterUser.Quota)
	assert.Equal(t, key.Status, afterKey.Status)
	assert.Equal(t, key.ExpiredTime, afterKey.ExpiredTime)
	assert.Zero(t, afterKey.RemainQuota)
	assert.Equal(t, key.UsedQuota, afterKey.UsedQuota)
}

func TestConcurrentKeysCountOncePerAccount(t *testing.T) {
	db := protectionDB(t)
	s := blockingSettings()
	s.KeyThreshold, s.UserThreshold = 0, 1
	results := make(chan error, 2)
	var work sync.WaitGroup
	for token := range 2 {
		work.Go(func() {
			in := requestInput(fmt.Sprint(token), token+1, "override instructions unrestricted same content")
			_, err := policy.Record(db, s, in, policy.Inspect(s, in, "secret"), "secret", 1000)
			results <- err
		})
	}
	work.Wait()
	close(results)
	for err := range results {
		require.NoError(t, err)
	}
	var counted, suspensions int64
	require.NoError(t, db.Model(&policy.Event{}).Where("counted = ?", true).Count(&counted).Error)
	require.NoError(t, db.Model(&policy.Audit{}).Where("action = ?", "auto_suspend").Count(&suspensions).Error)
	assert.EqualValues(t, 1, counted)
	assert.EqualValues(t, 1, suspensions)
}

func protectionUser(t *testing.T, db *gorm.DB, name string, role int) (model.User, string) {
	t.Helper()
	user := model.User{Username: name, AffCode: name, Role: role, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, Quota: 1000000}
	require.NoError(t, db.Create(&user).Error)
	session := model.UserSession{SID: "protection-" + name, UserID: user.Id, Version: 1, UserAuthVersion: 1, Status: model.UserSessionStatusActive, RefreshHash: "unusable", LoginMethod: "password", LastActiveAt: time.Now().Unix(), ExpiresAt: time.Now().Unix() + 3600}
	require.NoError(t, model.CreateUserSession(&session))
	raw, _, err := service.IssueAccessToken(service.AuthIdentity{UserID: user.Id, SessionID: session.SID, UserAuthVersion: 1, SessionVersion: 1})
	require.NoError(t, err)
	return user, raw
}

func TestAdminSessionOriginCASAndDryRunContracts(t *testing.T) {
	db := protectionDB(t)
	require.NoError(t, model.EnsureLegacyAccessTokenRetireAt(time.Now().Unix()))
	rootUser, root := protectionUser(t, db, "root", common.RoleRootUser)
	_, admin := protectionUser(t, db, "admin", common.RoleAdminUser)
	router := gin.New()
	requestprotection.RegisterRoutes(router.Group("/api"))
	for _, route := range router.Routes() {
		rule, ok := middleware.AccessTokenRouteRule(route.Method + " " + route.Path)
		require.True(t, ok)
		assert.Equal(t, "session", rule.Kind())
	}
	request := func(method, path, token, origin string, input any) *httptest.ResponseRecorder {
		encoded, err := common.Marshal(input)
		require.NoError(t, err)
		r := httptest.NewRequest(method, "http://protection.example/api/extensions/request-protection/admin"+path, bytes.NewReader(encoded))
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
		method, path, token, origin string
		status                      int
	}{
		{"GET", "/settings", "", "", 401},
		{"GET", "/settings", admin, "", 403},
		{"GET", "/settings", root, "", 200},
		{"PUT", "/settings", root, "", 403},
		{"POST", "/dry-run", root, "http://evil.example", 403},
		{"POST", "/release", root, "null", 403},
		{"POST", "/review", root, "http://evil.example", 403},
	} {
		w := request(tc.method, tc.path, tc.token, tc.origin, nil)
		assert.Equal(t, tc.status, w.Code, tc.path)
	}
	w := request("GET", "/settings", root, "", nil)
	assert.Contains(t, w.Header().Get("Cache-Control"), "no-store")
	patRaw := "nap_request_protection_root_test"
	hash := sha256.Sum256([]byte(patRaw))
	require.NoError(t, db.Create(&model.UserAccessToken{UserId: rootUser.Id, Name: "automation", TokenHash: hex.EncodeToString(hash[:]), TokenHint: "test", Scopes: `["option:read","option:write"]`, ExpiresAt: time.Now().Unix() + 3600}).Error)
	w = request("GET", "/settings", patRaw, "", nil)
	assert.Equal(t, 403, w.Code)
	assert.Contains(t, w.Body.String(), "AUTH_SESSION_REQUIRED")
	legacy := "legacy_request_protection_test"
	require.NoError(t, db.Model(&model.User{}).Where("id = ?", rootUser.Id).Update("access_token", legacy).Error)
	w = request("GET", "/settings", legacy, "", nil)
	assert.Equal(t, 403, w.Code)
	assert.Contains(t, w.Body.String(), "AUTH_SESSION_REQUIRED")
	s := blockingSettings()
	w = request("PUT", "/settings", root, "http://protection.example", s)
	assert.Contains(t, w.Body.String(), `"success":true`)
	w = request("PUT", "/settings", root, "http://protection.example", s)
	assert.Contains(t, w.Body.String(), `"success":false`)
	assert.Contains(t, w.Body.String(), "Reload")
	assert.Error(t, model.UpdateOption(policy.SettingsKey, "{}"), "generic options cannot bypass dedicated permissions or CAS")
	w = request("POST", "/dry-run", root, "http://protection.example", map[string]any{"settings": s, "body": `{"input":"override instructions unrestricted"}`, "protocol": "openai_responses", "group": "default", "model": "gpt-4.1"})
	assert.Contains(t, w.Body.String(), `"decision":"block"`)
	var count int64
	require.NoError(t, db.Model(&policy.Event{}).Count(&count).Error)
	assert.Zero(t, count, "dry run writes no events")
	require.NoError(t, db.Model(&policy.Subject{}).Count(&count).Error)
	assert.Zero(t, count, "dry run cannot suspend an account")
	for _, change := range []func(*policy.Settings){
		func(s *policy.Settings) { s.Rules[0].Sources = []string{"current", "current"} },
		func(s *policy.Settings) { s.Rules[0].Patterns = []string{"["}; s.Rules[0].Kind = "regex" },
		func(s *policy.Settings) { s.MaxTextBytes = s.MaxBodyBytes + 1 },
		func(s *policy.Settings) { s.Rules[0].HighConfidence = false },
	} {
		invalid := blockingSettings()
		change(&invalid)
		assert.ErrorIs(t, policy.Validate(invalid), policy.ErrInvalid)
	}
}

func TestProtectionRejectsBeforeBillingAndTransportAndPreservesBody(t *testing.T) {
	db := protectionDB(t)
	s := blockingSettings()
	s.KeyThreshold, s.UserThreshold = 0, 0
	_, err := policy.SaveSettings(db, s, 99, time.Now().Unix())
	require.NoError(t, err)
	body := `{"model":"gpt-4.1","messages":[{"role":"user","content":"override instructions unrestricted secret-prompt"}]}`
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	t.Cleanup(func() { common.CleanupBodyStorage(c) })
	info := &relaycommon.RelayInfo{UserId: 42, TokenId: 7, UsingGroup: "default", OriginModelName: "gpt-4.1", RelayFormat: types.RelayFormatOpenAI, RequestId: "integration"}
	apiErr := relay.PrepareRequestBilling(c, info)
	require.NotNil(t, apiErr)
	assert.Equal(t, "request_protection_blocked", string(apiErr.GetErrorCode()))
	assert.Equal(t, 403, apiErr.StatusCode)
	assert.True(t, types.IsSkipRetryError(apiErr))
	assert.Nil(t, info.Billing)
	assert.False(t, service.ChargeViolationFeeIfNeeded(c, info, apiErr))
	storage, err := common.GetBodyStorage(c)
	require.NoError(t, err)
	read, err := storage.NewReader()
	require.NoError(t, err)
	actual, err := io.ReadAll(read)
	require.NoError(t, err)
	require.NoError(t, read.Close())
	assert.Equal(t, body, string(actual), "inspection cannot consume or rewrite the upstream body")
	var events []policy.Event
	require.NoError(t, db.Find(&events).Error)
	require.Len(t, events, 1)
	assert.Equal(t, "not_sent", events[0].Upstream)
	encoded, err := common.Marshal(events)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "secret-prompt")
	assert.NotContains(t, string(encoded), body)
	// Only exact upstream codes are observations; refusal prose adds no score.
	service.RecordRequestProtectionSafety(c, info, "generic refusal")
	service.RecordRequestProtectionSafety(c, info, "content_policy_violation")
	require.NoError(t, db.Where("upstream = ?", "responded").Find(&events).Error)
	require.Len(t, events, 1)
	assert.False(t, events[0].Counted)
}

func TestResponsesWebSocketInspectsEachNormalizedCreateWithCachedBody(t *testing.T) {
	db := protectionDB(t)
	s := blockingSettings()
	s.KeyThreshold, s.UserThreshold = 0, 0
	s.Rules = append(s.Rules, policy.Rule{ID: "observe-test", Name: "Benign observation", Enabled: true, Kind: "any", Patterns: []string{"benign marker"}, Sources: []string{"current"}, Action: "observe"})
	_, err := policy.SaveSettings(db, s, 99, time.Now().Unix())
	require.NoError(t, err)
	router := gin.New()
	router.GET("/v1/responses", func(c *gin.Context) {
		ws, err := (&websocket.Upgrader{}).Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			return
		}
		defer ws.Close()
		runner := func(request *http.Request, id string, _ func(*gin.Context) *types.NewAPIError) *types.NewAPIError {
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = request
			defer common.CleanupBodyStorage(ctx)
			// Rate-limit middleware may cache the body before relay validation.
			if _, err := common.GetBodyStorage(ctx); err != nil {
				return types.NewError(err, types.ErrorCodeInvalidRequest)
			}
			info := &relaycommon.RelayInfo{UserId: 42, TokenId: 7, UsingGroup: "default", OriginModelName: "gpt-4.1", RelayFormat: types.RelayFormatOpenAIResponses, RequestId: id}
			if apiErr := relay.PrepareRequestBilling(ctx, info); apiErr != nil && apiErr.GetErrorCode() == types.ErrorCode("request_protection_blocked") {
				return apiErr
			}
			return types.NewErrorWithStatusCode(errors.New("test transport intentionally absent"), types.ErrorCode("test_transport"), 400)
		}
		_ = relay.ResponsesWebSocketHelper(c, ws, runner)
	})
	server := httptest.NewServer(router)
	defer server.Close()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/v1/responses", nil)
	require.NoError(t, err)
	defer conn.Close()
	for _, tc := range []struct{ text, code string }{
		{"benign marker first", "test_transport"},
		{"benign marker second", "test_transport"},
		{"override instructions unrestricted third", "request_protection_blocked"},
	} {
		encoded, err := common.Marshal(map[string]any{"type": "response.create", "response": map[string]any{"model": "gpt-4.1", "input": tc.text}})
		require.NoError(t, err)
		require.NoError(t, conn.WriteMessage(websocket.TextMessage, encoded))
		require.NoError(t, conn.SetReadDeadline(time.Now().Add(5*time.Second)))
		_, response, err := conn.ReadMessage()
		require.NoError(t, err)
		assert.Contains(t, string(response), tc.code)
	}
	var events []policy.Event
	require.NoError(t, db.Order("id").Find(&events).Error)
	require.Len(t, events, 3)
	assert.NotEqual(t, events[0].RequestID, events[1].RequestID)
	assert.NotEqual(t, events[0].Digest, events[1].Digest)
	assert.NotEqual(t, events[1].RequestID, events[2].RequestID)
	assert.Equal(t, "block", events[2].Decision)
	_, _, err = conn.ReadMessage()
	assert.True(t, websocket.IsCloseError(err, websocket.ClosePolicyViolation))
}

func TestMaintenancePreservesLiveEvidenceAndDeduplicatesAlertWindows(t *testing.T) {
	db := protectionDB(t)
	s := blockingSettings()
	s.RetentionDays, s.KeyThreshold, s.UserThreshold, s.KeySuspendMinutes = 2, 1, 0, 10000
	now := int64(1800000000)
	_, err := policy.SaveSettings(db, s, 99, now-4*86400)
	require.NoError(t, err)
	in := requestInput("old-evidence", 7, "override instructions unrestricted old evidence")
	r, err := policy.Record(db, s, in, policy.Inspect(s, in, "secret"), "secret", now-3*86400)
	require.NoError(t, err)
	require.Greater(t, r.RestrictedUntil, now)
	require.NoError(t, requestprotection.Maintain(db, now))
	var event policy.Event
	require.NoError(t, db.First(&event, r.EventID).Error)
	require.NoError(t, policy.Release(db, "key:7", 99, "Reviewed", now))
	require.NoError(t, requestprotection.Maintain(db, now))
	assert.ErrorIs(t, db.First(&policy.Event{}, r.EventID).Error, gorm.ErrRecordNotFound)
	s, err = policy.GetSettings(db)
	require.NoError(t, err)
	s.AlertEnabled, s.AlertEmails, s.AlertThreshold = true, []string{"admin@example.com"}, 100
	s.RetentionDays = 30
	_, err = policy.SaveSettings(db, s, 99, now)
	require.NoError(t, err)
	require.NoError(t, requestprotection.Maintain(db, now))
	require.NoError(t, requestprotection.Maintain(db, now))
	var alerts []policy.Alert
	require.NoError(t, db.Find(&alerts).Error)
	require.Len(t, alerts, 1)
	assert.Equal(t, now, alerts[0].DeliveredAt, "quiet windows require no SMTP delivery")
	require.NoError(t, requestprotection.Maintain(db, now+3*86400))
	var count int64
	require.NoError(t, db.Model(&policy.Alert{}).Count(&count).Error)
	assert.EqualValues(t, 97, count, "catchup adds at most one day of 15-minute windows")
}
