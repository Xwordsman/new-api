package luckydraw_test

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	payments "github.com/QuantumNous/new-api/extensions/checkin/policy"
	"github.com/QuantumNous/new-api/extensions/luckydraw"
	"github.com/QuantumNous/new-api/extensions/luckydraw/policy"
	"github.com/QuantumNous/new-api/extensions/referral/ledger"
	"github.com/QuantumNous/new-api/extensions/registrationrisk/guard"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	mysqldriver "github.com/go-sql-driver/mysql"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func openLuckyDB(t *testing.T, migrateExtension bool) *gorm.DB {
	t.Helper()
	require.NoError(t, i18n.Init())
	gin.SetMode(gin.TestMode)
	dialect := os.Getenv("LUCKY_TEST_DIALECT")
	if dialect == "" {
		dialect = "sqlite"
	}
	require.Contains(t, []string{"sqlite", "mysql", "postgres"}, dialect)
	dsn := "local"
	if dialect != "sqlite" {
		dsn = os.Getenv("LUCKY_TEST_" + strings.ToUpper(dialect) + "_DSN")
		require.NotEmpty(t, dsn, "configure a disposable check-in test database")
		if dialect == "mysql" {
			config, err := mysqldriver.ParseDSN(dsn)
			require.NoError(t, err)
			require.Equal(t, "luckydraw_extension_test", config.DBName)
		} else {
			parsed, err := url.Parse(dsn)
			require.NoError(t, err)
			require.Contains(t, []string{"postgres", "postgresql"}, parsed.Scheme)
			require.Equal(t, "/luckydraw_extension_test", parsed.Path)
		}
	}

	oldDB, oldLog := model.DB, model.LOG_DB
	oldMainType, oldLogType := common.MainDatabaseType(), common.LogDatabaseType()
	oldMaster, oldSQLite := common.IsMasterNode, common.SQLitePath
	oldRedis, oldMemory, oldRate := common.RedisEnabled, common.MemoryCacheEnabled, common.CriticalRateLimitEnable
	oldSecret, oldSecure, oldTrusted := common.SessionSecret, common.SessionCookieSecure, common.SessionCookieTrustedURLs
	oldTurnstile, oldSiteKey, oldTurnstileSecret := common.TurnstileCheckEnabled, common.TurnstileSiteKey, common.TurnstileSecretKey
	oldTransport := http.DefaultTransport
	oldReferral, oldRegistration := model.ReferralPaymentHook, model.RegistrationPaymentHook
	oldPayment, oldSubscription, oldRefund := model.CheckinPaymentHook, model.CheckinSubscriptionPaymentHook, model.CheckinRefundHook
	oldRedemption := model.CheckinRedemptionPaymentHook
	common.OptionMapRWMutex.Lock()
	oldOptions := common.OptionMap
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()
	common.RedisEnabled, common.MemoryCacheEnabled, common.CriticalRateLimitEnable = false, false, false
	common.SessionSecret, common.SessionCookieSecure, common.SessionCookieTrustedURLs = "checkin-test-session-secret", false, nil
	common.TurnstileCheckEnabled, common.TurnstileSiteKey, common.TurnstileSecretKey = false, "", ""
	model.ReferralPaymentHook, model.RegistrationPaymentHook = nil, nil
	common.IsMasterNode = false
	common.SQLitePath = filepath.ToSlash(filepath.Join(t.TempDir(), "checkin.db")) + "?_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_txlock=immediate"
	t.Setenv("SQL_DSN", dsn)
	t.Setenv("LOG_SQL_DSN", "")
	t.Setenv("SQL_MAX_LIFETIME", "0")
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLog
		common.SetDatabaseTypes(oldMainType, oldLogType)
		common.IsMasterNode, common.SQLitePath = oldMaster, oldSQLite
		common.RedisEnabled, common.MemoryCacheEnabled, common.CriticalRateLimitEnable = oldRedis, oldMemory, oldRate
		common.SessionSecret, common.SessionCookieSecure, common.SessionCookieTrustedURLs = oldSecret, oldSecure, oldTrusted
		common.TurnstileCheckEnabled, common.TurnstileSiteKey, common.TurnstileSecretKey = oldTurnstile, oldSiteKey, oldTurnstileSecret
		http.DefaultTransport = oldTransport
		model.ReferralPaymentHook, model.RegistrationPaymentHook = oldReferral, oldRegistration
		model.CheckinPaymentHook, model.CheckinSubscriptionPaymentHook, model.CheckinRefundHook = oldPayment, oldSubscription, oldRefund
		model.CheckinRedemptionPaymentHook = oldRedemption
		common.OptionMapRWMutex.Lock()
		common.OptionMap = oldOptions
		common.OptionMapRWMutex.Unlock()
	})
	require.NoError(t, model.InitDB())
	db := model.DB.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	model.DB, model.LOG_DB = db, db
	connection, err := db.DB()
	require.NoError(t, err)
	connection.SetMaxOpenConns(8)
	connection.SetMaxIdleConns(8)
	t.Cleanup(func() { require.NoError(t, connection.Close()) })
	if dialect != "sqlite" {
		query := "SELECT DATABASE()"
		if dialect == "postgres" {
			query = "SELECT current_database()"
		}
		var actual string
		require.NoError(t, db.Raw(query).Scan(&actual).Error)
		require.Equal(t, "luckydraw_extension_test", actual, "refuse to alter a non-test database")
	}
	var version string
	query := "SELECT version()"
	if dialect == "sqlite" {
		query = "SELECT sqlite_version()"
	}
	require.NoError(t, db.Raw(query).Scan(&version).Error)
	t.Logf("database: %s %s", dialect, version)

	tables := []any{
		&policy.Settings{}, &policy.Account{}, &policy.Pool{}, &policy.Stock{}, &policy.Record{}, &policy.Audit{},
		&payments.PaymentRefund{}, &payments.PaymentRecord{}, &payments.Audit{}, &payments.Account{}, &payments.Settings{},
		&model.Checkin{}, &guard.Account{}, &model.UserSession{}, &model.UserAccessToken{},
		&model.UserSubscription{}, &model.SubscriptionPlan{}, &model.SubscriptionOrder{}, &model.TopUp{},
		&model.AuditLog{}, &model.Log{}, &model.Option{}, &model.User{},
	}
	for _, table := range tables {
		require.NoError(t, db.Migrator().DropTable(table))
	}
	hostTables := []any{&model.User{}, &model.TopUp{}, &model.SubscriptionOrder{}, &model.UserSession{}, &model.UserAccessToken{}, &model.Option{}, &model.AuditLog{}, &model.Log{}, &guard.Account{}}
	if migrateExtension {
		hostTables = append(hostTables, &model.Checkin{})
	}
	require.NoError(t, db.AutoMigrate(hostTables...))
	require.NoError(t, payments.Migrate(db))
	if migrateExtension {
		require.NoError(t, policy.Migrate(db))
	}
	return db
}

