package keypricing

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/extensions/keypricing/policy"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/groupdiscount"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func priceDB(t *testing.T) *gorm.DB {
	t.Helper()
	require.NoError(t, i18n.Init())
	gin.SetMode(gin.TestMode)
	dialect := os.Getenv("KEYPRICING_TEST_DIALECT")
	if dialect == "" {
		dialect = "sqlite"
	}
	require.Contains(t, []string{"sqlite", "mysql", "postgres"}, dialect)
	var driver gorm.Dialector = sqlite.Open(":memory:")
	if dialect != "sqlite" {
		dsn := os.Getenv("KEYPRICING_TEST_" + strings.ToUpper(dialect) + "_DSN")
		require.Contains(t, dsn, "/keypricing_extension_test?")
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
	oldDB, oldLogs, oldType := model.DB, model.LOG_DB, common.MainDatabaseType()
	oldRedis, oldBatch, oldHook := common.RedisEnabled, common.BatchUpdateEnabled, model.TokenCreatedHook
	oldRate, oldSecret, oldSecure, oldTrusted := common.CriticalRateLimitEnable, common.SessionSecret, common.SessionCookieSecure, common.SessionCookieTrustedURLs
	oldDiscount := groupdiscount.Default
	oldUsable, oldAuto := setting.UserUsableGroups2JSONString(), setting.AutoGroups2JsonString()
	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error { saved[key] = value; return nil }))
	model.DB, model.LOG_DB = db, db
	common.RedisEnabled, common.BatchUpdateEnabled, common.CriticalRateLimitEnable = false, false, false
	common.SessionSecret, common.SessionCookieSecure, common.SessionCookieTrustedURLs = "key-price-test-session", false, nil
	groupdiscount.Default = &groupdiscount.Runtime{}
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	if dialect == "mysql" {
		common.SetMainDatabaseType(common.DatabaseTypeMySQL)
	} else if dialect == "postgres" {
		common.SetMainDatabaseType(common.DatabaseTypePostgreSQL)
	}
	t.Cleanup(func() {
		model.DB, model.LOG_DB, model.TokenCreatedHook = oldDB, oldLogs, oldHook
		common.SetMainDatabaseType(oldType)
		common.RedisEnabled, common.BatchUpdateEnabled = oldRedis, oldBatch
		common.CriticalRateLimitEnable, common.SessionSecret, common.SessionCookieSecure, common.SessionCookieTrustedURLs = oldRate, oldSecret, oldSecure, oldTrusted
		groupdiscount.Default = oldDiscount
		require.NoError(t, config.GlobalConfig.LoadFromDB(saved))
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(oldUsable))
		require.NoError(t, setting.UpdateAutoGroupsByJsonString(oldAuto))
	})
	for _, table := range []any{&policy.Quote{}, &policy.Event{}, &policy.State{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}, &model.SystemTask{}, &model.SystemTaskLock{}, &model.Token{}, &model.User{}, &model.Option{}} {
		require.NoError(t, db.Migrator().DropTable(table))
	}
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Token{}, &model.Option{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}, &model.SystemTask{}, &model.SystemTaskLock{}))
	require.NoError(t, policy.Migrate(db))
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"group_ratio_setting.group_ratio":                `{"default":1,"premium":2,"free":0}`,
		"group_ratio_setting.group_group_ratio":          `{}`,
		"group_ratio_setting.group_special_usable_group": `{}`,
	}))
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default","premium":"Premium","free":"Free"}`))
	require.NoError(t, setting.UpdateAutoGroupsByJsonString(`["default","premium"]`))
	service.InstallKeyPriceProtection()
	return db
}

func priceUser(t *testing.T, db *gorm.DB, name string, role int) (model.User, string) {
	t.Helper()
	user := model.User{Username: name, AffCode: name, Role: role, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, Quota: 1000000}
	require.NoError(t, db.Create(&user).Error)
	session := model.UserSession{SID: "price-" + name, UserID: user.Id, Version: 1, UserAuthVersion: 1, Status: model.UserSessionStatusActive, RefreshHash: "unusable", LoginMethod: "password", LastActiveAt: time.Now().Unix(), ExpiresAt: time.Now().Unix() + 3600}
	require.NoError(t, model.CreateUserSession(&session))
	raw, _, err := service.IssueAccessToken(service.AuthIdentity{UserID: user.Id, SessionID: session.SID, UserAuthVersion: 1, SessionVersion: 1})
	require.NoError(t, err)
	return user, raw
}

