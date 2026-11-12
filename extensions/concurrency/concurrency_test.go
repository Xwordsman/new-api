package concurrency_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/extensions/concurrency"
	"github.com/QuantumNous/new-api/extensions/concurrency/policy"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel/openai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func concurrencyRedis(t *testing.T) *redis.Client {
	t.Helper()
	addr := os.Getenv("CONCURRENCY_TEST_REDIS_ADDR")
	if addr == "" {
		t.Skip("CONCURRENCY_TEST_REDIS_ADDR is not configured")
	}
	client := redis.NewClient(&redis.Options{Addr: addr, DB: 15})
	require.NoError(t, client.Ping(context.Background()).Err())
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	return client
}

func TestCapacityStoreAtomicOwnershipAndExpiry(t *testing.T) {
	stores := map[string]policy.Store{"memory": policy.NewMemoryStore()}
	if os.Getenv("CONCURRENCY_TEST_REDIS_ADDR") != "" {
		stores["redis"] = &policy.RedisStore{Client: concurrencyRedis(t)}
	}
	for name, store := range stores {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			prefix := "test:" + common.GetUUID()
			user := policy.Resource{Name: prefix + ":user", Limit: 2}
			channel := policy.Resource{Name: prefix + ":channel", Limit: 1}
			resources := []policy.Resource{user, channel}
			t.Cleanup(func() {
				for _, owner := range []string{"first", "second", "expired", "replacement"} {
					require.NoError(t, store.Release(ctx, resources, owner))
				}
			})
			ok, err := store.Acquire(ctx, resources, "first", time.Minute)
			require.NoError(t, err)
			require.True(t, ok)
			ok, err = store.Acquire(ctx, resources, "first", time.Minute)
			require.NoError(t, err)
			assert.True(t, ok, "repeated admission by the same owner is idempotent")
			ok, err = store.Acquire(ctx, resources, "second", time.Minute)
			require.NoError(t, err)
			assert.False(t, ok)
			rows, err := store.Snapshot(ctx)
			require.NoError(t, err)
			for _, row := range rows {
				if row.Resource == user.Name || row.Resource == channel.Name {
					assert.Equal(t, 1, row.Active, "a refused multi-scope attempt reserves nothing")
					assert.EqualValues(t, 1, row.Admitted)
				}
			}
			require.NoError(t, store.Release(ctx, resources, "second"))
			ok, err = store.Acquire(ctx, resources, "second", time.Minute)
			require.NoError(t, err)
			assert.False(t, ok, "another owner cannot release the first request")
			require.NoError(t, store.Release(ctx, resources, "first"))
			ok, err = store.Acquire(ctx, resources, "expired", -time.Second)
			require.NoError(t, err)
			require.True(t, ok)
			ok, err = store.Acquire(ctx, resources, "replacement", time.Minute)
			require.NoError(t, err)
			require.True(t, ok, "expired leases recover capacity after a crash")
			ok, err = store.Renew(ctx, resources, "expired", time.Minute)
			require.NoError(t, err)
			assert.False(t, ok, "late renewals cannot revive expired ownership")
			require.NoError(t, store.Release(ctx, resources, "expired"))
			ok, err = store.Acquire(ctx, resources, "second", time.Minute)
			require.NoError(t, err)
			assert.False(t, ok)
			ok, err = store.Renew(ctx, resources, "replacement", time.Minute)
			require.NoError(t, err)
			assert.True(t, ok)
		})
	}
}

func TestRedisShortLeaseCannotExpireLongRunningRequests(t *testing.T) {
	client := concurrencyRedis(t)
	store := &policy.RedisStore{Client: client}
	ctx := context.Background()
	resource := []policy.Resource{{Name: "test:" + common.GetUUID(), Limit: 2}}
	t.Cleanup(func() {
		require.NoError(t, store.Release(ctx, resource, "long"))
		require.NoError(t, store.Release(ctx, resource, "short"))
	})
	ok, err := store.Acquire(ctx, resource, "long", 600*time.Second)
	require.NoError(t, err)
	require.True(t, ok)
	ok, err = store.Acquire(ctx, resource, "short", 30*time.Second)
	require.NoError(t, err)
	require.True(t, ok)
	key := "newapi:concurrency:v1:slots:" + resource[0].Name
	assert.Greater(t, client.PTTL(ctx, key).Val(), 600*time.Second, "new settings must not shorten an existing lease's key lifetime")
	ok, err = store.Renew(ctx, resource, "short", 30*time.Second)
	require.NoError(t, err)
	require.True(t, ok)
	assert.Greater(t, client.PTTL(ctx, key).Val(), 600*time.Second, "short renewals must preserve long-running owners")
}