func luckyUser(t *testing.T, db *gorm.DB, role int) model.User {
	t.Helper()
	name := "ld" + strings.ReplaceAll(common.GetUUID(), "-", "")[:12]
	user := model.User{Username: name, AffCode: name, Role: role, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1}
	require.NoError(t, db.Create(&user).Error)
	return user
}

func luckySettings(t *testing.T, db *gorm.DB, edit func(*policy.Settings)) policy.Settings {
	t.Helper()
	s, err := policy.GetSettings(db)
	require.NoError(t, err)
	edit(&s)
	saved, err := policy.UpdateSettings(db, s, 1)
	require.NoError(t, err)
	return saved
}

func payable(s *policy.Settings) {
	s.Enabled, s.ThresholdAmount, s.Timezone = true, "0", "UTC"
	for i := range s.Prizes {
		s.Prizes[i].Weight = 0
	}
	s.Prizes[1].Weight, s.Prizes[1].Quota = policy.ProbabilityTotal, 100
}

func TestLuckyExactOddsAndValidation(t *testing.T) {
	s, err := policy.DefaultSettings()
	require.NoError(t, err)
	require.NoError(t, policy.ValidateSettings(s))
	for _, tc := range []struct{ n, index int }{{0, 0}, {499999, 0}, {500000, 1}, {799999, 1}, {800000, 2}, {999999, 5}} {
		p, err := policy.SelectPrize(s.Prizes, tc.n)
		require.NoError(t, err)
		assert.Equal(t, s.Prizes[tc.index].ID, p.ID)
	}
	for _, n := range []int{-1, 1000000} {
		_, err := policy.SelectPrize(s.Prizes, n)
		assert.ErrorIs(t, err, policy.ErrInvalid)
	}
	for _, tc := range []struct {
		name string
		edit func(*policy.Settings)
	}{
		{"bad total", func(s *policy.Settings) { s.Prizes[0].Weight-- }},
		{"duplicate", func(s *policy.Settings) { s.Prizes[1].ID = s.Prizes[0].ID }},
		{"case-insensitive stock identity", func(s *policy.Settings) { s.Prizes[1].ID = strings.ToUpper(s.Prizes[0].ID) }},
		{"negative", func(s *policy.Settings) { s.Prizes[1].Quota = -1 }},
		{"fake no-win", func(s *policy.Settings) { s.Prizes[0].Quota = 1 }},
		{"excess quota", func(s *policy.Settings) { s.Prizes[1].Quota = common.MaxWalletQuota + 1 }},
		{"unsafe group", func(s *policy.Settings) { s.AllowedGroups = "default, other" }},
		{"schedule", func(s *policy.Settings) { s.StartsAt, s.EndsAt = 100, 99 }},
		{"timezone", func(s *policy.Settings) { s.Timezone = "Local" }},
		{"no real prize", func(s *policy.Settings) {
			for i := range s.Prizes {
				s.Prizes[i].Weight = 0
			}
			s.Prizes[0].Weight = policy.ProbabilityTotal
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			candidate, _ := policy.DefaultSettings()
			tc.edit(&candidate)
			assert.ErrorIs(t, policy.ValidateSettings(candidate), policy.ErrInvalid)
		})
	}
}