type priceResponse struct {
	Success bool
	Message string
	Data    common.RawMessage
}

func priceRequest(t *testing.T, router http.Handler, method, path, credential, origin string, body any) (*httptest.ResponseRecorder, priceResponse) {
	t.Helper()
	var encoded []byte
	if body != nil {
		var err error
		encoded, err = common.Marshal(body)
		require.NoError(t, err)
	}
	r := httptest.NewRequest(method, "http://price.example/api/extensions/key-price"+path, bytes.NewReader(encoded))
	r.Header.Set("Content-Type", "application/json")
	if credential != "" {
		r.Header.Set("Authorization", "Bearer "+credential)
	}
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, r)
	var result priceResponse
	require.NoError(t, common.Unmarshal(w.Body.Bytes(), &result))
	return w, result
}

func TestMultiplierPolicyBoundariesAndStickyPause(t *testing.T) {
	db := priceDB(t)
	for index, tc := range []struct {
		name                  string
		accepted, actual, pct float64
		paused                bool
	}{
		{"unchanged", 1, 1, 0, false},
		{"decrease", 1, .5, 0, false},
		{"increase", 1, 1.01, 0, true},
		{"threshold inclusive", 1, 1.05, 5, false},
		{"above threshold", 1, 1.051, 5, true},
		{"free unchanged", 0, 0, 100, false},
		{"free becomes paid", 0, .001, 100, true},
		{"tiny multiplication rounding", .3, math.Nextafter(.3, .4), 0, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			encoded, err := common.Marshal(map[string]float64{"default": tc.accepted})
			require.NoError(t, err)
			id := index + 1
			state := policy.State{TokenID: id, UserID: 10, Version: 1, Protected: true, RouteHash: "route", Accepted: string(encoded)}
			require.NoError(t, db.Create(&state).Error)
			s := policy.Defaults()
			s.Enabled, s.IncreasePercent = true, tc.pct
			err = policy.Check(db, s, id, 10, "route", "default", tc.actual, 100)
			if !tc.paused {
				assert.NoError(t, err)
				stored, _, err := policy.ReadState(db, id, 10)
				require.NoError(t, err)
				assert.Equal(t, state.Accepted, stored.Accepted, "lower prices cannot silently lower the accepted ceiling")
				return
			}
			assert.ErrorIs(t, err, policy.ErrPaused)
			assert.ErrorIs(t, policy.Check(db, s, id, 10, "route", "default", 0, 101), policy.ErrPaused)
			var count int64
			require.NoError(t, db.Model(&policy.Event{}).Where("token_id = ?", id).Count(&count).Error)
			assert.EqualValues(t, 1, count, "repeated requests must not duplicate the pause audit")
		})
	}
	s := policy.Defaults()
	s.Enabled = true
	for _, invalid := range []float64{-1, math.NaN(), math.Inf(1)} {
		assert.ErrorIs(t, policy.Check(db, s, 1, 10, "route", "default", invalid, 100), policy.ErrUnavailable)
	}
}

