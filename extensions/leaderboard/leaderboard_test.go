package leaderboard

import (
	"bytes"
	"context"
	"fmt"
	"math"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/extensions/leaderboard/record"
	"github.com/QuantumNous/new-api/extensions/referral/ledger"
	"github.com/QuantumNous/new-api/middleware"
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

func leaderboardDB(t *testing.T, dialect string) *gorm.DB {
	t.Helper()
	var driver gorm.Dialector = sqlite.Open(":memory:")
	if dialect != "sqlite" {
		dsn := os.Getenv("LEADERBOARD_TEST_" + strings.ToUpper(dialect) + "_DSN")
		require.Contains(t, dsn, "/leaderboard_extension_test?")
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
	t.Cleanup(func() {
		record.Configure(nil, record.Policy{})
		require.NoError(t, connection.Close())
	})
	for _, table := range []any{&Snapshot{}, &record.Saving{}, &record.Receipt{}, &record.Warning{}, &ledger.Binding{}, &ledger.Reward{}, &model.QuotaData{}, &model.User{}, &model.Option{}} {
		require.NoError(t, db.Migrator().DropTable(table))
	}
	require.NoError(t, db.AutoMigrate(&ledger.Binding{}, &ledger.Reward{}, &model.QuotaData{}, &model.User{}, &model.Option{}))
	require.NoError(t, Migrate(db))
	return db
}

func TestLeaderboardAggregationAndSettlementDatabaseMatrix(t *testing.T) {
	dialects := []string{"sqlite"}
	if os.Getenv("LEADERBOARD_TEST_EXTERNAL") == "1" {
		dialects = append(dialects, "mysql", "postgres")
	}
	for _, dialect := range dialects {
		t.Run(dialect, func(t *testing.T) {
			db := leaderboardDB(t, dialect)
			ctx := context.Background()
			now := time.Date(2026, 11, 9, 10, 0, 0, 0, beijing)
			today := dayStart(now)
			users := []model.User{
				{Id: 1, Username: "alpha", DisplayName: "甲用户", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AffCode: "alpha"},
				{Id: 2, Username: "beta", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AffCode: "beta"},
				{Id: 3, Username: "admin", Role: common.RoleAdminUser, Status: common.UserStatusEnabled, AffCode: "admin"},
				{Id: 4, Username: "disabled", Role: common.RoleCommonUser, Status: common.UserStatusDisabled, AffCode: "disabled"},
				{Id: 5, Username: "excluded", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AffCode: "excluded"},
				{Id: 6, Username: "deleted", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AffCode: "deleted", DeletedAt: gorm.DeletedAt{Time: now, Valid: true}},
			}
			require.NoError(t, db.Create(&users).Error)
			s := defaults()
			s.ExcludedUserIDs = []int{5}
			saved, err := saveSettings(db, s)
			require.NoError(t, err)
			_, err = saveSettings(db, s)
			require.ErrorIs(t, err, errConflict, "stale saves must not overwrite a newer policy")

			bindings := []ledger.Binding{
				{UserID: 2, InviterID: 1, RegisteredAt: today, State: "active"},
				{UserID: 5, InviterID: 1, RegisteredAt: today - 1, State: "active"},
				{UserID: 3, InviterID: 1, RegisteredAt: today + 1, State: "active"}, // unpaid
				{UserID: 4, InviterID: 1, RegisteredAt: today + 1, State: "active"}, // disabled invitee
				{UserID: 6, InviterID: 1, RegisteredAt: today + 1, State: "active"}, // deleted invitee
			}
			require.NoError(t, db.Create(&bindings).Error)
			rewards := []ledger.Reward{
				{TradeNo: "claimed-today", UserID: 2, InviterID: 1, PaidQuota: 1000, Quota: 50, Reversed: 10, State: "claimed", ClaimedAt: today},
				{TradeNo: "claimed-yesterday", UserID: 5, InviterID: 2, PaidQuota: 1000, Quota: 70, State: "claimed", ClaimedAt: today - 1},
				{TradeNo: "pending", UserID: 2, InviterID: 1, PaidQuota: 1000, Quota: 100, State: "pending", PaidAt: today},
				{TradeNo: "paid-yesterday", UserID: 5, InviterID: 1, PaidQuota: 1000, Quota: 10, State: "pending", PaidAt: today - 1},
				{TradeNo: "old-import", UserID: 2, InviterID: 1, Quota: 1000, State: "claimed", ClaimedAt: today, Historical: true},
				{TradeNo: "fully-refunded", UserID: 4, InviterID: 1, PaidQuota: 1000, RefundedQuota: 1000, Quota: 100, Reversed: 100, State: "claimed", ClaimedAt: today},
			}
			require.NoError(t, db.Create(&rewards).Error)
			quota := []model.QuotaData{
				{UserID: 1, TokenUsed: 300, CreatedAt: today}, {UserID: 1, TokenUsed: 200, CreatedAt: today - 1},
				{UserID: 2, TokenUsed: 300, CreatedAt: today}, {UserID: 2, TokenUsed: 100, CreatedAt: today - 86401},
				{UserID: 3, TokenUsed: 99999, CreatedAt: today}, {UserID: 4, TokenUsed: 99999, CreatedAt: today},
				{UserID: 5, TokenUsed: 99999, CreatedAt: today}, {UserID: 6, TokenUsed: 99999, CreatedAt: today},
				{UserID: 2, TokenUsed: 99999, CreatedAt: now.Unix() + 1}, // future fact
			}
			require.NoError(t, db.Create(&quota).Error)
			require.NoError(t, record.SetSavings(ctx, db, "settled-secret-request", 1, 100, today-1))
			require.NoError(t, record.SetSavings(ctx, db, "settled-secret-request", 1, 100, today)) // retry
			require.NoError(t, record.SetSavings(ctx, db, "settled-secret-request", 1, 60, today))  // correction
			require.NoError(t, record.SetSavings(ctx, db, "another", 1, 50, today))
			require.NoError(t, record.SetSavings(ctx, db, "refunded", 2, 900, today-1))
			require.NoError(t, record.SetSavings(ctx, db, "refunded", 2, 0, today))
			warnings := []record.Warning{
				{Key: "warning-today", UserID: 1, Model: "gpt-5", Code: "content_filter", CreatedAt: today},
				{Key: "warning-yesterday", UserID: 2, Model: "gpt-5", Code: "content_filter", CreatedAt: today - 1},
				{Key: "warning-expired", UserID: 1, Model: "gpt-5", Code: "content_filter", CreatedAt: now.Unix() - 91*86400},
			}
			require.NoError(t, db.Create(&warnings).Error)
			require.NoError(t, aggregate(ctx, db, now))
			view, err := present(ctx, db, 1, now)
			require.NoError(t, err)
			assert.False(t, view.Pending)
			assert.False(t, view.Stale)
			require.Len(t, view.Boards, 5)
			assert.Equal(t, []publicRank{{Rank: 1, Name: "甲用户", Value: 1, IsMe: true}}, view.Boards["invitations"]["today"])
			assert.Equal(t, int64(1), view.Boards["invitations"]["yesterday"][0].Value)
			assert.Equal(t, int64(2), view.Boards["invitations"]["all"][0].Value)
			assert.Equal(t, int64(40), view.Boards["income"]["today"][0].Value)
			assert.Equal(t, "b***", view.Boards["income"]["yesterday"][0].Name)
			assert.Equal(t, int64(70), view.Boards["income"]["yesterday"][0].Value)
			assert.Equal(t, []publicRank{{Rank: 1, Name: "甲用户", Value: 300, IsMe: true}, {Rank: 2, Name: "b***", Value: 300}}, view.Boards["tokens"]["today"])
			assert.Equal(t, int64(500), view.Boards["tokens"]["all"][0].Value)
			assert.Equal(t, int64(10), view.Boards["savings"]["today"][0].Value)
			assert.Equal(t, int64(110), view.Boards["savings"]["all"][0].Value)
			assert.Equal(t, int64(1), view.Boards["cyber"]["all"][0].Value)
			var warningCount int64
			require.NoError(t, db.Model(&record.Warning{}).Count(&warningCount).Error)
			assert.Equal(t, int64(2), warningCount)
			var receipts []record.Receipt
			require.NoError(t, db.Find(&receipts).Error)
			encoded, err := common.Marshal(receipts)
			require.NoError(t, err)
			assert.NotContains(t, string(encoded), "settled-secret-request")
			encoded, err = common.Marshal(view)
			require.NoError(t, err)
			assert.NotContains(t, string(encoded), "user_id")
			assert.NotContains(t, string(encoded), "beta")

			// An account disabled after publication disappears immediately.
			require.NoError(t, db.Model(&model.User{}).Where("id = ?", 1).Update("status", common.UserStatusDisabled).Error)
			view, err = present(ctx, db, 2, now)
			require.NoError(t, err)
			assert.Equal(t, []publicRank{{Rank: 1, Name: "beta", Value: 300, IsMe: true}}, view.Boards["tokens"]["today"])
			view, err = present(ctx, db, 2, now.Add(33*time.Minute))
			require.NoError(t, err)
			assert.True(t, view.Stale)
			view, err = present(ctx, db, 2, now.Add(24*time.Hour))
			require.NoError(t, err)
			assert.True(t, view.Pending, "yesterday's daily board must not be labeled today")
			assert.Empty(t, view.Boards["tokens"]["today"])

			// Settings and the signed journal survive repeated migrations.
			require.NoError(t, Migrate(db))
			require.NoError(t, Migrate(db))
			retained, _, err := getSettings(db)
			require.NoError(t, err)
			assert.Equal(t, saved, retained)
			var sum int64
			require.NoError(t, db.Model(&record.Saving{}).Select("SUM(amount)").Scan(&sum).Error)
			assert.Equal(t, int64(110), sum)
			assert.True(t, db.Migrator().HasIndex(&record.Saving{}, "leaderboard_saving_version"))
			saved.Enabled = false
			_, err = saveSettings(db, saved)
			require.NoError(t, err)
			view, err = present(ctx, db, 2, now)
			require.NoError(t, err)
			assert.False(t, view.Enabled)
			assert.Empty(t, view.Boards)
		})
	}
}

func TestSavingsUsesFrozenExactPricesAndSuppressesUnreliableAmounts(t *testing.T) {
	for _, tc := range []struct {
		name    string
		basis   record.SavingsBasis
		charged int
		want    int64
	}{
		{"discounted", record.SavingsBasis{Standard: 2, Effective: 1}, 101, 101},
		{"rounded exact baseline", record.SavingsBasis{Standard: 2, Effective: 0.7, StandardQuota: common.GetPointer(101)}, 35, 66},
		{"free with known usage", record.SavingsBasis{Standard: 2, Effective: 0, StandardQuota: common.GetPointer(101)}, 0, 101},
		{"free without usage", record.SavingsBasis{Standard: 2, Effective: 0}, 0, 0},
		{"no discount", record.SavingsBasis{Standard: 1, Effective: 1}, 100, 0},
		{"invalid rate", record.SavingsBasis{Standard: math.Inf(1), Effective: 1}, 100, 0},
		{"clamped charge", record.SavingsBasis{Standard: 2, Effective: 1, Unreliable: true}, 100, 0},
		{"saturated estimate", record.SavingsBasis{Standard: 1e30, Effective: 1}, 100, 0},
		{"negative charge", record.SavingsBasis{Standard: 2, Effective: 1}, -100, 0},
	} {
		t.Run(tc.name, func(t *testing.T) { assert.Equal(t, tc.want, tc.basis.Savings(tc.charged)) })
	}
}

func TestSafetyCollectionMatchesCodesAndDeduplicatesWithoutStoringSecrets(t *testing.T) {
	db := leaderboardDB(t, "sqlite")
	p := defaults().policy()
	record.Configure(db, p)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	record.SafetyWarning(ctx, "private-request-id", 1, "GPT-5", "content_filter", "upstream")
	record.SafetyWarning(ctx, "private-request-id", 1, "gpt-5", "content_filter", "upstream")
	record.SafetyWarning(ctx, "not-safety", 1, "gpt-5", "permission_denied", "forbidden")
	record.SafetyWarning(ctx, "not-gpt", 1, "claude-4", "content_filter", "upstream")
	record.SafetyWarning(ctx, "type-match", 1, "gpt-5", "", "content_policy_violation")
	var rows []record.Warning
	require.NoError(t, db.Find(&rows).Error)
	assert.Len(t, rows, 2)
	encoded, err := common.Marshal(rows)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "private-request-id")
	p.Enabled = false
	record.Configure(db, p)
	record.SafetyWarning(ctx, "disabled", 1, "gpt-5", "content_filter", "upstream")
	var count int64
	require.NoError(t, db.Model(&record.Warning{}).Count(&count).Error)
	assert.Equal(t, int64(2), count)
}

func TestLeaderboardSettingsRejectInvalidRulesAndSnapshotStartsPending(t *testing.T) {
	db := leaderboardDB(t, "sqlite")
	for _, change := range []func(*Settings){
		func(s *Settings) { s.IntervalMinutes = 0 }, func(s *Settings) { s.TopN = 51 },
		func(s *Settings) { s.WarningRetention = 0 }, func(s *Settings) { s.ExcludedUserIDs = []int{-1} },
		func(s *Settings) { s.ModelPrefixes = nil }, func(s *Settings) { s.SafetyCodes = []string{"content*"} },
		func(s *Settings) { s.SafetyCodes = []string{"content\u2003filter"} },
	} {
		s := defaults()
		change(&s)
		_, err := saveSettings(db, s)
		require.ErrorIs(t, err, errInvalid)
	}
	view, err := present(context.Background(), db, 1, time.Now())
	require.NoError(t, err)
	assert.True(t, view.Pending)
	assert.Zero(t, view.UpdatedAt)
}

func TestLeaderboardRoutesRequireSessionAndRootAndEnforceOrigin(t *testing.T) {
	db := leaderboardDB(t, "sqlite")
	oldDB, oldLogs := model.DB, model.LOG_DB
	oldType, oldRedis, oldSecret, oldSecure := common.MainDatabaseType(), common.RedisEnabled, common.SessionSecret, common.SessionCookieSecure
	model.DB, model.LOG_DB = db, db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.RedisEnabled, common.SessionSecret, common.SessionCookieSecure = false, "leaderboard-session-test", true
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogs
		common.SetMainDatabaseType(oldType)
		common.RedisEnabled, common.SessionSecret, common.SessionCookieSecure = oldRedis, oldSecret, oldSecure
	})
	require.NoError(t, db.AutoMigrate(&model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}, &model.SystemTask{}, &model.SystemTaskLock{}))
	require.NoError(t, model.EnsureLegacyAccessTokenRetireAt(time.Now().Unix()))
	tokens := map[string]string{}
	for _, actor := range []struct {
		name string
		role int
	}{{"member", common.RoleCommonUser}, {"admin", common.RoleAdminUser}, {"root", common.RoleRootUser}} {
		user := model.User{Username: actor.name, Role: actor.role, Status: common.UserStatusEnabled, AuthVersion: 1, AffCode: actor.name}
		require.NoError(t, db.Create(&user).Error)
		session := model.UserSession{SID: "leaderboard-" + actor.name, UserID: user.Id, Version: 1, UserAuthVersion: 1, Status: model.UserSessionStatusActive, RefreshHash: "unusable", LoginMethod: "password", LastActiveAt: time.Now().Unix(), ExpiresAt: time.Now().Unix() + 3600}
		require.NoError(t, model.CreateUserSession(&session))
		token, _, err := service.IssueAccessToken(service.AuthIdentity{UserID: user.Id, SessionID: session.SID, UserAuthVersion: 1, SessionVersion: 1})
		require.NoError(t, err)
		tokens[actor.name] = token
	}
	RegisterTasks()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterRoutes(router.Group("/api"))
	for _, route := range router.Routes() {
		rule, ok := middleware.AccessTokenRouteRule(route.Method + " " + route.Path)
		require.True(t, ok)
		assert.Equal(t, "session", rule.Kind())
	}
	for _, tc := range []struct {
		method, path, who, origin, body string
		status                          int
		success                         bool
	}{
		{"GET", "/snapshot", "", "", "", 401, false},
		{"GET", "/snapshot", "member", "", "", 200, true},
		{"GET", "/admin/settings", "member", "", "", 403, false},
		{"GET", "/admin/settings", "admin", "", "", 403, false},
		{"GET", "/admin/settings", "root", "", "", 200, true},
		{"PUT", "/admin/settings", "root", "https://foreign.example", "{}", 403, false},
		{"PUT", "/admin/settings", "root", "https://leaderboard.example", "{broken", 200, false},
		{"POST", "/admin/refresh", "root", "https://foreign.example", "", 403, false},
		{"POST", "/admin/refresh", "root", "https://leaderboard.example", "", 200, true},
	} {
		t.Run(fmt.Sprintf("%s %s %s %s", tc.method, tc.path, tc.who, tc.origin), func(t *testing.T) {
			r := httptest.NewRequest(tc.method, "https://leaderboard.example/api/extensions/leaderboard"+tc.path, bytes.NewBufferString(tc.body))
			r.Header.Set("Content-Type", "application/json")
			if tc.who != "" {
				r.Header.Set("Authorization", "Bearer "+tokens[tc.who])
			}
			if tc.origin != "" {
				r.Header.Set("Origin", tc.origin)
			}
			w := httptest.NewRecorder()
			router.ServeHTTP(w, r)
			require.Equal(t, tc.status, w.Code, w.Body.String())
			if w.Code == 200 {
				var result struct{ Success bool }
				require.NoError(t, common.Unmarshal(w.Body.Bytes(), &result))
				assert.Equal(t, tc.success, result.Success, w.Body.String())
			}
		})
	}
}