func TestLuckyMigrationPreservesExistingAndAwardedData(t *testing.T) {
	for _, origin := range []string{"fresh", "prefeature-main"} {
		t.Run(origin, func(t *testing.T) {
			db := openLuckyDB(t, false)
			var user model.User
			if origin != "fresh" {
				user = luckyUser(t, db, common.RoleCommonUser)
				require.NoError(t, db.Model(&user).UpdateColumn("quota", 1234567890123).Error)
				require.NoError(t, db.Create(&model.Option{Key: "existing-site-option", Value: "保留站点设置"}).Error)
				require.NoError(t, db.AutoMigrate(&model.Checkin{}))
				require.NoError(t, db.Create(&model.Checkin{UserId: user.Id, CheckinDate: "2026-01-01", QuotaAwarded: 123, CreatedAt: 1}).Error)
				require.NoError(t, payments.RecordPayment(db, user.Id, "before-upgrade", "stripe", ledger.Payment{Amount: "100", Currency: "CNY", PaidAt: 1000000000}))
			}
			for range 2 {
				require.NoError(t, luckydraw.Migrate(db))
			}
			s, err := policy.GetSettings(db)
			require.NoError(t, err)
			assert.False(t, s.Enabled)
			if origin != "fresh" {
				var saved model.User
				require.NoError(t, db.First(&saved, user.Id).Error)
				assert.Equal(t, 1234567890123, saved.Quota)
				var option model.Option
				require.NoError(t, db.First(&option).Error)
				assert.Equal(t, "保留站点设置", option.Value)
				var c model.Checkin
				require.NoError(t, db.First(&c).Error)
				assert.Equal(t, 123, c.QuotaAwarded)
				assert.Error(t, db.Create(&model.Checkin{UserId: user.Id, CheckinDate: "2026-01-01"}).Error)
				var p payments.PaymentRecord
				require.NoError(t, db.First(&p).Error)
				assert.Equal(t, "100", p.Amount)
			} else {
				user = luckyUser(t, db, common.RoleCommonUser)
			}
			s = luckySettings(t, db, payable)
			result, err := policy.Draw(db, user.Id, "migration-request-01", s.Version, time.Now(), false)
			require.NoError(t, err)
			for range 2 {
				require.NoError(t, luckydraw.Migrate(db))
			}
			restored, err := policy.ResultFor(db, user.Id, result.Record.RequestKey)
			require.NoError(t, err)
			require.NotNil(t, restored)
			assert.Equal(t, result.Record, restored.Record)
			require.True(t, db.Migrator().HasIndex(&policy.Record{}, "idx_lucky_request"))
			duplicate := result.Record
			duplicate.ID = 0
			assert.Error(t, db.Create(&duplicate).Error)
			var stock policy.Stock
			require.NoError(t, db.First(&stock, "prize_id = ?", s.Prizes[1].ID).Error)
			assert.EqualValues(t, 1, stock.Awarded)
			loaded, err := policy.GetSettings(db)
			require.NoError(t, err)
			assert.Equal(t, s, loaded)
		})
	}
}