func TestLegacyOptOutRoutingAndPolicyRevision(t *testing.T) {
	db := priceDB(t)
	s := policy.Defaults()
	s.Enabled = true
	saved, err := policy.SaveSettings(db, s, 99, 100)
	require.NoError(t, err)
	_, err = policy.SaveSettings(db, s, 99, 100)
	assert.ErrorIs(t, err, policy.ErrConflict)
	for _, change := range []func(*policy.Settings){
		func(s *policy.Settings) { s.IncreasePercent = -1 },
		func(s *policy.Settings) { s.IncreasePercent = math.NaN() },
		func(s *policy.Settings) { s.IncreasePercent = 101 },
		func(s *policy.Settings) { s.QuoteTTLSeconds = 59 },
		func(s *policy.Settings) { s.QuoteTTLSeconds = 901 },
		func(s *policy.Settings) { s.LegacyMode = "automatic" },
	} {
		invalid := saved
		change(&invalid)
		_, err := policy.SaveSettings(db, invalid, 99, 100)
		assert.ErrorIs(t, err, policy.ErrInvalid)
	}
	assert.NoError(t, policy.Check(db, saved, 1, 10, "route", "default", 2, 100))
	saved.LegacyMode = "confirm"
	assert.ErrorIs(t, policy.Check(db, saved, 1, 10, "route", "default", 2, 100), policy.ErrPaused)
	legacy, exists, err := policy.ReadState(db, 1, 10)
	require.NoError(t, err)
	assert.True(t, exists)
	assert.Equal(t, "confirmation_required", legacy.Reason)
	for id, tc := range []struct{ route, group, reason string }{
		{"changed", "default", "group_changed"},
		{"route", "premium", "new_group"},
	} {
		state := policy.State{TokenID: id + 2, UserID: 10, Version: 1, Protected: true, RouteHash: "route", Accepted: `{"default":1}`}
		require.NoError(t, db.Create(&state).Error)
		assert.ErrorIs(t, policy.Check(db, saved, state.TokenID, 10, tc.route, tc.group, 1, 100), policy.ErrPaused)
		stored, _, err := policy.ReadState(db, state.TokenID, 10)
		require.NoError(t, err)
		assert.Equal(t, tc.reason, stored.Reason)
	}
	optedOut := policy.State{TokenID: 4, UserID: 10, Version: 1, RouteHash: "route", Accepted: `{"default":1}`}
	require.NoError(t, db.Create(&optedOut).Error)
	assert.NoError(t, policy.Check(db, saved, 4, 10, "route", "default", 2, 100))
	saved.AllowOptOut = false
	assert.ErrorIs(t, policy.Check(db, saved, 4, 10, "route", "default", 2, 100), policy.ErrPaused)
	saved.AllowOptOut = true
	assert.ErrorIs(t, policy.Check(db, saved, 4, 10, "route", "default", 1, 101), policy.ErrPaused, "changing opt-out policy must not resume an already paused key without owner consent")
	saved.Enabled = false
	assert.NoError(t, policy.Check(db, saved, 4, 10, "route", "default", 2, 100))
}

func TestCreationCapturesDiscountsSpecialPricesAndRollsBackAtomically(t *testing.T) {
	db := priceDB(t)
	user, _ := priceUser(t, db, "owner", common.RoleCommonUser)
	require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(`{"default":{"premium":1.5}}`))
	now := time.Now()
	discount, err := common.Marshal(map[string]any{"revision": 1, "groups": []any{map[string]any{"group": "premium", "promotion": map[string]any{"enabled": true, "factor": .5, "starts_at": now.Add(-time.Hour).Unix(), "ends_at": now.Add(time.Hour).Unix(), "timezone": "UTC"}}}})
	require.NoError(t, err)
	require.NoError(t, groupdiscount.Default.Load(string(discount)))
	token := model.Token{UserId: user.Id, Key: "price-creation-key", Group: "auto", CrossGroupRetry: true}
	require.NoError(t, token.Insert(), "capture starts even while plugin is disabled")
	state, exists, err := policy.ReadState(db, token.Id, user.Id)
	require.NoError(t, err)
	require.True(t, exists)
	var accepted map[string]float64
	require.NoError(t, common.UnmarshalJsonStr(state.Accepted, &accepted))
	assert.Equal(t, map[string]float64{"default": 1, "premium": .75}, accepted)
	_, after, err := service.CaptureTokenGroupPrices(db, &token, now.Add(2*time.Hour))
	require.NoError(t, err)
	assert.Equal(t, 1.5, after["premium"], "discount must apply exactly once to special group pricing")
	s := policy.Defaults()
	s.Enabled = true
	assert.ErrorIs(t, policy.Check(db, s, token.Id, user.Id, state.RouteHash, "premium", after["premium"], now.Unix()), policy.ErrPaused)
	broken := model.Token{UserId: user.Id, Key: "price-rollback-key", Group: "auto", AutoGroups: "malformed"}
	assert.Error(t, broken.Insert())
	var count int64
	require.NoError(t, db.Model(&model.Token{}).Where(&model.Token{Key: broken.Key}).Count(&count).Error)
	assert.Zero(t, count, "a failed capture must roll back the credential too")
	require.NoError(t, policy.Migrate(db))
	require.NoError(t, policy.Migrate(db))
	retained, _, err := policy.ReadState(db, token.Id, user.Id)
	require.NoError(t, err)
	assert.True(t, retained.Paused)
	assert.Equal(t, state.Accepted, retained.Accepted)
	assert.Error(t, db.Create(&state).Error, "one state per Key remains unique after repeated migrations")
}