type observedStore struct {
	policy.Store
	queued chan struct{}
}

func (s *observedStore) Acquire(ctx context.Context, resources []policy.Resource, owner string, ttl time.Duration) (bool, error) {
	ok, err := s.Store.Acquire(ctx, resources, owner, ttl)
	if ok && len(resources) > 0 && strings.HasPrefix(resources[0].Name, "wait:") {
		s.queued <- struct{}{}
	}
	return ok, err
}

func TestAccountPrecedenceQueueCancellationAndChannelSwitch(t *testing.T) {
	s := policy.DefaultSettings()
	s.Enabled, s.DefaultUserLimit, s.DefaultChannelLimit, s.DefaultKeyLimit = true, 1, 1, 1
	s.Groups = []policy.GroupRule{{Group: "vip", Limit: 2}}
	s.Users = []policy.UserRule{{UserID: 7, Limit: 3}}
	assert.Equal(t, 3, s.UserLimit(7, "vip"))
	assert.Equal(t, 2, s.UserLimit(8, "vip"))
	assert.Equal(t, 1, s.UserLimit(8, "default"))
	store := &observedStore{Store: policy.NewMemoryStore(), queued: make(chan struct{}, 1)}
	first, err := policy.Admit(context.Background(), store, s, 42, "default")
	require.NoError(t, err)
	t.Cleanup(first.Close)
	_, err = policy.Admit(context.Background(), store, s, 42, "default")
	assert.ErrorIs(t, err, policy.ErrUserBusy, "account capacity is shared, not partitioned by API key")
	s.QueueTimeoutMS, s.MaxQueuedPerUser = 1000, 1
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	result := make(chan error, 1)
	go func() {
		r, err := policy.Admit(ctx, store, s, 42, "default")
		if r != nil {
			r.Close()
		}
		result <- err
	}()
	<-store.queued
	_, err = policy.Admit(context.Background(), store, s, 42, "default")
	assert.ErrorIs(t, err, policy.ErrUserBusy, "the per-account queue depth is bounded")
	cancel()
	assert.ErrorIs(t, <-result, context.Canceled)
	rows, err := store.Snapshot(context.Background())
	require.NoError(t, err)
	for _, row := range rows {
		if row.Resource == "wait:user:42" {
			assert.Zero(t, row.Active, "cancelled waiters release queue capacity")
		}
	}
	s.QueueTimeoutMS = 1
	_, err = policy.Admit(context.Background(), store, s, 42, "default")
	assert.ErrorIs(t, err, policy.ErrUserBusy, "the queue times out without admitting beyond the cap")
	first.Close()
	second, err := policy.Admit(context.Background(), store, s, 43, "default")
	require.NoError(t, err)
	defer second.Close()
	require.NoError(t, second.ReserveChannel(10, "credential-a", true))
	require.NoError(t, second.ReserveChannel(10, "credential-a", true), "reusing a selected channel does not reacquire")
	third, err := policy.Admit(context.Background(), store, s, 44, "default")
	require.NoError(t, err)
	defer third.Close()
	assert.ErrorIs(t, third.ReserveChannel(10, "credential-b", true), policy.ErrChannelBusy)
	require.NoError(t, second.ReserveChannel(11, "credential-c", true))
	require.NoError(t, third.ReserveChannel(10, "credential-b", true), "retrying another channel frees the previous attempt")
	rows, err = store.Snapshot(context.Background())
	require.NoError(t, err)
	for _, row := range rows {
		assert.NotContains(t, row.Resource, "credential-", "raw upstream credentials must not appear in status")
	}
}