func TestLuckyConcurrentIdempotencyAndDailyLimits(t *testing.T) {
	db := openLuckyDB(t, true)
	user := luckyUser(t, db, common.RoleCommonUser)
	other := luckyUser(t, db, common.RoleCommonUser)
	s := luckySettings(t, db, payable)
	now := time.Date(2026, 1, 15, 23, 59, 0, 0, time.UTC)
	var wg sync.WaitGroup
	results := make([]*policy.Result, 4)
	errs := make([]error, 4)
	for i := range results {
		wg.Go(func() { results[i], errs[i] = policy.Draw(db, user.Id, "same-request-0001", s.Version, now, false) })
	}
	wg.Wait()
	fresh := 0
	for i, r := range results {
		require.NoError(t, errs[i])
		require.NotNil(t, r)
		assert.Equal(t, results[0].Record.ID, r.Record.ID)
		if !r.Replay {
			fresh++
		}
	}
	assert.Equal(t, 1, fresh)
	_, err := policy.ResultFor(db, other.Id, "same-request-0001")
	require.NoError(t, err)
	missing, err := policy.ResultFor(db, other.Id, "same-request-0001")
	require.NoError(t, err)
	assert.Nil(t, missing)
	_, err = policy.Draw(db, user.Id, "another-request-01", s.Version, now, false)
	assert.ErrorIs(t, err, policy.ErrAttempts)
	s = luckySettings(t, db, func(s *policy.Settings) { s.Enabled = false; s.Prizes[1].Quota = 200; s.Prizes[1].Name = "Changed" })
	replay, err := policy.Draw(db, user.Id, "same-request-0001", 1, now, false)
	require.NoError(t, err)
	assert.True(t, replay.Replay)
	assert.Equal(t, 100, replay.Record.QuotaAwarded)
	assert.NotEqual(t, "Changed", replay.Prizes[1].Name)
	_, err = policy.Draw(db, user.Id, "new-disabled-key-01", s.Version, now, false)
	assert.ErrorIs(t, err, policy.ErrDisabled)
	s = luckySettings(t, db, func(s *policy.Settings) { s.Enabled = true; s.Timezone = "America/Los_Angeles" })
	_, err = policy.Draw(db, user.Id, "timezone-request01", s.Version, now, false)
	assert.ErrorIs(t, err, policy.ErrAttempts)
	_, err = policy.Draw(db, user.Id, "next-day-request01", s.Version, now.Add(time.Minute), false)
	require.NoError(t, err, "zone edits cannot reset attempts before the previously promised reset time")
	var wallet model.User
	require.NoError(t, db.First(&wallet, user.Id).Error)
	assert.Equal(t, 300, wallet.Quota)
	// Multiple distinct requests compete for one remaining daily slot.
	for i := range results {
		wg.Go(func() {
			results[i], errs[i] = policy.Draw(db, other.Id, fmt.Sprintf("distinct-key-%016d", i), s.Version, now, false)
		})
	}
	wg.Wait()
	fresh = 0
	for _, err := range errs {
		if err == nil {
			fresh++
		} else {
			assert.ErrorIs(t, err, policy.ErrAttempts)
		}
	}
	assert.Equal(t, 1, fresh)
}