func TestBillingProtectionUsesFrozenPricesBeforeFreeModelsAndCrossGroupRetries(t *testing.T) {
	db := priceDB(t)
	user, _ := priceUser(t, db, "owner", common.RoleCommonUser)
	s := policy.Defaults()
	s.Enabled = true
	_, err := policy.SaveSettings(db, s, 99, time.Now().Unix())
	require.NoError(t, err)
	oldCount := constant.CountToken
	constant.CountToken = false
	oldFree := operation_setting.GetQuotaSetting().EnableFreeModelPreConsume
	operation_setting.GetQuotaSetting().EnableFreeModelPreConsume = false
	t.Cleanup(func() {
		constant.CountToken = oldCount
		operation_setting.GetQuotaSetting().EnableFreeModelPreConsume = oldFree
	})
	oldPrices := ratio_setting.ModelPrice2JSONString()
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"key-price-free-model":0}`))
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(oldPrices)) })
	token := model.Token{UserId: user.Id, Key: "price-billing-key", Group: "auto", CrossGroupRetry: true, RemainQuota: 700}
	require.NoError(t, token.Insert())
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	info := &relaycommon.RelayInfo{TokenId: token.Id, UserId: user.Id, UserGroup: "default", UsingGroup: "default", OriginModelName: "key-price-free-model", Request: &dto.GeneralOpenAIRequest{Model: "key-price-free-model"}}
	// A newer global price must not invalidate an attempt admitted with a
	// previously frozen lower ratio. The next attempt uses its actual ratio.
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":2,"premium":3,"free":0}`))
	assert.Nil(t, service.CheckTokenGroupPrice(ctx, info, 1))
	blocked := relay.PrepareRequestBilling(ctx, info)
	require.NotNil(t, blocked, "a free model cannot bypass a group price pause")
	assert.Equal(t, http.StatusForbidden, blocked.StatusCode)
	assert.Equal(t, "key_group_price_paused", string(blocked.GetErrorCode()))
	assert.True(t, types.IsSkipRetryError(blocked))
	assert.Nil(t, info.Billing)
	var stored model.Token
	require.NoError(t, db.First(&stored, token.Id).Error)
	assert.Equal(t, token.RemainQuota, stored.RemainQuota)
	assert.Equal(t, token.Status, stored.Status)
	var owner model.User
	require.NoError(t, db.First(&owner, user.Id).Error)
	assert.Equal(t, user.Quota, owner.Quota)
	// A fresh Auto Key accepts both concrete groups. The first attempt keeps
	// working, while a retry into a newly increased second group pauses it.
	retry := model.Token{UserId: user.Id, Key: "price-retry-key", Group: "auto", CrossGroupRetry: true}
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"premium":2,"free":0}`))
	require.NoError(t, retry.Insert())
	info.TokenId, info.UsingGroup, info.GroupDiscounts = retry.Id, "default", nil
	assert.Nil(t, service.CheckTokenGroupPrice(ctx, info, helper.HandleGroupRatio(ctx, info).GroupRatio))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"premium":2.1,"free":0}`))
	ctx.Set("auto_group", "premium")
	blocked = service.CheckTokenGroupPrice(ctx, info, helper.HandleGroupRatio(ctx, info).GroupRatio)
	require.NotNil(t, blocked)
	assert.True(t, types.IsSkipRetryError(blocked))
	info.IsChannelTest = true
	assert.Nil(t, service.CheckTokenGroupPrice(ctx, info, 100))
}