type lostLeaseStore struct{ policy.Store }

func (s *lostLeaseStore) Renew(context.Context, []policy.Resource, string, time.Duration) (bool, error) {
	return false, nil
}

func TestLostLeaseCancelsRequestAndQueueResumesAfterRelease(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		s := policy.DefaultSettings()
		s.Enabled, s.DefaultUserLimit = true, 1
		store := policy.NewMemoryStore()
		r, err := policy.Admit(context.Background(), &lostLeaseStore{store}, s, 11, "default")
		require.NoError(t, err)
		require.NoError(t, r.ReserveChannel(12, "test-key", false))
		<-r.Context().Done()
		assert.ErrorIs(t, r.Context().Err(), context.Canceled, "losing ownership must stop upstream work")
		assert.ErrorIs(t, r.ReserveChannel(12, "test-key", false), policy.ErrUnavailable)
		r.Close()
		rows, err := store.Snapshot(context.Background())
		require.NoError(t, err)
		for _, row := range rows {
			assert.Zero(t, row.Active)
		}
	})
	synctest.Test(t, func(t *testing.T) {
		s := policy.DefaultSettings()
		s.Enabled, s.DefaultUserLimit, s.QueueTimeoutMS, s.MaxQueuedPerUser = true, 1, 2000, 1
		store := &observedStore{Store: policy.NewMemoryStore(), queued: make(chan struct{}, 1)}
		first, err := policy.Admit(context.Background(), store, s, 12, "default")
		require.NoError(t, err)
		defer first.Close()
		result := make(chan *policy.Request, 1)
		fail := make(chan error, 1)
		go func() {
			r, err := policy.Admit(context.Background(), store, s, 12, "default")
			result <- r
			fail <- err
		}()
		<-store.queued
		first.Close()
		second := <-result
		require.NoError(t, <-fail)
		require.NotNil(t, second)
		defer second.Close()
		rows, err := store.Snapshot(context.Background())
		require.NoError(t, err)
		for _, row := range rows {
			if row.Resource == "wait:user:12" {
				assert.Zero(t, row.Active)
			}
			if row.Resource == "user:12" {
				assert.Equal(t, 1, row.Active)
			}
		}
	})
}