func TestLuckyExhaustionNeverConsumesAnAttemptOrChangesOdds(t *testing.T) {
	db := openLuckyDB(t, true)
	now := time.Now()
	for _, tc := range []struct {
		name string
		want error
		edit func(*policy.Settings)
	}{
		{"daily budget", policy.ErrBudget, func(s *policy.Settings) { s.DailyBudgetQuota = 150 }},
		{"total budget", policy.ErrBudget, func(s *policy.Settings) { s.TotalBudgetQuota = 150 }},
		{"user cap", policy.ErrCap, func(s *policy.Settings) { s.UserCapQuota = 150 }},
		{"stock", policy.ErrStock, func(s *policy.Settings) { s.Prizes[1].Stock = 1 }},
		{"wallet", policy.ErrWallet, func(s *policy.Settings) {}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			user := luckyUser(t, db, common.RoleCommonUser)
			// Reset the shared activity pool between independent cases.
			require.NoError(t, db.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&policy.Stock{}).Error)
			require.NoError(t, db.Model(&policy.Pool{}).Where("id = ?", 1).Updates(map[string]any{"total_quota": 0, "daily_quota": 0}).Error)
			s := luckySettings(t, db, func(s *policy.Settings) {
				payable(s)
				s.DailyAttempts = 3
				s.DailyBudgetQuota, s.TotalBudgetQuota, s.UserCapQuota = 0, 0, 0
				s.Prizes[1].Stock = 0
				tc.edit(s)
			})
			_, err := policy.Draw(db, user.Id, "first-request-0001", s.Version, now, false)
			require.NoError(t, err)
			if tc.name == "wallet" {
				require.NoError(t, db.Model(&model.User{}).Where("id = ?", user.Id).UpdateColumn("quota", common.MaxWalletQuota-50).Error)
			}
			// Even a one-in-a-million credit prize must remain fully payable.
			s = luckySettings(t, db, func(s *policy.Settings) { s.Prizes[0].Weight = 999999; s.Prizes[1].Weight = 1 })
			_, err = policy.Draw(db, user.Id, "second-request-001", s.Version, now, false)
			assert.ErrorIs(t, err, tc.want)
			var account policy.Account
			require.NoError(t, db.First(&account, "user_id = ?", user.Id).Error)
			assert.Equal(t, 1, account.Attempts)
			assert.Equal(t, 100, account.TotalQuota)
			var count int64
			require.NoError(t, db.Model(&policy.Record{}).Where("user_id = ?", user.Id).Count(&count).Error)
			assert.EqualValues(t, 1, count)
			d, err := policy.Dashboard(db, user.Id, now)
			require.NoError(t, err)
			assert.False(t, d.Drawable)
		})
	}
}

func TestLuckyPaymentQualificationRefundsAndAccessRules(t *testing.T) {
	db := openLuckyDB(t, true)
	user := luckyUser(t, db, common.RoleCommonUser)
	now := time.Date(2026, 1, 15, 12, 0, 0, 0, time.UTC)
	s := luckySettings(t, db, func(s *policy.Settings) { payable(s); s.ThresholdAmount = "100"; s.DailyAttempts = 100 })
	require.NoError(t, db.Model(&user).UpdateColumn("quota", 50000).Error)
	_, err := policy.Draw(db, user.Id, "gift-not-payment01", s.Version, now, false)
	assert.ErrorIs(t, err, policy.ErrPayment)
	require.NoError(t, payments.RecordPayment(db, user.Id, "real-payment", "epay", ledger.Payment{Amount: "100", Currency: "CNY", PaidAt: now.Add(-48 * time.Hour).Unix()}))
	_, err = policy.Draw(db, user.Id, "real-payment-draw01", s.Version, now, false)
	require.NoError(t, err)
	require.NoError(t, payments.RefundPayment(db, "real-payment", "1", "verified refund", 1))
	_, err = policy.Draw(db, user.Id, "refund-rejected-01", s.Version, now, false)
	assert.ErrorIs(t, err, policy.ErrPayment)
	require.NoError(t, payments.RecordSubscriptionPayment(db, user.Id, "subscription", "stripe", ledger.Payment{Amount: "1", Currency: "CNY", PaidAt: now.Add(-24 * time.Hour).Unix()}))
	_, err = policy.Draw(db, user.Id, "subscription-off01", s.Version, now, false)
	assert.ErrorIs(t, err, policy.ErrPayment)
	s = luckySettings(t, db, func(s *policy.Settings) { s.IncludeSubscriptions = true })
	_, err = policy.Draw(db, user.Id, "subscription-on001", s.Version, now, false)
	require.NoError(t, err)
	s = luckySettings(t, db, func(s *policy.Settings) { s.RechargeMode = "rolling"; s.LookbackDays = 1 })
	_, err = policy.Draw(db, user.Id, "rolling-rejected01", s.Version, now, false)
	assert.ErrorIs(t, err, policy.ErrPayment)
	s = luckySettings(t, db, func(s *policy.Settings) {
		s.RechargeMode = "lifetime"
		s.EligibilityDays = 1
		s.RenewOnRecharge = false
	})
	_, err = policy.Draw(db, user.Id, "expired-request001", s.Version, now, false)
	assert.ErrorIs(t, err, policy.ErrExpired)
	s = luckySettings(t, db, func(s *policy.Settings) { s.EligibilityDays = 0; s.AllowedGroups = "vip" })
	_, err = policy.Draw(db, user.Id, "wrong-group-key001", s.Version, now, false)
	assert.ErrorIs(t, err, policy.ErrGroup)
	s = luckySettings(t, db, func(s *policy.Settings) { s.AllowedGroups = "default" })
	_, err = policy.UpdateAccount(db, user.Id, 1, "paused", "duplicate account review")
	require.NoError(t, err)
	_, err = policy.Draw(db, user.Id, "paused-request001", s.Version, now, false)
	assert.ErrorIs(t, err, policy.ErrPaused)
	_, err = policy.UpdateAccount(db, user.Id, 1, "active", "review completed")
	require.NoError(t, err)
	risk := guard.Account{UserID: user.Id, State: "review"}
	require.NoError(t, db.Create(&risk).Error)
	_, err = policy.Draw(db, user.Id, "risk-review-key001", s.Version, now, false)
	assert.ErrorIs(t, err, policy.ErrRisk)
	s = luckySettings(t, db, func(s *policy.Settings) { s.FollowRegistrationRisk = false; s.StartsAt = now.Add(time.Hour).Unix() })
	_, err = policy.Draw(db, user.Id, "scheduled-request1", s.Version, now, false)
	assert.ErrorIs(t, err, policy.ErrSchedule)
	s = luckySettings(t, db, func(s *policy.Settings) { s.StartsAt = 0; s.RequireTurnstile = true })
	_, err = policy.Draw(db, user.Id, "captcha-request001", s.Version, now, false)
	assert.ErrorIs(t, err, policy.ErrVerifyConfig)
	common.TurnstileCheckEnabled, common.TurnstileSiteKey, common.TurnstileSecretKey = true, "test-site", "test-secret"
	_, err = policy.Draw(db, user.Id, "captcha-request001", s.Version, now, false)
	assert.ErrorIs(t, err, policy.ErrVerify)
	_, err = policy.Draw(db, user.Id, "captcha-request001", s.Version, now, true)
	require.NoError(t, err)
	_, err = policy.Draw(db, user.Id, "stale-version-0001", s.Version-1, now, true)
	assert.ErrorIs(t, err, policy.ErrConflict)
	_, err = policy.UpdateSettings(db, policy.Settings{}, 1)
	assert.ErrorIs(t, err, policy.ErrInvalid)
	_, err = policy.UpdateSettings(db, s, 1)
	require.NoError(t, err)
	_, err = policy.UpdateSettings(db, s, 1)
	assert.ErrorIs(t, err, policy.ErrConflict)
}