func TestQuotesRequireOwnerRootSessionOriginAndSingleUseConsent(t *testing.T) {
	db := priceDB(t)
	require.NoError(t, model.EnsureLegacyAccessTokenRetireAt(time.Now().Unix()))
	owner, credential := priceUser(t, db, "owner", common.RoleCommonUser)
	_, stranger := priceUser(t, db, "stranger", common.RoleCommonUser)
	_, admin := priceUser(t, db, "admin", common.RoleAdminUser)
	_, root := priceUser(t, db, "root", common.RoleRootUser)
	s := policy.Defaults()
	s.Enabled = true
	_, err := policy.SaveSettings(db, s, 99, time.Now().Unix())
	require.NoError(t, err)
	token := model.Token{UserId: owner.Id, Key: "never-expose-this-credential", Group: "default", Status: common.TokenStatusDisabled, ExpiredTime: time.Now().Unix() - 60, RemainQuota: 0}
	require.NoError(t, token.Insert())
	saved, err := policy.GetSettings(db)
	require.NoError(t, err)
	state, _, err := policy.ReadState(db, token.Id, owner.Id)
	require.NoError(t, err)
	assert.ErrorIs(t, policy.Check(db, saved, token.Id, owner.Id, state.RouteHash, "default", 2, time.Now().Unix()), policy.ErrPaused)
	router := gin.New()
	RegisterRoutes(router.Group("/api"))
	for _, route := range router.Routes() {
		rule, ok := middleware.AccessTokenRouteRule(route.Method + " " + route.Path)
		require.True(t, ok)
		assert.Equal(t, "session", rule.Kind())
	}
	keyPath := fmt.Sprintf("/keys/%d", token.Id)
	for _, tc := range []struct {
		name, method, path, actor, origin string
		status                            int
		success                           bool
	}{
		{"anonymous", "GET", keyPath, "", "", 401, false},
		{"other owner", "GET", keyPath, stranger, "", 200, false},
		{"other owner quote", "POST", keyPath + "/quote", stranger, "http://price.example", 200, false},
		{"member admin", "GET", "/admin/settings", credential, "", 403, false},
		{"admin root", "GET", "/admin/settings", admin, "", 403, false},
		{"root", "GET", "/admin/settings", root, "", 200, true},
		{"local HTTP foreign origin", "POST", keyPath + "/quote", credential, "http://evil.example", 403, false},
		{"missing origin", "POST", keyPath + "/quote", credential, "", 403, false},
		{"foreign settings", "PUT", "/admin/settings", root, "http://evil.example", 403, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w, result := priceRequest(t, router, tc.method, tc.path, tc.actor, tc.origin, nil)
			assert.Equal(t, tc.status, w.Code)
			assert.Equal(t, tc.success, result.Success)
			assert.NotContains(t, w.Body.String(), token.Key)
		})
	}
	patRaw := "nap_key_price_scoped_test"
	digest := sha256.Sum256([]byte(patRaw))
	pat := model.UserAccessToken{UserId: owner.Id, Name: "automation", TokenHash: hex.EncodeToString(digest[:]), TokenHint: "test", Scopes: `["keys:read","keys:write"]`, ExpiresAt: time.Now().Unix() + 3600}
	require.NoError(t, db.Create(&pat).Error)
	w, _ := priceRequest(t, router, "GET", keyPath, patRaw, "", nil)
	assert.Equal(t, 403, w.Code)
	assert.Contains(t, w.Body.String(), "AUTH_SESSION_REQUIRED")
	w, result := priceRequest(t, router, "GET", fmt.Sprintf("/status?ids=%d", token.Id), stranger, "", nil)
	require.True(t, result.Success)
	assert.NotContains(t, string(result.Data), `"token_id":`)
	w, result = priceRequest(t, router, "GET", keyPath, credential, "", nil)
	require.True(t, result.Success)
	assert.Contains(t, w.Header().Get("Cache-Control"), "no-store")
	assert.NotContains(t, w.Body.String(), token.Key)
	w, result = priceRequest(t, router, "POST", keyPath+"/quote", credential, "http://price.example", nil)
	require.True(t, result.Success)
	var quote struct {
		Quote string
		Rates map[string]float64
	}
	require.NoError(t, common.Unmarshal(result.Data, &quote))
	assert.Len(t, quote.Quote, 64)
	assert.Equal(t, map[string]float64{"default": 1}, quote.Rates)
	var storedQuote policy.Quote
	require.NoError(t, db.First(&storedQuote).Error)
	assert.NotEqual(t, quote.Quote, storedQuote.Hash)
	input := map[string]any{"quote": quote.Quote, "protected": true}
	_, result = priceRequest(t, router, "POST", keyPath+"/accept", stranger, "http://price.example", input)
	assert.False(t, result.Success)
	_, result = priceRequest(t, router, "POST", keyPath+"/accept", credential, "http://evil.example", input)
	assert.False(t, result.Success)
	_, result = priceRequest(t, router, "POST", keyPath+"/accept", credential, "http://price.example", input)
	require.True(t, result.Success, result.Message)
	accepted, _, err := policy.ReadState(db, token.Id, owner.Id)
	require.NoError(t, err)
	assert.False(t, accepted.Paused)
	var retained model.Token
	require.NoError(t, db.First(&retained, token.Id).Error)
	assert.Equal(t, token.Status, retained.Status, "consent must never enable a manually disabled Key")
	assert.Equal(t, token.ExpiredTime, retained.ExpiredTime)
	assert.Zero(t, retained.RemainQuota)
	_, result = priceRequest(t, router, "POST", keyPath+"/accept", credential, "http://price.example", input)
	assert.False(t, result.Success, "consent is single use")
	var events []policy.Event
	require.NoError(t, db.Find(&events).Error)
	encoded, err := common.Marshal(events)
	require.NoError(t, err)
	for _, secret := range []string{token.Key, credential, patRaw, quote.Quote, storedQuote.Hash} {
		assert.NotContains(t, string(encoded), secret)
	}
}