func concurrencyDB(t *testing.T) *gorm.DB {
	t.Helper()
	require.NoError(t, i18n.Init())
	gin.SetMode(gin.TestMode)
	dialect := os.Getenv("CONCURRENCY_TEST_DIALECT")
	if dialect == "" {
		dialect = "sqlite"
	}
	require.Contains(t, []string{"sqlite", "mysql", "postgres"}, dialect)
	dsn := "local"
	if dialect != "sqlite" {
		dsn = os.Getenv("CONCURRENCY_TEST_" + strings.ToUpper(dialect) + "_DSN")
		require.Contains(t, dsn, "/concurrency_extension_test?")
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
	common.SessionSecret, common.SessionCookieSecure, common.SessionCookieTrustedURLs = "concurrency-test-secret", false, nil
	t.Setenv("SQL_DSN", dsn)
	t.Setenv("LOG_SQL_DSN", "")
	common.IsMasterNode, common.SQLitePath = false, ":memory:"
	// Use host initialization, including its dialect-specific column quoting.
	// This extension adds no schema; migrate only the host tables used below.
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
	tables := []any{&model.Option{}, &model.Channel{}, &model.Ability{}, &model.User{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}}
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

func concurrencyUser(t *testing.T, db *gorm.DB, name string, role int) (model.User, string) {
	t.Helper()
	user := model.User{Username: name, AffCode: name, Role: role, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1}
	require.NoError(t, db.Create(&user).Error)
	session := model.UserSession{SID: "concurrency-" + name, UserID: user.Id, Version: 1, UserAuthVersion: 1, Status: model.UserSessionStatusActive, RefreshHash: "unusable", LoginMethod: "password", LastActiveAt: time.Now().Unix(), ExpiresAt: time.Now().Unix() + 3600}
	require.NoError(t, model.CreateUserSession(&session))
	raw, _, err := service.IssueAccessToken(service.AuthIdentity{UserID: user.Id, SessionID: session.SID, UserAuthVersion: 1, SessionVersion: 1})
	require.NoError(t, err)
	return user, raw
}

func TestSettingsStorageAndAdminContracts(t *testing.T) {
	db := concurrencyDB(t)
	s, err := policy.ReadSettings(db)
	require.NoError(t, err)
	assert.False(t, s.Enabled)
	require.NoError(t, db.Create(&model.Option{Key: "unrelated", Value: "keep"}).Error)
	s.Enabled = true
	s.Groups = []policy.GroupRule{{Group: "vip", Limit: 10}}
	saved, err := policy.SaveSettings(db, s)
	require.NoError(t, err)
	assert.EqualValues(t, 1, saved.Revision)
	_, err = policy.SaveSettings(db, s)
	assert.ErrorIs(t, err, policy.ErrConflict)
	loaded, err := policy.ReadSettings(db)
	require.NoError(t, err)
	assert.Equal(t, saved, loaded)
	cached, err := policy.CachedSettings()
	require.NoError(t, err)
	assert.Equal(t, saved, cached)
	// The extension adds no tables or columns; verify host option data survives
	// a repeated migration and a subsequent settings update.
	require.NoError(t, db.AutoMigrate(&model.Option{}))
	saved.DefaultUserLimit = 8
	saved, err = policy.SaveSettings(db, saved)
	require.NoError(t, err)
	var unrelated model.Option
	require.NoError(t, db.Where("value = ?", "keep").Take(&unrelated).Error)
	assert.Equal(t, "unrelated", unrelated.Key)
	assert.Error(t, model.UpdateOption(policy.OptionKey, "{}"), "the generic option endpoint cannot bypass CAS")
	for _, change := range []func(*policy.Settings){
		func(s *policy.Settings) { s.Groups = append(s.Groups, s.Groups[0]) },
		func(s *policy.Settings) { s.QueueTimeoutMS = 10 },
		func(s *policy.Settings) { s.LeaseSeconds = 29 },
		func(s *policy.Settings) { s.DefaultUserLimit = -1 },
		func(s *policy.Settings) { s.Groups[0].Group = strings.Repeat("组", 22) },
	} {
		invalid := policy.DefaultSettings()
		invalid.Groups = []policy.GroupRule{{Group: "vip", Limit: 10}}
		change(&invalid)
		_, err := policy.SaveSettings(db, invalid)
		assert.ErrorIs(t, err, policy.ErrInvalid)
	}
	common.OptionMapRWMutex.Lock()
	common.OptionMap[policy.OptionKey] = "{invalid"
	common.OptionMapRWMutex.Unlock()
	_, err = policy.CachedSettings()
	assert.Error(t, err, "invalid shared configuration must fail closed")
	require.NoError(t, model.EnsureLegacyAccessTokenRetireAt(time.Now().Unix()))
	rootUser, root := concurrencyUser(t, db, "root", common.RoleRootUser)
	_, admin := concurrencyUser(t, db, "admin", common.RoleAdminUser)
	router := gin.New()
	concurrency.RegisterRoutes(router.Group("/api"))
	for _, route := range router.Routes() {
		rule, ok := middleware.AccessTokenRouteRule(route.Method + " " + route.Path)
		require.True(t, ok)
		assert.Equal(t, "session", rule.Kind())
	}
	request := func(method, path, token, origin string, input any) *httptest.ResponseRecorder {
		encoded, err := common.Marshal(input)
		require.NoError(t, err)
		r := httptest.NewRequest(method, "http://concurrency.example/api/extensions/concurrency/admin"+path, bytes.NewReader(encoded))
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
		{"GET", "/status", admin, "", 403},
		{"GET", "/settings", root, "", 200},
		{"PUT", "/settings", root, "", 403},
		{"PUT", "/settings", root, "http://evil.example", 403},
		{"PUT", "/settings", root, "null", 403},
	} {
		w := request(tc.method, tc.path, tc.token, tc.origin, saved)
		assert.Equal(t, tc.status, w.Code, tc.path)
	}
	w := request("GET", "/settings", root, "", nil)
	assert.Contains(t, w.Header().Get("Cache-Control"), "no-store")
	patRaw := "nap_concurrency_test"
	hash := sha256.Sum256([]byte(patRaw))
	require.NoError(t, db.Create(&model.UserAccessToken{UserId: rootUser.Id, Name: "automation", TokenHash: hex.EncodeToString(hash[:]), TokenHint: "test", Scopes: `["option:read","option:write"]`, ExpiresAt: time.Now().Unix() + 3600}).Error)
	w = request("GET", "/settings", patRaw, "", nil)
	assert.Equal(t, 403, w.Code)
	assert.Contains(t, w.Body.String(), "AUTH_SESSION_REQUIRED")
	saved.Enabled = false
	w = request("PUT", "/settings", root, "http://concurrency.example", saved)
	assert.Contains(t, w.Body.String(), `"success":true`)
	w = request("PUT", "/settings", root, "http://concurrency.example", saved)
	assert.Contains(t, w.Body.String(), `"success":false`)
	assert.Contains(t, w.Body.String(), "Reload")
	w = request("GET", "/status", root, "", nil)
	assert.Contains(t, w.Body.String(), `"mode":"memory"`)
}

func concurrencyContext(userID int) *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	common.SetContextKey(c, constant.ContextKeyUserId, userID)
	common.SetContextKey(c, constant.ContextKeyUserGroup, "default")
	common.SetContextKey(c, constant.ContextKeyUsingGroup, "default")
	return c
}

func TestRoutingSkipsBusyChannelsAndCredentialsWithoutRetryOrHealthChanges(t *testing.T) {
	db := concurrencyDB(t)
	s := policy.DefaultSettings()
	s.Enabled, s.DefaultChannelLimit, s.DefaultKeyLimit = true, 1, 1
	_, err := policy.SaveSettings(db, s)
	require.NoError(t, err)
	channels := []model.Channel{
		{Id: 101, Type: constant.ChannelTypeOpenAI, Key: "first-test-credential", Status: common.ChannelStatusEnabled, Name: "first", Group: "default", Models: "concurrency-model", Priority: common.GetPointer(int64(10))},
		{Id: 102, Type: constant.ChannelTypeOpenAI, Key: "second-test-credential", Status: common.ChannelStatusEnabled, Name: "second", Group: "default", Models: "concurrency-model", Priority: common.GetPointer(int64(0))},
	}
	for i := range channels {
		require.NoError(t, db.Create(&channels[i]).Error)
		require.NoError(t, db.Create(&model.Ability{Group: "default", Model: "concurrency-model", ChannelId: channels[i].Id, Enabled: true, Priority: channels[i].Priority}).Error)
	}
	for _, memory := range []bool{false, true} {
		t.Run("cache="+strconv.FormatBool(memory), func(t *testing.T) {
			common.MemoryCacheEnabled = memory
			model.InitChannelCache()
			first := concurrencyContext(71)
			closeFirst, admissionErr := middleware.AdmitConcurrency(first)
			require.Nil(t, admissionErr)
			defer closeFirst()
			require.Nil(t, middleware.ReserveChannelConcurrency(first, &channels[0], channels[0].Key))
			second := concurrencyContext(72)
			closeSecond, admissionErr := middleware.AdmitConcurrency(second)
			require.Nil(t, admissionErr)
			defer closeSecond()
			retry := &service.RetryParam{Ctx: second, ModelName: "concurrency-model", TokenGroup: "default"}
			selected, _, selectErr := middleware.SelectAndSetupChannel(second, "concurrency-model", retry, nil)
			require.Nil(t, selectErr)
			assert.Equal(t, 102, selected.Id, "the lower-priority channel can accept overflow")
			assert.Zero(t, retry.GetRetry(), "capacity fallback does not consume upstream retries")
			assert.Empty(t, service.GetChannelConstraints(second).Filters, "temporary exclusions must not escape selection")
			for _, pinned := range []bool{false, true} {
				third := concurrencyContext(73)
				closeThird, admissionErr := middleware.AdmitConcurrency(third)
				require.Nil(t, admissionErr)
				if pinned {
					service.GetChannelConstraints(third).AddPin(dto.ChannelPin{ChannelId: 101, Source: dto.PinSourceToken})
				}
				_, _, selectErr = middleware.SelectAndSetupChannel(third, "concurrency-model", &service.RetryParam{Ctx: third, TokenGroup: "default", ModelName: "concurrency-model"}, nil)
				require.NotNil(t, selectErr)
				assert.Equal(t, 429, selectErr.StatusCode)
				assert.Equal(t, "channel_concurrency_exceeded", string(selectErr.GetErrorCode()))
				assert.Equal(t, "1", third.Writer.Header().Get("Retry-After"))
				closeThird()
			}
			closeSecond()
			strict := concurrencyContext(74)
			closeStrict, admissionErr := middleware.AdmitConcurrency(strict)
			require.Nil(t, admissionErr)
			defer closeStrict()
			service.RequestPolicy(strict).SessionMode = "strict"
			_, _, selectErr = middleware.SelectAndSetupChannel(strict, "concurrency-model", &service.RetryParam{Ctx: strict, TokenGroup: "default", ModelName: "concurrency-model"}, &channels[0])
			require.NotNil(t, selectErr)
			assert.Equal(t, 429, selectErr.StatusCode, "strict bindings must not migrate to a different upstream")
		})
	}
	common.MemoryCacheEnabled = false
	s.DefaultChannelLimit = 0
	loaded, err := policy.ReadSettings(db)
	require.NoError(t, err)
	s.Revision = loaded.Revision
	_, err = policy.SaveSettings(db, s)
	require.NoError(t, err)
	multi := model.Channel{Id: 103, Type: constant.ChannelTypeOpenAI, Key: "busy-key\ndisabled-key\nfree-key", Status: common.ChannelStatusEnabled}
	multi.ChannelInfo = model.ChannelInfo{IsMultiKey: true, MultiKeySize: 3, MultiKeyMode: constant.MultiKeyModePolling, MultiKeyStatusList: map[int]int{1: common.ChannelStatusAutoDisabled}}
	require.NoError(t, db.Create(&multi).Error)
	first := concurrencyContext(81)
	closeFirst, admissionErr := middleware.AdmitConcurrency(first)
	require.Nil(t, admissionErr)
	defer closeFirst()
	require.Nil(t, middleware.ReserveChannelConcurrency(first, &multi, "busy-key"))
	second := concurrencyContext(82)
	closeSecond, admissionErr := middleware.AdmitConcurrency(second)
	require.Nil(t, admissionErr)
	defer closeSecond()
	require.Nil(t, middleware.SetupContextForSelectedChannel(second, &multi, "concurrency-model"))
	assert.Equal(t, "free-key", common.GetContextKeyString(second, constant.ContextKeyChannelKey))
	var disabled int64
	require.NoError(t, db.Model(&model.Channel{}).Where("status <> ?", common.ChannelStatusEnabled).Count(&disabled).Error)
	assert.Zero(t, disabled, "saturation cannot disable upstream channels")
}

func TestStreamingHoldsAccountCapacityUntilHandlerUnwindsAndRedisFailsClosed(t *testing.T) {
	db := concurrencyDB(t)
	s := policy.DefaultSettings()
	s.Enabled, s.DefaultUserLimit = true, 1
	_, err := policy.SaveSettings(db, s)
	require.NoError(t, err)
	channel := model.Channel{Id: 111, Type: constant.ChannelTypeOpenAI, Key: "stream-test-key", Group: "default", Models: "stream-model", Status: common.ChannelStatusEnabled}
	require.NoError(t, db.Create(&channel).Error)
	require.NoError(t, db.Create(&model.Ability{ChannelId: channel.Id, Group: "default", Model: "stream-model", Enabled: true}).Error)
	entered, cancelled, finish := make(chan struct{}), make(chan struct{}), make(chan struct{})
	done := make(chan *httptest.ResponseRecorder, 1)
	finishRequest := sync.OnceFunc(func() { close(finish) })
	defer finishRequest()
	router := gin.New()
	router.POST("/v1/chat/completions", func(c *gin.Context) {
		common.SetContextKey(c, constant.ContextKeyUserId, 91)
		common.SetContextKey(c, constant.ContextKeyUserGroup, "default")
		common.SetContextKey(c, constant.ContextKeyUsingGroup, "default")
	}, middleware.BodyStorageCleanup(), middleware.Distribute(), func(c *gin.Context) {
		c.Header("Content-Type", "text/event-stream")
		_, _ = c.Writer.WriteString("data: first\n\n")
		c.Writer.Flush()
		close(entered)
		<-c.Request.Context().Done()
		close(cancelled)
		<-finish
	})
	request := func(ctx context.Context) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(`{"model":"stream-model","stream":true}`)).WithContext(ctx)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Accept-Language", "zh-CN")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { done <- request(ctx) }()
	select {
	case <-entered:
	case response := <-done:
		t.Fatalf("stream never entered handler: %d %s", response.Code, response.Body.String())
	case <-time.After(5 * time.Second):
		t.Fatal("stream never entered handler")
	}
	blocked := request(context.Background())
	assert.Equal(t, 429, blocked.Code)
	assert.Contains(t, blocked.Body.String(), "user_concurrency_exceeded")
	assert.Contains(t, blocked.Body.String(), "已达到账户并发上限，请稍后重试。")
	cancel()
	<-cancelled
	assert.Equal(t, 429, request(context.Background()).Code, "cancelled transports still own capacity while handlers unwind")
	finishRequest()
	<-done
	store, err := policy.CurrentStore()
	require.NoError(t, err)
	rows, err := store.Snapshot(context.Background())
	require.NoError(t, err)
	for _, row := range rows {
		if row.Resource == "user:91" || row.Resource == "channel:111" {
			assert.Zero(t, row.Active)
		}
	}
	oldRDB := common.RDB
	t.Cleanup(func() { common.RDB = oldRDB })
	common.RedisEnabled, common.RDB = true, nil
	_, admissionErr := middleware.AdmitConcurrency(concurrencyContext(91))
	require.NotNil(t, admissionErr)
	assert.Equal(t, 503, admissionErr.StatusCode)
	closed := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})
	require.NoError(t, closed.Close())
	common.RDB = closed
	_, admissionErr = middleware.AdmitConcurrency(concurrencyContext(91))
	require.NotNil(t, admissionErr)
	assert.Equal(t, "concurrency_unavailable", string(admissionErr.GetErrorCode()))
	assert.False(t, errors.Is(admissionErr, context.Canceled))
}