func luckyToken(t *testing.T, db *gorm.DB, user model.User) string {
	t.Helper()
	session := model.UserSession{SID: fmt.Sprintf("lucky-http-%d", user.Id), UserID: user.Id, Version: 1, UserAuthVersion: user.AuthVersion, Status: model.UserSessionStatusActive, RefreshHash: strings.Repeat("0", 64), LoginMethod: "password", LastActiveAt: time.Now().Unix(), ExpiresAt: time.Now().Unix() + 3600}
	require.NoError(t, model.CreateUserSession(&session))
	token, _, err := service.IssueAccessToken(service.AuthIdentity{UserID: user.Id, SessionID: session.SID, UserAuthVersion: user.AuthVersion, SessionVersion: 1})
	require.NoError(t, err)
	return token
}

func TestLuckyHTTPAuthorityHistoryIsolationAndReplay(t *testing.T) {
	db := openLuckyDB(t, true)
	s := luckySettings(t, db, payable)
	root := luckyUser(t, db, common.RoleRootUser)
	user := luckyUser(t, db, common.RoleCommonUser)
	other := luckyUser(t, db, common.RoleCommonUser)
	rootToken, token, otherToken := luckyToken(t, db, root), luckyToken(t, db, user), luckyToken(t, db, other)
	router := gin.New()
	luckydraw.RegisterRoutes(router.Group("/api"))
	request := func(method, path, bearer string, body []byte) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "http://lucky.example/api/extensions/lucky-draw/"+path, bytes.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", "http://lucky.example")
		if bearer != "" {
			r.Header.Set("Authorization", "Bearer "+bearer)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	for _, path := range []string{"dashboard", "history", "winners", "result/unknown-request01", "settings", "records", "summary", "accounts", "audit"} {
		assert.NotEqual(t, 200, request("GET", path, "", nil).Code)
	}
	for _, path := range []string{"settings", "records", "summary", "accounts", "audit"} {
		assert.NotEqual(t, 200, request("GET", path, token, nil).Code)
		assert.Equal(t, 200, request("GET", path, rootToken, nil).Code)
	}
	settings := request("GET", "settings", rootToken, nil)
	var settingsResponse struct {
		Data policy.Settings `json:"data"`
	}
	require.NoError(t, common.Unmarshal(settings.Body.Bytes(), &settingsResponse))
	assert.Equal(t, s.Prizes, settingsResponse.Data.Prizes, "administrators retain exact prize weights")
	body, err := common.Marshal(map[string]any{"request_key": "http-request-0001", "version": s.Version})
	require.NoError(t, err)
	for _, origin := range []string{"", "http://untrusted.example"} {
		r := httptest.NewRequest("POST", "http://lucky.example/api/extensions/lucky-draw/draw", bytes.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Authorization", "Bearer "+token)
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		assert.Equal(t, http.StatusForbidden, w.Code)
	}
	awarded := request("POST", "draw", token, body)
	assert.Equal(t, 200, awarded.Code)
	assert.Contains(t, awarded.Body.String(), `"success":true`)
	replay := request("POST", "draw", token, body)
	assert.Contains(t, replay.Body.String(), `"replay":true`)
	for _, response := range []*httptest.ResponseRecorder{
		request("GET", "dashboard", token, nil),
		awarded,
		replay,
		request("GET", "result/http-request-0001", token, nil),
	} {
		require.Equal(t, http.StatusOK, response.Code)
		var payload struct {
			Success bool `json:"success"`
			Data    struct {
				Rules struct {
					Version int              `json:"version"`
					Prizes  []map[string]any `json:"prizes"`
				} `json:"rules"`
				Prizes []map[string]any `json:"prizes"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
		require.True(t, payload.Success)
		prizes := payload.Data.Prizes
		if payload.Data.Rules.Prizes != nil {
			assert.Equal(t, s.Version, payload.Data.Rules.Version)
			prizes = payload.Data.Rules.Prizes
		}
		require.Len(t, prizes, len(s.Prizes))
		for i, prize := range prizes {
			assert.NotContains(t, prize, "weight", "user responses must not disclose prize probabilities")
			assert.Equal(t, s.Prizes[i].ID, prize["id"])
			assert.Equal(t, s.Prizes[i].Name, prize["name"])
			assert.Equal(t, s.Prizes[i].Kind, prize["kind"])
			assert.Equal(t, float64(s.Prizes[i].Quota), prize["quota"])
			assert.Equal(t, s.Prizes[i].Color, prize["color"])
		}
	}
	var saved struct {
		Data policy.Result `json:"data"`
	}
	require.NoError(t, common.Unmarshal(awarded.Body.Bytes(), &saved))
	snapshotPath := fmt.Sprintf("records/%d", saved.Data.Record.ID)
	assert.NotEqual(t, http.StatusOK, request("GET", snapshotPath, token, nil).Code)
	var snapshotResponse struct {
		Data struct {
			Settings policy.Settings `json:"settings"`
		} `json:"data"`
	}
	snapshot := request("GET", snapshotPath, rootToken, nil)
	require.Equal(t, http.StatusOK, snapshot.Code)
	require.NoError(t, common.Unmarshal(snapshot.Body.Bytes(), &snapshotResponse))
	assert.Equal(t, s.Prizes, snapshotResponse.Data.Settings.Prizes, "administrator snapshots retain original prize weights")
	history := request("GET", "history", otherToken, nil)
	assert.Contains(t, history.Body.String(), `"total":0`)
	hidden := request("GET", fmt.Sprintf("history?user_id=%d", user.Id), otherToken, nil)
	assert.Contains(t, hidden.Body.String(), `"total":0`)
	absent := request("GET", "result/http-request-0001", otherToken, nil)
	assert.Contains(t, absent.Body.String(), `"data":null`)
	disabledWinners := request("GET", "winners", token, nil)
	assert.Contains(t, disabledWinners.Body.String(), `"data":[]`)
	invalid := request("POST", "draw", token, []byte(`{"request_key":"short","version":1}`))
	assert.Contains(t, invalid.Body.String(), `"success":false`)
	var a policy.Account
	require.NoError(t, db.First(&a, "user_id = ?", user.Id).Error)
	assert.Equal(t, 1, a.Attempts)
}