func TestQuotesRejectExpiryChangedPriceRouteStateSettingsAndForbiddenOptOut(t *testing.T) {
	for _, change := range []string{"expired", "price", "route", "state", "settings", "opt_out", "superseded"} {
		t.Run(change, func(t *testing.T) {
			db := priceDB(t)
			owner, credential := priceUser(t, db, "owner", common.RoleCommonUser)
			s := policy.Defaults()
			s.Enabled, s.AllowOptOut = true, false
			s, err := policy.SaveSettings(db, s, 99, time.Now().Unix())
			require.NoError(t, err)
			token := model.Token{UserId: owner.Id, Key: "stale-quote-key", Group: "default"}
			require.NoError(t, token.Insert())
			router := gin.New()
			RegisterRoutes(router.Group("/api"))
			path := fmt.Sprintf("/keys/%d", token.Id)
			_, response := priceRequest(t, router, "POST", path+"/quote", credential, "http://price.example", nil)
			require.True(t, response.Success)
			var quote struct{ Quote string }
			require.NoError(t, common.Unmarshal(response.Data, &quote))
			switch change {
			case "expired":
				require.NoError(t, db.Model(&policy.Quote{}).Where("token_id = ?", token.Id).Update("expires_at", time.Now().Unix()).Error)
			case "price":
				require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1.1,"premium":2}`))
			case "route":
				require.NoError(t, db.Model(&model.Token{}).Where("id = ?", token.Id).Update("group", "premium").Error)
			case "state":
				state, _, err := policy.ReadState(db, token.Id, owner.Id)
				require.NoError(t, err)
				require.ErrorIs(t, policy.Check(db, s, token.Id, owner.Id, state.RouteHash, "default", 2, time.Now().Unix()), policy.ErrPaused)
			case "settings":
				_, err := policy.SaveSettings(db, s, 99, time.Now().Unix())
				require.NoError(t, err)
			case "superseded":
				_, replacement := priceRequest(t, router, "POST", path+"/quote", credential, "http://price.example", nil)
				require.True(t, replacement.Success)
			}
			_, response = priceRequest(t, router, "POST", path+"/accept", credential, "http://price.example", map[string]any{"quote": quote.Quote, "protected": change != "opt_out"})
			assert.False(t, response.Success)
			state, _, err := policy.ReadState(db, token.Id, owner.Id)
			require.NoError(t, err)
			assert.Equal(t, `{"default":1}`, state.Accepted)
		})
	}
}

func TestCaptureFailureRollsBackTheHostInsert(t *testing.T) {
	db := priceDB(t)
	owner, _ := priceUser(t, db, "owner", common.RoleCommonUser)
	original := model.TokenCreatedHook
	model.TokenCreatedHook = func(tx *gorm.DB, token *model.Token) error {
		if err := original(tx, token); err != nil {
			return err
		}
		return errors.New("later extension rejected creation")
	}
	token := model.Token{UserId: owner.Id, Key: "atomic-key", Group: "default"}
	require.Error(t, token.Insert())
	var count int64
	require.NoError(t, db.Model(&policy.State{}).Where("token_id = ?", token.Id).Count(&count).Error)
	assert.Zero(t, count)
	require.NoError(t, db.Model(&model.Token{}).Where(&model.Token{Key: token.Key}).Count(&count).Error)
	assert.Zero(t, count)
}