func concurrencyWebSocketPair(t *testing.T) (*websocket.Conn, *websocket.Conn) {
	t.Helper()
	accepted := make(chan *websocket.Conn, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		peer, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if assert.NoError(t, err) {
			accepted <- peer
		}
	}))
	t.Cleanup(server.Close)
	client, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	require.NoError(t, err)
	peer := <-accepted
	t.Cleanup(func() { _ = client.Close(); _ = peer.Close() })
	return client, peer
}

func TestRealtimeCancellationClosesPeersBeforeReleasingCapacity(t *testing.T) {
	client, clientPeer := concurrencyWebSocketPair(t)
	target, targetPeer := concurrencyWebSocketPair(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/v1/realtime", nil).WithContext(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		apiErr, _ := openai.OpenaiRealtimeHandler(c, &relaycommon.RelayInfo{ClientWs: client, TargetWs: target})
		assert.Nil(t, apiErr)
	}()
	cancel()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("realtime handler ignored request cancellation")
	}
	for _, peer := range []*websocket.Conn{clientPeer, targetPeer} {
		require.NoError(t, peer.SetReadDeadline(time.Now().Add(time.Second)))
		_, _, err := peer.ReadMessage()
		require.Error(t, err)
		var timeout interface{ Timeout() bool }
		assert.False(t, errors.As(err, &timeout) && timeout.Timeout(), "transport must close before handler capacity is released")
	}
}
