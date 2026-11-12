package checkin_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
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
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/extensions/checkin"
	"github.com/QuantumNous/new-api/extensions/checkin/policy"
	"github.com/QuantumNous/new-api/extensions/referral/ledger"
	"github.com/QuantumNous/new-api/extensions/registrationrisk/guard"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	mysqldriver "github.com/go-sql-driver/mysql"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

func checkinDB(t *testing.T) *gorm.DB {
	t.Helper()
	return openCheckinDB(t, true)
}

// Every test uses a disposable database. The server's actual database name is
// checked before dropping any tables, even when a caller supplies a custom DSN.
func openCheckinDB(t *testing.T, migrateExtension bool) *gorm.DB {
	t.Helper()
	require.NoError(t, i18n.Init())
	gin.SetMode(gin.TestMode)
	dialect := os.Getenv("CHECKIN_TEST_DIALECT")
	if dialect == "" {
		dialect = "sqlite"
	}
	require.Contains(t, []string{"sqlite", "mysql", "postgres"}, dialect)
	dsn := "local"
	if dialect != "sqlite" {
		dsn = os.Getenv("CHECKIN_TEST_" + strings.ToUpper(dialect) + "_DSN")
		require.NotEmpty(t, dsn, "configure a disposable check-in test database")
		if dialect == "mysql" {
			config, err := mysqldriver.ParseDSN(dsn)
			require.NoError(t, err)
			require.Equal(t, "checkin_extension_test", config.DBName)
		} else {
			parsed, err := url.Parse(dsn)
			require.NoError(t, err)
			require.Contains(t, []string{"postgres", "postgresql"}, parsed.Scheme)
			require.Equal(t, "/checkin_extension_test", parsed.Path)
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
		require.Equal(t, "checkin_extension_test", actual, "refuse to alter a non-test database")
	}
	var version string
	query := "SELECT version()"
	if dialect == "sqlite" {
		query = "SELECT sqlite_version()"
	}
	require.NoError(t, db.Raw(query).Scan(&version).Error)
	t.Logf("database: %s %s", dialect, version)

	tables := []any{
		&policy.PaymentRefund{}, &policy.PaymentRecord{}, &policy.Audit{}, &policy.Account{}, &policy.Settings{},
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
	if migrateExtension {
		require.NoError(t, checkin.Migrate(db))
	}
	checkin.Initialize(db)
	return db
}

func checkinUser(t *testing.T, db *gorm.DB, role int) model.User {
	t.Helper()
	name := "ci" + strings.ReplaceAll(common.GetUUID(), "-", "")[:12]
	user := model.User{Username: name, AffCode: name, Role: role, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1}
	require.NoError(t, db.Create(&user).Error)
	return user
}

func checkinSettings(t *testing.T, db *gorm.DB, edit func(*policy.Settings)) policy.Settings {
	t.Helper()
	settings, err := policy.GetSettings(db)
	require.NoError(t, err)
	edit(&settings)
	saved, err := policy.UpdateSettings(db, settings, 1)
	require.NoError(t, err)
	return saved
}

func TestCheckinFixedRewardsPreserveHistoryAndDailyUniqueness(t *testing.T) {
	db := checkinDB(t)
	user := checkinUser(t, db, common.RoleCommonUser)
	other := checkinUser(t, db, common.RoleCommonUser)
	require.NoError(t, db.Model(&user).UpdateColumn("quota", 700).Error)
	settings := checkinSettings(t, db, func(value *policy.Settings) {
		value.Enabled, value.ThresholdAmount, value.Timezone = true, "0", "Asia/Shanghai"
		value.RewardMinQuota, value.RewardMaxQuota = 200, 200
	})
	now := time.Date(2026, 1, 15, 8, 0, 0, 0, time.UTC)
	old := model.Checkin{UserId: user.Id, CheckinDate: "2026-01-14", QuotaAwarded: 100, CreatedAt: now.Add(-24 * time.Hour).Unix()}
	require.NoError(t, db.Create(&old).Error)
	before, err := policy.Dashboard(db, user.Id, "", now)
	require.NoError(t, err)
	assert.True(t, before.Claimable)
	assert.Equal(t, "2026-01-15", before.Today)
	assert.EqualValues(t, 1, before.Stats.TotalCheckins)

	award, err := policy.Claim(db, user.Id, now)
	require.NoError(t, err)
	assert.Equal(t, 200, award.QuotaAwarded)
	assert.Equal(t, "2026-01-15", award.CheckinDate)
	_, err = policy.Claim(db, user.Id, now.Add(time.Minute))
	assert.ErrorIs(t, err, policy.ErrAlreadyChecked)
	var wallet model.User
	require.NoError(t, db.First(&wallet, user.Id).Error)
	assert.Equal(t, 900, wallet.Quota)
	wallet = model.User{}
	require.NoError(t, db.First(&wallet, other.Id).Error)
	assert.Zero(t, wallet.Quota)
	after, err := policy.Dashboard(db, user.Id, "2026-01", now)
	require.NoError(t, err)
	assert.True(t, after.CheckedInToday)
	assert.False(t, after.Claimable)
	assert.Equal(t, policy.ErrAlreadyChecked.Key, after.ClaimReason)
	assert.Equal(t, policy.Stats{TotalCheckins: 2, TotalQuota: 300, MonthCheckins: 2, MonthQuota: 300}, after.Stats)
	assert.Equal(t, []policy.CheckinRecord{{CheckinDate: "2026-01-15", QuotaAwarded: 200}, {CheckinDate: "2026-01-14", QuotaAwarded: 100}}, after.Records)
	assert.Equal(t, time.Date(2026, 1, 15, 16, 0, 0, 0, time.UTC).Unix(), after.NextResetAt)
	var audit policy.Audit
	require.NoError(t, db.First(&audit, "user_id = ? AND action = ?", user.Id, "claim").Error)
	assert.Equal(t, settings.Version, audit.SettingsVersion)
	assert.Equal(t, user.Id, audit.ActorID)
	assert.Error(t, db.Create(&model.Checkin{UserId: user.Id, CheckinDate: award.CheckinDate, QuotaAwarded: 200}).Error)
	_, err = policy.Claim(db, user.Id, time.Unix(after.NextResetAt, 0))
	require.NoError(t, err, "the next reward becomes available at the configured midnight")
	_, _, err = policy.ReadHistory(db, user.Id, "2026-1")
	assert.ErrorIs(t, err, policy.ErrInvalid)
	_, err = policy.Dashboard(db, 0, "", now)
	assert.ErrorIs(t, err, policy.ErrInvalid)
}

func TestCheckinIneligibleAccountsReceiveNoReward(t *testing.T) {
	db := checkinDB(t)
	now := time.Date(2026, 1, 15, 12, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name string
		want error
	}{
		{"disabled", policy.ErrDisabled}, {"unpaid", policy.ErrRechargeRequired},
		{"banned", policy.ErrInactive}, {"deleted", policy.ErrInactive},
		{"paused", policy.ErrPaused}, {"risk review", policy.ErrRiskReview},
		{"invalid risk state", policy.ErrRiskReview},
	} {
		t.Run(tc.name, func(t *testing.T) {
			user := checkinUser(t, db, common.RoleCommonUser)
			checkinSettings(t, db, func(value *policy.Settings) {
				value.Enabled, value.ThresholdAmount, value.Timezone = true, "0", "UTC"
				value.FollowRegistrationRisk = true
				if tc.name == "disabled" {
					value.Enabled = false
				}
				if tc.name == "unpaid" {
					value.ThresholdAmount = "50"
				}
			})
			switch tc.name {
			case "banned":
				require.NoError(t, db.Model(&user).UpdateColumn("status", common.UserStatusDisabled).Error)
			case "deleted":
				require.NoError(t, db.Delete(&user).Error)
			case "paused":
				_, err := policy.UpdateAccount(db, user.Id, 1, "paused", "Manual risk review")
				require.NoError(t, err)
			case "risk review", "invalid risk state":
				state := "review"
				if tc.name == "invalid risk state" {
					state = "unknown"
				}
				require.NoError(t, db.Create(&guard.Account{UserID: user.Id, State: state}).Error)
			}
			_, err := policy.Claim(db, user.Id, now)
			assert.ErrorIs(t, err, tc.want)
			var count int64
			require.NoError(t, db.Model(&model.Checkin{}).Where("user_id = ?", user.Id).Count(&count).Error)
			assert.Zero(t, count)
			var wallet model.User
			require.NoError(t, db.Unscoped().First(&wallet, user.Id).Error)
			assert.Zero(t, wallet.Quota)
			if tc.name == "paused" {
				_, err := policy.UpdateAccount(db, user.Id, 1, "active", "Review completed")
				require.NoError(t, err)
				_, err = policy.Claim(db, user.Id, now)
				require.NoError(t, err)
			}
			if tc.name == "risk review" {
				checkinSettings(t, db, func(value *policy.Settings) { value.FollowRegistrationRisk = false })
				_, err := policy.Claim(db, user.Id, now)
				require.NoError(t, err, "the administrator controls registration-risk enforcement")
			}
		})
	}
}

func TestCheckinRandomRewardsAreBoundedBeforeDrawing(t *testing.T) {
	for _, limit := range []string{"monthly", "lifetime", "daily budget", "wallet"} {
		t.Run(limit, func(t *testing.T) {
			db := checkinDB(t)
			user := checkinUser(t, db, common.RoleCommonUser)
			now := time.Date(2026, 1, 15, 12, 0, 0, 0, time.UTC)
			checkinSettings(t, db, func(value *policy.Settings) {
				value.Enabled, value.ThresholdAmount, value.Timezone = true, "0", "UTC"
				value.RewardMode, value.RewardMinQuota, value.RewardMaxQuota = "random", 100, 500
				switch limit {
				case "monthly":
					value.MonthlyCapQuota = 300
				case "lifetime":
					value.LifetimeCapQuota = 300
				case "daily budget":
					value.DailyBudgetQuota = 300
				}
			})
			if limit == "wallet" {
				require.NoError(t, db.Model(&user).UpdateColumn("quota", common.MaxWalletQuota-100).Error)
			} else {
				owner, date, at := user.Id, "2026-01-14", now.Add(-24*time.Hour).Unix()
				if limit == "daily budget" {
					owner, date, at = checkinUser(t, db, common.RoleCommonUser).Id, "2026-01-15", now.Unix()
				}
				require.NoError(t, db.Create(&model.Checkin{UserId: owner, CheckinDate: date, QuotaAwarded: 200, CreatedAt: at}).Error)
			}
			award, err := policy.Claim(db, user.Id, now)
			require.NoError(t, err)
			assert.Equal(t, 100, award.QuotaAwarded, "only the remaining affordable range may be drawn")
			if limit == "wallet" {
				var wallet model.User
				require.NoError(t, db.First(&wallet, user.Id).Error)
				assert.Equal(t, common.MaxWalletQuota, wallet.Quota, "the database must store the complete 64-bit wallet value")
				_, err = policy.Claim(db, user.Id, now.AddDate(0, 0, 1))
				assert.ErrorIs(t, err, policy.ErrWalletLimit)
			}
			if limit == "monthly" || limit == "lifetime" {
				_, err = policy.Claim(db, user.Id, now.AddDate(0, 0, 1))
				want := policy.ErrMonthlyCap
				if limit == "lifetime" {
					want = policy.ErrLifetimeCap
				}
				assert.ErrorIs(t, err, want)
			}
			if limit == "daily budget" {
				other := checkinUser(t, db, common.RoleCommonUser)
				_, err = policy.Claim(db, other.Id, now)
				assert.ErrorIs(t, err, policy.ErrDailyBudget)
			}
		})
	}
}

func TestCheckinConcurrentClaimsAndPlatformBudget(t *testing.T) {
	for _, scope := range []string{"same account", "shared daily budget"} {
		t.Run(scope, func(t *testing.T) {
			db := checkinDB(t)
			first := checkinUser(t, db, common.RoleCommonUser)
			secondID := first.Id
			if scope == "shared daily budget" {
				secondID = checkinUser(t, db, common.RoleCommonUser).Id
			}
			checkinSettings(t, db, func(value *policy.Settings) {
				value.Enabled, value.ThresholdAmount, value.Timezone = true, "0", "UTC"
				value.RewardMinQuota, value.RewardMaxQuota = 100, 100
				if scope == "shared daily budget" {
					value.DailyBudgetQuota = 100
				}
			})
			now := time.Date(2026, 1, 15, 12, 0, 0, 0, time.UTC)
			ids := []int{first.Id, secondID}
			results := make([]error, len(ids))
			start := make(chan struct{})
			var workers sync.WaitGroup
			for i, userID := range ids {
				workers.Go(func() {
					<-start
					_, results[i] = policy.Claim(db, userID, now)
				})
			}
			close(start)
			workers.Wait()
			successes := 0
			for _, err := range results {
				if err == nil {
					successes++
					continue
				}
				want := policy.ErrAlreadyChecked
				if scope == "shared daily budget" {
					want = policy.ErrDailyBudget
				}
				assert.ErrorIs(t, err, want)
			}
			assert.Equal(t, 1, successes)
			var count, paid, walletTotal int64
			require.NoError(t, db.Model(&model.Checkin{}).Count(&count).Error)
			require.NoError(t, db.Model(&model.Checkin{}).Select("COALESCE(SUM(quota_awarded), 0)").Scan(&paid).Error)
			require.NoError(t, db.Model(&model.User{}).Select("COALESCE(SUM(quota), 0)").Scan(&walletTotal).Error)
			assert.EqualValues(t, 1, count)
			assert.EqualValues(t, 100, paid)
			assert.EqualValues(t, paid, walletTotal)
		})
	}
}

func TestCheckinClaimRollsBackEveryAwardWrite(t *testing.T) {
	for _, target := range []struct{ table, operation string }{
		{"checkins", "create"}, {"users", "update"},
		{"extension_checkin_accounts", "create"}, {"extension_checkin_audits", "create"},
	} {
		t.Run(target.table, func(t *testing.T) {
			db := checkinDB(t)
			user := checkinUser(t, db, common.RoleCommonUser)
			require.NoError(t, db.Model(&user).UpdateColumn("quota", 777).Error)
			checkinSettings(t, db, func(value *policy.Settings) {
				value.Enabled, value.ThresholdAmount, value.Timezone = true, "0", "UTC"
				value.RewardMinQuota, value.RewardMaxQuota = 100, 100
			})
			failure := errors.New("injected check-in storage failure")
			callback := func(tx *gorm.DB) {
				if tx.Statement.Schema != nil && tx.Statement.Schema.Table == target.table {
					tx.AddError(failure)
				}
			}
			name := "test:checkin:rollback:" + target.table
			if target.operation == "update" {
				require.NoError(t, db.Callback().Update().Before("gorm:update").Register(name, callback))
				t.Cleanup(func() { _ = db.Callback().Update().Remove(name) })
			} else {
				require.NoError(t, db.Callback().Create().Before("gorm:create").Register(name, callback))
				t.Cleanup(func() { _ = db.Callback().Create().Remove(name) })
			}
			now := time.Date(2026, 1, 15, 12, 0, 0, 0, time.UTC)
			_, err := policy.Claim(db, user.Id, now)
			require.ErrorIs(t, err, failure)
			var wallet model.User
			require.NoError(t, db.First(&wallet, user.Id).Error)
			assert.Equal(t, 777, wallet.Quota)
			for _, table := range []any{&model.Checkin{}, &policy.Account{}, &policy.Audit{}} {
				var count int64
				require.NoError(t, db.Model(table).Where("user_id = ?", user.Id).Count(&count).Error)
				assert.Zero(t, count)
			}
			if target.operation == "update" {
				require.NoError(t, db.Callback().Update().Remove(name))
			} else {
				require.NoError(t, db.Callback().Create().Remove(name))
			}
			_, err = policy.Claim(db, user.Id, now)
			require.NoError(t, err, "a rolled-back attempt must not consume today's reward")
		})
	}
}

func TestCheckinSettingsCASAndMoneyBounds(t *testing.T) {
	db := checkinDB(t)
	initial, err := policy.GetSettings(db)
	require.NoError(t, err)
	assert.False(t, initial.Enabled)
	assert.Equal(t, "50", initial.ThresholdAmount)
	assert.Equal(t, "CNY", initial.Currency)
	saved := checkinSettings(t, db, func(value *policy.Settings) { value.Enabled = true })
	assert.Equal(t, initial.Version+1, saved.Version)
	_, err = policy.UpdateSettings(db, initial, 1)
	assert.ErrorIs(t, err, policy.ErrConflict)
	for _, tc := range []struct {
		name string
		edit func(*policy.Settings)
	}{
		{"negative threshold", func(v *policy.Settings) { v.ThresholdAmount = "-1" }},
		{"scientific amount", func(v *policy.Settings) { v.ThresholdAmount = "1e2" }},
		{"unbounded amount", func(v *policy.Settings) { v.ThresholdAmount = "1000000000001" }},
		{"zero FX", func(v *policy.Settings) { v.CNYPerUSD = "0" }},
		{"unbounded FX", func(v *policy.Settings) { v.CNYPerUSD = "10001" }},
		{"currency", func(v *policy.Settings) { v.Currency = "EUR" }},
		{"recharge mode", func(v *policy.Settings) { v.RechargeMode = "all" }},
		{"lookback", func(v *policy.Settings) { v.LookbackDays = 0 }},
		{"expiry", func(v *policy.Settings) { v.EligibilityDays = 3651 }},
		{"reward zero", func(v *policy.Settings) { v.RewardMinQuota = 0 }},
		{"reward ceiling", func(v *policy.Settings) { v.RewardMaxQuota = common.MaxWalletQuota + 1 }},
		{"fixed reward mismatch", func(v *policy.Settings) { v.RewardMaxQuota++ }},
		{"negative cap", func(v *policy.Settings) { v.MonthlyCapQuota = -1 }},
		{"budget ceiling", func(v *policy.Settings) { v.DailyBudgetQuota = common.MaxWalletQuota + 1 }},
		{"local timezone", func(v *policy.Settings) { v.Timezone = "Local" }},
		{"unknown timezone", func(v *policy.Settings) { v.Timezone = "Missing/Zone" }},
		{"version ceiling", func(v *policy.Settings) { v.Version = common.MaxWalletQuota }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			candidate := saved
			tc.edit(&candidate)
			_, err := policy.UpdateSettings(db, candidate, 1)
			assert.ErrorIs(t, err, policy.ErrInvalid)
		})
	}
	_, err = policy.UpdateSettings(db, saved, 0)
	assert.ErrorIs(t, err, policy.ErrInvalid)
	failure := errors.New("injected settings audit failure")
	name := "test:checkin:settings-audit"
	require.NoError(t, db.Callback().Create().Before("gorm:create").Register(name, func(tx *gorm.DB) {
		if tx.Statement.Schema != nil && tx.Statement.Schema.Table == "extension_checkin_audits" {
			tx.AddError(failure)
		}
	}))
	t.Cleanup(func() { _ = db.Callback().Create().Remove(name) })
	candidate := saved
	candidate.Enabled = false
	_, err = policy.UpdateSettings(db, candidate, 1)
	assert.ErrorIs(t, err, failure)
	loaded, err := policy.GetSettings(db)
	require.NoError(t, err)
	assert.Equal(t, saved, loaded, "a failed audit must roll back the settings change")
}

func TestCheckinTimezoneChangesPreserveResetAndMonthlySpending(t *testing.T) {
	db := checkinDB(t)
	user := checkinUser(t, db, common.RoleCommonUser)
	checkinSettings(t, db, func(value *policy.Settings) {
		value.Enabled, value.ThresholdAmount, value.Timezone = true, "0", "UTC"
		value.RewardMinQuota, value.RewardMaxQuota, value.MonthlyCapQuota = 100, 100, 100
	})
	now := time.Date(2026, 1, 31, 23, 30, 0, 0, time.UTC)
	award, err := policy.Claim(db, user.Id, now)
	require.NoError(t, err)
	assert.Equal(t, "2026-01-31", award.CheckinDate)
	settings := checkinSettings(t, db, func(value *policy.Settings) { value.Timezone = "Asia/Tokyo" })
	checked, err := policy.CheckinToday(db, user.Id, settings, now.Add(15*time.Minute))
	require.NoError(t, err)
	assert.True(t, checked, "moving midnight cannot grant an earlier second reward")
	_, err = policy.Claim(db, user.Id, now.Add(15*time.Minute))
	assert.ErrorIs(t, err, policy.ErrAlreadyChecked)
	_, err = policy.Claim(db, user.Id, time.Date(2026, 2, 2, 12, 0, 0, 0, time.UTC))
	assert.ErrorIs(t, err, policy.ErrMonthlyCap, "the January calendar row was actually paid in February's new timezone window")
	var preserved model.Checkin
	require.NoError(t, db.First(&preserved, award.ID).Error)
	assert.Equal(t, "2026-01-31", preserved.CheckinDate)
	assert.Equal(t, now.Unix(), preserved.CreatedAt)
}

// This is the unchanged host check-in schema from root release v1.0.0-rc.48.
// It intentionally has no extension fields, reset metadata, or payment facts.
type releasedCheckin struct {
	Id           int    `gorm:"primaryKey;autoIncrement"`
	UserId       int    `gorm:"not null;uniqueIndex:idx_user_checkin_date"`
	CheckinDate  string `gorm:"type:varchar(10);not null;uniqueIndex:idx_user_checkin_date"`
	QuotaAwarded int    `gorm:"not null"`
	CreatedAt    int64  `gorm:"bigint"`
}

func (releasedCheckin) TableName() string { return "checkins" }

func TestCheckinFreshAndReleasedSchemaMigrationIsIdempotent(t *testing.T) {
	for _, origin := range []string{"fresh", "v1.0.0-rc.48"} {
		t.Run(origin, func(t *testing.T) {
			db := openCheckinDB(t, false)
			user := checkinUser(t, db, common.RoleCommonUser)
			require.NoError(t, db.Model(&user).UpdateColumn("quota", 1234567890123).Error)
			options := []model.Option{{Key: "existing-site-option", Value: "保留站点设置"}, {Key: "checkin_setting.enabled", Value: "true"}}
			require.NoError(t, db.Create(&options).Error)
			now := time.Date(2026, 1, 15, 12, 0, 0, 0, time.UTC)
			historical := model.TopUp{UserId: user.Id, TradeNo: "historical-face-value", Amount: 100, Money: 500, PaymentMethod: "alipay", PaymentProvider: model.PaymentProviderEpay, Status: common.TopUpStatusSuccess, CompleteTime: now.Add(-24 * time.Hour).Unix()}
			require.NoError(t, db.Create(&historical).Error)
			var legacy releasedCheckin
			if origin != "fresh" {
				require.NoError(t, db.AutoMigrate(&releasedCheckin{}))
				legacy = releasedCheckin{UserId: user.Id, CheckinDate: "2026-01-14", QuotaAwarded: 123, CreatedAt: now.Add(-24 * time.Hour).Unix()}
				require.NoError(t, db.Create(&legacy).Error)
			}
			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.Checkin{}))
				require.NoError(t, checkin.Migrate(db))
				checkin.Initialize(db)
			}
			settings, err := policy.GetSettings(db)
			require.NoError(t, err)
			assert.False(t, settings.Enabled, "an old native switch must not silently enable the new policy")
			assert.True(t, db.Migrator().HasIndex(&model.Checkin{}, "idx_user_checkin_date"))
			var wallet model.User
			require.NoError(t, db.First(&wallet, user.Id).Error)
			assert.Equal(t, 1234567890123, wallet.Quota)
			for _, wanted := range options {
				var stored model.Option
				require.NoError(t, db.Where(clause.Eq{Column: "key", Value: wanted.Key}).First(&stored).Error)
				assert.Equal(t, wanted.Value, stored.Value)
			}
			var order model.TopUp
			require.NoError(t, db.First(&order, historical.Id).Error)
			assert.Equal(t, historical, order)
			stats, records, err := policy.ReadHistory(db, user.Id, "2026-01")
			require.NoError(t, err)
			if origin != "fresh" {
				assert.Equal(t, policy.Stats{TotalCheckins: 1, TotalQuota: 123, MonthCheckins: 1, MonthQuota: 123}, stats)
				assert.Equal(t, []policy.CheckinRecord{{CheckinDate: legacy.CheckinDate, QuotaAwarded: 123}}, records)
				assert.Error(t, db.Create(&releasedCheckin{UserId: user.Id, CheckinDate: legacy.CheckinDate, QuotaAwarded: 10}).Error, "migration must preserve the unique daily claim constraint")
			} else {
				assert.Empty(t, records)
			}
			qualification, err := policy.PaymentSummary(db, user.Id, settings, now)
			require.NoError(t, err)
			assert.False(t, qualification.Eligible)
			assert.True(t, qualification.QualifiedAmount.IsZero(), "historical order face values are not verified payment facts")
			saved := checkinSettings(t, db, func(value *policy.Settings) {
				value.Enabled, value.ThresholdAmount = true, "100"
				value.RewardMinQuota, value.RewardMaxQuota = 321, 321
			})
			for range 2 {
				require.NoError(t, checkin.Migrate(db))
				checkin.Initialize(db)
			}
			loaded, err := policy.GetSettings(db)
			require.NoError(t, err)
			assert.Equal(t, saved, loaded, "repeated startup must preserve administrator configuration and revision")
		})
	}
}

func TestCheckinPaymentsAccumulateWhileDisabled(t *testing.T) {
	db := checkinDB(t)
	user := checkinUser(t, db, common.RoleCommonUser)
	require.NoError(t, db.Model(&model.User{}).Where("id = ?", user.Id).Update("quota", 1234567).Error)
	settings := checkinSettings(t, db, func(value *policy.Settings) {
		value.Enabled = false
		value.Currency, value.ThresholdAmount, value.CNYPerUSD = "USD", "50", "7.2"
		value.Timezone = "UTC"
	})
	paid := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)
	require.NoError(t, policy.RecordPayment(db, user.Id, "cash-usd", "stripe", ledger.Payment{
		Amount: "25", Currency: "USD", Reference: "pi-usd", PaidAt: paid.Unix(),
	}))
	require.NoError(t, policy.RecordPayment(db, user.Id, "cash-cny", "epay", ledger.Payment{
		Amount: "180", Currency: "CNY", Reference: "receipt-cny", PaidAt: paid.Add(time.Hour).Unix(),
	}))
	qualification, err := policy.PaymentSummary(db, user.Id, settings, paid.Add(24*time.Hour))
	require.NoError(t, err)
	assert.True(t, qualification.Eligible)
	assert.Equal(t, "50", qualification.QualifiedAmount.String())
	assert.Equal(t, paid.Add(time.Hour).Unix(), qualification.QualifiedAt)
	var stored model.User
	require.NoError(t, db.First(&stored, user.Id).Error)
	assert.Equal(t, 1234567, stored.Quota)
	var claims int64
	require.NoError(t, db.Model(&model.Checkin{}).Where("user_id = ?", user.Id).Count(&claims).Error)
	assert.Zero(t, claims)
	var payments int64
	require.NoError(t, db.Model(&policy.PaymentRecord{}).Where("user_id = ?", user.Id).Count(&payments).Error)
	assert.EqualValues(t, 2, payments)
}

func TestCheckinPaymentConversionSnapshotsAndAuditedFX(t *testing.T) {
	db := checkinDB(t)
	user := checkinUser(t, db, common.RoleCommonUser)
	settings := checkinSettings(t, db, func(value *policy.Settings) {
		value.Currency, value.ThresholdAmount, value.CNYPerUSD = "CNY", "100", "7.2"
		value.Timezone = "UTC"
	})
	paid := time.Date(2025, 6, 2, 12, 0, 0, 0, time.UTC)
	for _, payment := range []struct{ trade, currency, amount string }{
		{"old-usd", "USD", "10"}, {"native-cny", "CNY", "72"}, {"unpriced-eur", "EUR", "10"},
	} {
		require.NoError(t, policy.RecordPayment(db, user.Id, payment.trade, "stripe", ledger.Payment{
			Amount: payment.amount, Currency: payment.currency, Reference: payment.trade, PaidAt: paid.Unix(),
		}))
	}
	qualification, err := policy.PaymentSummary(db, user.Id, settings, paid.Add(24*time.Hour))
	require.NoError(t, err)
	assert.Equal(t, "144", qualification.QualifiedAmount.String())
	settings = checkinSettings(t, db, func(value *policy.Settings) { value.CNYPerUSD = "8" })
	require.NoError(t, policy.RecordPayment(db, user.Id, "new-usd", "stripe", ledger.Payment{
		Amount: "10", Currency: "USD", Reference: "new-usd", PaidAt: paid.Add(time.Hour).Unix(),
	}))
	qualification, err = policy.PaymentSummary(db, user.Id, settings, paid.Add(24*time.Hour))
	require.NoError(t, err)
	assert.Equal(t, "224", qualification.QualifiedAmount.String())
	// Retries retain the paid date and the exchange rate captured on receipt.
	require.NoError(t, policy.RecordPayment(db, user.Id, "old-usd", "stripe", ledger.Payment{
		Amount: "10.000", Currency: "USD", Reference: "old-usd", PaidAt: paid.Add(2 * time.Hour).Unix(),
	}))
	reason := strings.Repeat("核", 500)
	payment := ledger.Payment{Amount: "10", Currency: "EUR", Reference: "unpriced-eur", PaidAt: paid.Unix(), USDPerUnit: "1.1"}
	require.ErrorIs(t, policy.RecordPayment(db, user.Id, "unpriced-eur", "stripe", payment), policy.ErrPaymentInvalid)
	require.ErrorIs(t, policy.ReconcilePayment(db, user.Id, "unpriced-eur", "stripe", policy.PaymentSourceTopUp, payment, 0, reason), policy.ErrPaymentInvalid)
	require.ErrorIs(t, policy.ReconcilePayment(db, user.Id, "unpriced-eur", "stripe", policy.PaymentSourceTopUp, payment, 1, "核对"), policy.ErrPaymentInvalid)
	require.ErrorIs(t, policy.ReconcilePayment(db, user.Id, "unpriced-eur", "stripe", policy.PaymentSourceTopUp, payment, 1, strings.Repeat("核", 501)), policy.ErrPaymentInvalid)
	require.NoError(t, policy.ReconcilePayment(db, user.Id, "unpriced-eur", "stripe", policy.PaymentSourceTopUp, payment, 1, "  "+reason+"  "))
	qualification, err = policy.PaymentSummary(db, user.Id, settings, paid.Add(24*time.Hour))
	require.NoError(t, err)
	assert.Equal(t, "303.2", qualification.QualifiedAmount.String())
	settings.Currency = "USD"
	qualification, err = policy.PaymentSummary(db, user.Id, settings, paid.Add(24*time.Hour))
	require.NoError(t, err)
	assert.Equal(t, "41", qualification.QualifiedAmount.String())
	var eur, usd policy.PaymentRecord
	require.NoError(t, db.First(&eur, "trade_no = ?", "unpriced-eur").Error)
	require.NoError(t, db.First(&usd, "trade_no = ?", "old-usd").Error)
	assert.Equal(t, "7.2", eur.CNYPerUSD)
	assert.Equal(t, "1.1", eur.USDPerUnit)
	assert.Equal(t, paid.Unix(), eur.PaidAt)
	assert.Equal(t, 1, eur.ReconciledBy)
	assert.Equal(t, reason, eur.ReconcileReason)
	assert.Equal(t, "7.2", usd.CNYPerUSD)
	assert.Equal(t, paid.Unix(), usd.PaidAt)
	payment.PaidAt = paid.Add(3 * time.Hour).Unix()
	require.NoError(t, policy.ReconcilePayment(db, user.Id, "unpriced-eur", "stripe", policy.PaymentSourceTopUp, payment, 1, reason))
	payment.USDPerUnit = "1.2"
	require.ErrorIs(t, policy.ReconcilePayment(db, user.Id, "unpriced-eur", "stripe", policy.PaymentSourceTopUp, payment, 1, reason), policy.ErrPaymentConflict)
	var audits int64
	require.NoError(t, db.Model(&policy.Audit{}).Where("user_id = ? AND action = ?", user.Id, "payment_reconcile").Count(&audits).Error)
	assert.EqualValues(t, 1, audits)
}

func TestCheckinPaymentEligibilityWindowsAndRenewal(t *testing.T) {
	db := checkinDB(t)
	user := checkinUser(t, db, common.RoleCommonUser)
	unpaid := checkinUser(t, db, common.RoleCommonUser)
	settings := checkinSettings(t, db, func(value *policy.Settings) {
		value.Currency, value.ThresholdAmount = "USD", "50"
		value.Timezone = "UTC"
	})
	now := time.Date(2025, 7, 10, 12, 0, 0, 0, time.UTC)
	for i, payment := range []struct {
		days   int
		amount string
	}{{60, "30"}, {40, "20"}, {5, "5"}} {
		trade := fmt.Sprintf("cash-window-%d", i)
		require.NoError(t, policy.RecordPayment(db, user.Id, trade, "stripe", ledger.Payment{
			Amount: payment.amount, Currency: "USD", Reference: trade, PaidAt: now.AddDate(0, 0, -payment.days).Unix(),
		}))
	}
	require.NoError(t, policy.RecordSubscriptionPayment(db, user.Id, "sub-window", "stripe", ledger.Payment{
		Amount: "100", Currency: "USD", Reference: "sub-window", PaidAt: now.AddDate(0, 0, -4).Unix(),
	}))
	for _, test := range []struct {
		name            string
		mode            string
		eligibilityDays int
		renew           bool
		subscriptions   bool
		at              time.Time
		amount          string
		eligible        bool
		qualifiedAt     int64
		lastRechargeAt  int64
		expiresAt       int64
	}{
		{"lifetime", "lifetime", 0, false, false, now, "55", true, now.AddDate(0, 0, -40).Unix(), now.AddDate(0, 0, -5).Unix(), 0},
		{"rolling excludes old cash", "rolling", 0, false, false, now, "5", false, 0, now.AddDate(0, 0, -5).Unix(), 0},
		{"rolling with external subscriptions", "rolling", 0, false, true, now, "105", true, now.AddDate(0, 0, -4).Unix(), now.AddDate(0, 0, -4).Unix(), 0},
		{"expired qualification", "lifetime", 30, false, false, now, "55", false, now.AddDate(0, 0, -40).Unix(), now.AddDate(0, 0, -5).Unix(), now.AddDate(0, 0, -10).Unix()},
		{"recharge renews qualification", "lifetime", 30, true, false, now, "55", true, now.AddDate(0, 0, -40).Unix(), now.AddDate(0, 0, -5).Unix(), now.AddDate(0, 0, 25).Unix()},
		{"expires exactly at deadline", "lifetime", 30, true, false, now.AddDate(0, 0, 25), "55", false, now.AddDate(0, 0, -40).Unix(), now.AddDate(0, 0, -5).Unix(), now.AddDate(0, 0, 25).Unix()},
	} {
		t.Run(test.name, func(t *testing.T) {
			candidate := settings
			candidate.RechargeMode, candidate.LookbackDays = test.mode, 30
			candidate.EligibilityDays, candidate.RenewOnRecharge, candidate.IncludeSubscriptions = test.eligibilityDays, test.renew, test.subscriptions
			qualification, err := policy.PaymentSummary(db, user.Id, candidate, test.at)
			require.NoError(t, err)
			assert.Equal(t, test.amount, qualification.QualifiedAmount.String())
			assert.Equal(t, test.eligible, qualification.Eligible)
			assert.Equal(t, test.qualifiedAt, qualification.QualifiedAt)
			assert.Equal(t, test.lastRechargeAt, qualification.LastRechargeAt)
			assert.Equal(t, test.expiresAt, qualification.ExpiresAt)
		})
	}
	// A zero threshold removes qualification for both paid and unpaid accounts.
	settings.ThresholdAmount, settings.EligibilityDays, settings.RenewOnRecharge = "0", 1, true
	for _, userID := range []int{user.Id, unpaid.Id} {
		qualification, err := policy.PaymentSummary(db, userID, settings, now)
		require.NoError(t, err)
		assert.True(t, qualification.Eligible)
		assert.Zero(t, qualification.ExpiresAt)
	}
}

func TestCheckinPaymentRetriesRejectConflictingFacts(t *testing.T) {
	db := checkinDB(t)
	user := checkinUser(t, db, common.RoleCommonUser)
	other := checkinUser(t, db, common.RoleCommonUser)
	paid := time.Date(2025, 6, 3, 12, 0, 0, 0, time.UTC)
	payment := ledger.Payment{Amount: "50", Currency: "USD", Reference: "pi-facts", PaidAt: paid.Unix()}
	require.NoError(t, policy.RecordPayment(db, user.Id, "cash-facts", "stripe", payment))
	retry := payment
	retry.Amount, retry.Currency, retry.PaidAt = "50.0000", "usd", paid.Add(time.Hour).Unix()
	require.NoError(t, policy.RecordPayment(db, user.Id, "cash-facts", " STRIPE ", retry))
	for _, test := range []struct {
		name, trade, provider, currency, amount, reference string
		userID                                             int
		subscription                                       bool
	}{
		{"user", "cash-facts", "stripe", "USD", "50", "pi-facts", other.Id, false},
		{"provider", "cash-facts", "epay", "USD", "50", "pi-facts", user.Id, false},
		{"currency", "cash-facts", "stripe", "CNY", "50", "pi-facts", user.Id, false},
		{"amount", "cash-facts", "stripe", "USD", "49", "pi-facts", user.Id, false},
		{"reference", "cash-facts", "stripe", "USD", "50", "different-pi", user.Id, false},
		{"source", "cash-facts", "stripe", "USD", "50", "pi-facts", user.Id, true},
		{"provider reference reused", "different-trade", "stripe", "USD", "50", "pi-facts", user.Id, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			candidate := ledger.Payment{Amount: test.amount, Currency: test.currency, Reference: test.reference, PaidAt: paid.Unix()}
			var err error
			if test.subscription {
				err = policy.RecordSubscriptionPayment(db, test.userID, test.trade, test.provider, candidate)
			} else {
				err = policy.RecordPayment(db, test.userID, test.trade, test.provider, candidate)
			}
			require.ErrorIs(t, err, policy.ErrPaymentConflict)
		})
	}
	var stored policy.PaymentRecord
	require.NoError(t, db.First(&stored, "trade_no = ?", "cash-facts").Error)
	assert.Equal(t, user.Id, stored.UserID)
	assert.Equal(t, "50", stored.Amount)
	assert.Equal(t, "USD", stored.Currency)
	assert.Equal(t, paid.Unix(), stored.PaidAt)
	var payments int64
	require.NoError(t, db.Model(&policy.PaymentRecord{}).Count(&payments).Error)
	assert.EqualValues(t, 1, payments)
}

func TestCheckinPaymentRefundsAreCumulativeAndPreserveAwards(t *testing.T) {
	for _, refundFirst := range []bool{false, true} {
		t.Run(fmt.Sprintf("refund first=%t", refundFirst), func(t *testing.T) {
			db := checkinDB(t)
			user := checkinUser(t, db, common.RoleCommonUser)
			require.NoError(t, db.Model(&model.User{}).Where("id = ?", user.Id).Update("quota", 1234567).Error)
			settings := checkinSettings(t, db, func(value *policy.Settings) {
				value.Currency, value.ThresholdAmount = "USD", "50"
				value.Timezone = "UTC"
			})
			paid := time.Date(2025, 6, 4, 12, 0, 0, 0, time.UTC)
			award := model.Checkin{UserId: user.Id, CheckinDate: "2025-06-04", QuotaAwarded: 5000, CreatedAt: paid.Unix()}
			require.NoError(t, db.Create(&award).Error)
			if refundFirst {
				require.NoError(t, model.RecordPaymentRefund(db, "stripe", "pi-refund", "20", "USD"))
			}
			require.NoError(t, policy.RecordPayment(db, user.Id, "cash-refund", "stripe", ledger.Payment{
				Amount: "100", Currency: "USD", Reference: "pi-refund", PaidAt: paid.Unix(),
			}))
			for _, total := range []string{"20", "10", "20"} {
				require.NoError(t, model.RecordPaymentRefund(db, "stripe", "pi-refund", total, "USD"))
			}
			qualification, err := policy.PaymentSummary(db, user.Id, settings, paid.Add(24*time.Hour))
			require.NoError(t, err)
			assert.Equal(t, "80", qualification.QualifiedAmount.String())
			assert.True(t, qualification.Eligible)
			reason := strings.Repeat("退", 500)
			require.NoError(t, policy.RefundPayment(db, "cash-refund", "30", "  "+reason+"  ", 1))
			require.NoError(t, policy.RefundPayment(db, "cash-refund", "30", reason, 1))
			require.ErrorIs(t, policy.RefundPayment(db, "cash-refund", "25", reason, 1), policy.ErrPaymentConflict)
			require.ErrorIs(t, policy.RefundPayment(db, "cash-refund", "101", reason, 1), policy.ErrPaymentInvalid)
			require.ErrorIs(t, policy.RefundPayment(db, "cash-refund", "40", reason, 0), policy.ErrPaymentInvalid)
			require.ErrorIs(t, policy.RefundPayment(db, "cash-refund", "40", "退款", 1), policy.ErrPaymentInvalid)
			require.ErrorIs(t, policy.RefundPayment(db, "cash-refund", "40", strings.Repeat("退", 501), 1), policy.ErrPaymentInvalid)
			require.ErrorIs(t, policy.RefundPayment(db, "missing-payment", "1", reason, 1), policy.ErrPaymentNotFound)
			require.ErrorIs(t, model.RecordPaymentRefund(db, "stripe", "pi-refund", "40", "CNY"), policy.ErrPaymentConflict)
			qualification, err = policy.PaymentSummary(db, user.Id, settings, paid.Add(24*time.Hour))
			require.NoError(t, err)
			assert.Equal(t, "70", qualification.QualifiedAmount.String())
			var refundAudit policy.Audit
			require.NoError(t, db.First(&refundAudit, "action = ?", "payment_refund").Error)
			assert.Equal(t, reason, refundAudit.Reason)
			var audits int64
			require.NoError(t, db.Model(&policy.Audit{}).Where("action = ?", "payment_refund").Count(&audits).Error)
			assert.EqualValues(t, 1, audits)
			require.NoError(t, model.RecordPaymentRefund(db, "stripe", "pi-refund", "150", "USD"))
			require.NoError(t, model.RecordPaymentRefund(db, "stripe", "pi-refund", "40", "USD"))
			qualification, err = policy.PaymentSummary(db, user.Id, settings, paid.Add(24*time.Hour))
			require.NoError(t, err)
			assert.Equal(t, "0", qualification.QualifiedAmount.String())
			assert.False(t, qualification.Eligible)
			var stored policy.PaymentRecord
			require.NoError(t, db.First(&stored, "trade_no = ?", "cash-refund").Error)
			assert.Equal(t, "100", stored.RefundedAmount)
			var wallet model.User
			require.NoError(t, db.First(&wallet, user.Id).Error)
			assert.Equal(t, 1234567, wallet.Quota)
			var preserved model.Checkin
			require.NoError(t, db.First(&preserved, award.Id).Error)
			assert.Equal(t, 5000, preserved.QuotaAwarded)
		})
	}
}

func TestCheckinPaymentDecimalBoundsAndDisallowedSources(t *testing.T) {
	db := checkinDB(t)
	user := checkinUser(t, db, common.RoleCommonUser)
	paid := time.Date(2025, 6, 5, 12, 0, 0, 0, time.UTC).Unix()
	for i, amount := range []string{
		"", "-1", "+1", " 1", "1 ", "1e2", ".5", "1.", "1.0.0", "１２", "NaN",
		"1000000000000.0000000000000001", "0.12345678901234567", strings.Repeat("0", 48) + "1",
	} {
		trade := fmt.Sprintf("invalid-payment-%d", i)
		require.ErrorIs(t, policy.RecordPayment(db, user.Id, trade, "stripe", ledger.Payment{
			Amount: amount, Currency: "USD", Reference: trade, PaidAt: paid,
		}), policy.ErrPaymentInvalid, "amount=%q", amount)
	}
	for i, value := range []struct{ input, normalized string }{
		{"0", "0"}, {"0001.2500", "1.25"}, {"0.1234567890123456", "0.1234567890123456"},
		{"1000000000000", "1000000000000"}, {strings.Repeat("0", 47) + "1", "1"},
	} {
		trade := fmt.Sprintf("valid-payment-%d", i)
		require.NoError(t, policy.RecordPayment(db, user.Id, trade, "stripe", ledger.Payment{
			Amount: value.input, Currency: "USD", Reference: trade, PaidAt: paid,
		}))
		var stored policy.PaymentRecord
		require.NoError(t, db.First(&stored, "trade_no = ?", trade).Error)
		assert.Equal(t, value.normalized, stored.Amount)
	}
	payment := ledger.Payment{Amount: "1", Currency: "USD", Reference: "unsupported", PaidAt: paid}
	require.ErrorIs(t, policy.RecordPayment(db, user.Id, "balance-topup", "balance", payment), policy.ErrPaymentInvalid)
	require.ErrorIs(t, policy.RecordSubscriptionPayment(db, user.Id, "balance-sub", " BALANCE ", payment), policy.ErrPaymentInvalid)
	for _, source := range []string{"gift", "reward", "redemption", "registration"} {
		require.ErrorIs(t, policy.ReconcilePayment(db, user.Id, "unsupported-"+source, "stripe", source, payment, 1, "Verified payment"), policy.ErrPaymentInvalid)
	}
	payment.PaidAt = time.Now().Add(time.Hour).Unix()
	require.ErrorIs(t, policy.RecordPayment(db, user.Id, "future-payment", "stripe", payment), policy.ErrPaymentInvalid)
	payment.PaidAt, payment.Currency = paid, "EUR"
	for i, rate := range []string{"0", "-1", "1e2", "1000000.0000000000000001", "0.12345678901234567"} {
		payment.Reference, payment.USDPerUnit = fmt.Sprintf("fx-invalid-%d", i), rate
		require.ErrorIs(t, policy.ReconcilePayment(db, user.Id, payment.Reference, "stripe", policy.PaymentSourceTopUp, payment, 1, "Verified payment"), policy.ErrPaymentInvalid)
	}
	payment.Reference, payment.USDPerUnit = "fx-max", "1000000"
	require.NoError(t, policy.ReconcilePayment(db, user.Id, payment.Reference, "stripe", policy.PaymentSourceTopUp, payment, 1, "Verified payment"))
	payment.Reference, payment.Currency, payment.USDPerUnit = "fx-usd", "USD", "1"
	require.ErrorIs(t, policy.ReconcilePayment(db, user.Id, payment.Reference, "stripe", policy.PaymentSourceTopUp, payment, 1, "Verified payment"), policy.ErrPaymentInvalid)
	var records int64
	require.NoError(t, db.Model(&policy.PaymentRecord{}).Count(&records).Error)
	assert.EqualValues(t, 6, records)
}

func TestCheckinHostTopupsRequireVerifiedCashFacts(t *testing.T) {
	db := checkinDB(t)
	user := checkinUser(t, db, common.RoleCommonUser)
	require.NoError(t, db.Model(&model.User{}).Where("id = ?", user.Id).Update("quota", 0).Error)
	settings := checkinSettings(t, db, func(value *policy.Settings) {
		value.Enabled = false
		value.Currency, value.ThresholdAmount = "USD", "50"
		value.Timezone = "UTC"
	})
	paid := time.Date(2025, 6, 6, 12, 0, 0, 0, time.UTC).Unix()
	for _, trade := range []string{"verified-topup", "no-cash-facts", "admin-completed-topup"} {
		require.NoError(t, db.Create(&model.TopUp{
			UserId: user.Id, TradeNo: trade, Amount: 100, Money: 999,
			PaymentMethod: "alipay", PaymentProvider: model.PaymentProviderEpay,
			Status: common.TopUpStatusPending, CreateTime: paid,
		}).Error)
	}
	payment := ledger.Payment{Amount: "25", Currency: "USD", Reference: "receipt-verified", PaidAt: paid}
	already, err := model.RechargeEpay("verified-topup", "alipay", "127.0.0.1", payment)
	require.NoError(t, err)
	assert.False(t, already)
	already, err = model.RechargeEpay("verified-topup", "alipay", "127.0.0.1", payment)
	require.NoError(t, err)
	assert.True(t, already)
	_, err = model.RechargeEpay("no-cash-facts", "alipay", "127.0.0.1")
	require.NoError(t, err)
	require.NoError(t, model.ManualCompleteTopUp("admin-completed-topup", "127.0.0.1"))
	qualification, err := policy.PaymentSummary(db, user.Id, settings, time.Now())
	require.NoError(t, err)
	assert.Equal(t, "25", qualification.QualifiedAmount.String())
	assert.False(t, qualification.Eligible)
	var records int64
	require.NoError(t, db.Model(&policy.PaymentRecord{}).Where("user_id = ?", user.Id).Count(&records).Error)
	assert.EqualValues(t, 1, records)
	credited, err := common.WalletQuotaFromDecimalStrict(decimal.NewFromInt(300).Mul(decimal.NewFromFloat(common.QuotaPerUnit)))
	require.NoError(t, err)
	var wallet model.User
	require.NoError(t, db.First(&wallet, user.Id).Error)
	assert.Equal(t, credited, wallet.Quota)
}

func TestCheckinSubscriptionsCountExternalCashOnce(t *testing.T) {
	db := checkinDB(t)
	require.NoError(t, db.AutoMigrate(&model.SubscriptionPlan{}, &model.UserSubscription{}))
	user := checkinUser(t, db, common.RoleCommonUser)
	initialQuota, err := common.WalletQuotaFromDecimalStrict(decimal.NewFromInt(100).Mul(decimal.NewFromFloat(common.QuotaPerUnit)))
	require.NoError(t, err)
	require.NoError(t, db.Model(&model.User{}).Where("id = ?", user.Id).Update("quota", initialQuota).Error)
	settings := checkinSettings(t, db, func(value *policy.Settings) {
		value.Enabled = false
		value.Currency, value.ThresholdAmount, value.IncludeSubscriptions = "USD", "50", false
		value.Timezone = "UTC"
	})
	plan := model.SubscriptionPlan{
		Title: "Check-in cash isolation", PriceAmount: 10, Currency: "USD", Enabled: true,
		DurationUnit: model.SubscriptionDurationDay, DurationValue: 30, TotalAmount: 100000,
		QuotaResetPeriod: model.SubscriptionResetNever, AllowBalancePay: common.GetPointer(true),
	}
	require.NoError(t, db.Create(&plan).Error)
	model.InvalidateSubscriptionPlanCache(plan.Id)
	t.Cleanup(func() { model.InvalidateSubscriptionPlanCache(plan.Id) })
	require.NoError(t, model.PurchaseSubscriptionWithBalance(user.Id, plan.Id))
	var balanceOrder model.SubscriptionOrder
	require.NoError(t, db.First(&balanceOrder, "user_id = ? AND payment_provider = ?", user.Id, model.PaymentProviderBalance).Error)
	assert.Equal(t, common.TopUpStatusSuccess, balanceOrder.Status)
	var payments int64
	require.NoError(t, db.Model(&policy.PaymentRecord{}).Where("user_id = ?", user.Id).Count(&payments).Error)
	assert.Zero(t, payments)
	paid := time.Date(2025, 6, 7, 12, 0, 0, 0, time.UTC).Unix()
	require.NoError(t, policy.RecordPayment(db, user.Id, "cash-before-sub", "stripe", ledger.Payment{
		Amount: "25", Currency: "USD", Reference: "pi-before-sub", PaidAt: paid,
	}))
	externalOrder := model.SubscriptionOrder{
		UserId: user.Id, PlanId: plan.Id, TradeNo: "external-sub", Money: 999,
		PaymentMethod: model.PaymentMethodStripe, PaymentProvider: model.PaymentProviderStripe,
		Status: common.TopUpStatusPending, CreateTime: paid,
	}
	require.NoError(t, db.Create(&externalOrder).Error)
	actual := ledger.Payment{Amount: "40", Currency: "USD", Reference: "pi-sub", PaidAt: paid}
	require.NoError(t, model.CompleteSubscriptionOrder("external-sub", "", model.PaymentProviderStripe, model.PaymentMethodStripe, actual))
	require.NoError(t, model.CompleteSubscriptionOrder("external-sub", "", model.PaymentProviderStripe, model.PaymentMethodStripe, actual))
	qualification, err := policy.PaymentSummary(db, user.Id, settings, time.Now())
	require.NoError(t, err)
	assert.Equal(t, "25", qualification.QualifiedAmount.String())
	assert.False(t, qualification.Eligible)
	settings = checkinSettings(t, db, func(value *policy.Settings) { value.IncludeSubscriptions = true })
	qualification, err = policy.PaymentSummary(db, user.Id, settings, time.Now())
	require.NoError(t, err)
	assert.Equal(t, "65", qualification.QualifiedAmount.String())
	assert.True(t, qualification.Eligible)
	require.NoError(t, db.Model(&policy.PaymentRecord{}).Where("user_id = ?", user.Id).Count(&payments).Error)
	assert.EqualValues(t, 2, payments)
	var mirror model.TopUp
	require.NoError(t, db.First(&mirror, "trade_no = ?", "external-sub").Error)
	assert.Zero(t, mirror.Amount)
	var balanceCost int
	balanceCost, err = common.WalletQuotaFromDecimalStrict(decimal.NewFromInt(10).Mul(decimal.NewFromFloat(common.QuotaPerUnit)))
	require.NoError(t, err)
	var wallet model.User
	require.NoError(t, db.First(&wallet, user.Id).Error)
	assert.Equal(t, initialQuota-balanceCost, wallet.Quota)
	var subscriptions int64
	require.NoError(t, db.Model(&model.UserSubscription{}).Where("user_id = ?", user.Id).Count(&subscriptions).Error)
	assert.EqualValues(t, 2, subscriptions)
}

func checkinHTTPUser(t *testing.T, db *gorm.DB, role int) (model.User, string) {
	t.Helper()
	user := checkinUser(t, db, role)
	require.Positive(t, user.AuthVersion)
	session := model.UserSession{
		SID: fmt.Sprintf("checkin-http-%d", user.Id), UserID: user.Id,
		Version: 1, UserAuthVersion: user.AuthVersion, Status: model.UserSessionStatusActive,
		RefreshHash: strings.Repeat("0", 64), LoginMethod: "password",
		LastActiveAt: time.Now().Unix(), ExpiresAt: time.Now().Unix() + 3600,
	}
	require.NoError(t, model.CreateUserSession(&session))
	raw, _, err := service.IssueAccessToken(service.AuthIdentity{
		UserID: user.Id, SessionID: session.SID, UserAuthVersion: user.AuthVersion, SessionVersion: 1,
	})
	require.NoError(t, err)
	return user, raw
}

func checkinHTTPRouter() *gin.Engine {
	router := gin.New()
	api := router.Group("/api")
	checkin.RegisterRoutes(api)
	api.GET("/user/checkin", middleware.UserAuth(), middleware.DisableCache(), controller.GetCheckinStatus)
	api.POST("/user/checkin", middleware.UserAuth(), middleware.StrictSessionCookieOriginGuard(), middleware.UserCriticalRateLimit("checkin-claim"), controller.DoCheckin)
	return router
}

func checkinHTTPRequest(router *gin.Engine, method, path, token string, headers http.Header, body []byte) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, "http://checkin.example"+path, bytes.NewReader(body))
	if headers != nil {
		request.Header = headers.Clone()
	}
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func TestCheckinHTTPAuthenticationAndAdministrativeAuthority(t *testing.T) {
	db := checkinDB(t)
	checkinSettings(t, db, func(value *policy.Settings) {
		value.Enabled, value.ThresholdAmount, value.FollowRegistrationRisk = true, "0", false
	})
	rootUser, rootToken := checkinHTTPUser(t, db, common.RoleRootUser)
	_, adminToken := checkinHTTPUser(t, db, common.RoleAdminUser)
	normalUser, normalToken := checkinHTTPUser(t, db, common.RoleCommonUser)
	_, expiredToken := checkinHTTPUser(t, db, common.RoleCommonUser)
	expiredIdentity, err := service.ParseAccessToken(expiredToken)
	require.NoError(t, err)
	require.NoError(t, db.Model(&model.UserSession{}).Where("sid = ?", expiredIdentity.SessionID).Update("expires_at", time.Now().Unix()-1).Error)
	revokedUser, revokedToken := checkinHTTPUser(t, db, common.RoleCommonUser)
	revokedIdentity, err := service.ParseAccessToken(revokedToken)
	require.NoError(t, err)
	_, err = model.RevokeUserSession(revokedUser.Id, revokedIdentity.SessionID, "checkin-http-test")
	require.NoError(t, err)
	_, missingToken := checkinHTTPUser(t, db, common.RoleCommonUser)
	missingIdentity, err := service.ParseAccessToken(missingToken)
	require.NoError(t, err)
	require.NoError(t, db.Where("sid = ?", missingIdentity.SessionID).Delete(&model.UserSession{}).Error)
	_, staleSessionToken := checkinHTTPUser(t, db, common.RoleCommonUser)
	staleIdentity, err := service.ParseAccessToken(staleSessionToken)
	require.NoError(t, err)
	require.NoError(t, db.Model(&model.UserSession{}).Where("sid = ?", staleIdentity.SessionID).Update("version", 2).Error)
	staleUser, staleUserToken := checkinHTTPUser(t, db, common.RoleCommonUser)
	require.NoError(t, db.Model(&model.User{}).Where("id = ?", staleUser.Id).Update("auth_version", staleUser.AuthVersion+1).Error)
	disabledUser, disabledToken := checkinHTTPUser(t, db, common.RoleCommonUser)
	require.NoError(t, db.Model(&model.User{}).Where("id = ?", disabledUser.Id).Update("status", common.UserStatusDisabled).Error)
	router := checkinHTTPRouter()
	origin := http.Header{"Origin": {"http://checkin.example"}}
	for _, credential := range []struct{ name, raw string }{
		{"anonymous", ""}, {"unknown credential", "invalid-checkin-credential"},
		{"expired session", expiredToken}, {"revoked session", revokedToken},
		{"missing session", missingToken}, {"stale session version", staleSessionToken},
		{"stale account version", staleUserToken}, {"disabled account", disabledToken},
	} {
		t.Run(credential.name, func(t *testing.T) {
			for _, endpoint := range []struct{ method, path string }{
				{http.MethodGet, "/api/extensions/checkin/dashboard"},
				{http.MethodPost, "/api/extensions/checkin/claim"},
				{http.MethodPost, "/api/user/checkin"},
			} {
				response := checkinHTTPRequest(router, endpoint.method, endpoint.path, credential.raw, origin, nil)
				assert.Equal(t, http.StatusUnauthorized, response.Code, endpoint.path)
				assert.Contains(t, response.Body.String(), `"success":false`)
			}
		})
	}
	var claims int64
	require.NoError(t, db.Model(&model.Checkin{}).Count(&claims).Error)
	assert.Zero(t, claims, "invalidated sessions cannot create rewards through either route")

	accountBody := []byte(`{"state":"paused","reason":"administrator review"}`)
	for _, path := range []string{"/settings", "/accounts", "/payments", "/audit"} {
		for _, credential := range []string{normalToken, adminToken} {
			response := checkinHTTPRequest(router, http.MethodGet, "/api/extensions/checkin"+path, credential, nil, nil)
			assert.Equal(t, http.StatusForbidden, response.Code, path)
			assert.Contains(t, response.Body.String(), "AUTH_INSUFFICIENT_PRIVILEGE")
		}
		response := checkinHTTPRequest(router, http.MethodGet, "/api/extensions/checkin"+path, rootToken, nil, nil)
		assert.Equal(t, http.StatusOK, response.Code, path)
		assert.Contains(t, response.Body.String(), `"success":true`)
		assert.Contains(t, response.Header().Get("Cache-Control"), "no-store")
	}
	for _, credential := range []string{normalToken, adminToken} {
		for _, endpoint := range []struct{ method, path string }{
			{http.MethodPut, "/settings"}, {http.MethodPost, fmt.Sprintf("/accounts/%d", normalUser.Id)},
			{http.MethodPost, "/reconcile"}, {http.MethodPost, "/refund"},
		} {
			response := checkinHTTPRequest(router, endpoint.method, "/api/extensions/checkin"+endpoint.path, credential, origin, accountBody)
			assert.Equal(t, http.StatusForbidden, response.Code, endpoint.path)
		}
	}

	require.NoError(t, model.EnsureLegacyAccessTokenRetireAt(time.Now().Unix()))
	patRaw := "nap_checkin_http_test"
	hash := sha256.Sum256([]byte(patRaw))
	require.NoError(t, db.Create(&model.UserAccessToken{
		UserId: rootUser.Id, Name: "automation", TokenHash: hex.EncodeToString(hash[:]), TokenHint: "test",
		Scopes: `["option:read","option:write","wallet:read","wallet:write"]`, ExpiresAt: time.Now().Unix() + 3600,
	}).Error)
	for _, route := range router.Routes() {
		if !strings.HasPrefix(route.Path, "/api/extensions/checkin/") && !(route.Method == http.MethodPost && route.Path == "/api/user/checkin") {
			continue
		}
		rule, ok := middleware.AccessTokenRouteRule(route.Method + " " + route.Path)
		require.True(t, ok)
		assert.Equal(t, "session", rule.Kind())
		path := strings.ReplaceAll(route.Path, ":id", fmt.Sprint(normalUser.Id))
		response := checkinHTTPRequest(router, route.Method, path, patRaw, origin, accountBody)
		assert.Equal(t, http.StatusForbidden, response.Code, route.Method+" "+path)
		assert.Contains(t, response.Body.String(), "AUTH_SESSION_REQUIRED")
	}
	response := checkinHTTPRequest(router, http.MethodGet, "/api/extensions/checkin/dashboard", normalToken, nil, nil)
	assert.Contains(t, response.Body.String(), `"success":true`)
	var authenticationAudits []model.AuditLog
	require.NoError(t, db.Where("category = ?", model.AuditCategoryAccessToken).Find(&authenticationAudits).Error)
	require.NotEmpty(t, authenticationAudits, "rejected PAT requests retain a non-secret investigation trail")
	auditJSON, err := common.Marshal(authenticationAudits)
	require.NoError(t, err)
	assert.NotContains(t, string(auditJSON), patRaw)
	assert.NotContains(t, string(auditJSON), rootToken)
}

func TestCheckinHTTPOriginRecipientAndLegacyPolicy(t *testing.T) {
	db := checkinDB(t)
	settings := checkinSettings(t, db, func(value *policy.Settings) {
		value.Enabled, value.ThresholdAmount, value.FollowRegistrationRisk = true, "0", false
	})
	rootUser, rootToken := checkinHTTPUser(t, db, common.RoleRootUser)
	user, userToken := checkinHTTPUser(t, db, common.RoleCommonUser)
	other, otherToken := checkinHTTPUser(t, db, common.RoleCommonUser)
	router := checkinHTTPRouter()
	encoded, err := common.Marshal(settings)
	require.NoError(t, err)
	for _, endpoint := range []struct {
		method, path, token string
		body                []byte
	}{
		{http.MethodPost, "/api/extensions/checkin/claim", userToken, nil},
		{http.MethodPost, "/api/user/checkin", userToken, nil},
		{http.MethodPut, "/api/extensions/checkin/settings", rootToken, encoded},
		{http.MethodPost, fmt.Sprintf("/api/extensions/checkin/accounts/%d", user.Id), rootToken, []byte(`{"state":"paused","reason":"origin review"}`)},
		{http.MethodPost, "/api/extensions/checkin/reconcile", rootToken, []byte(`{}`)},
		{http.MethodPost, "/api/extensions/checkin/refund", rootToken, []byte(`{}`)},
	} {
		for _, headers := range []http.Header{
			nil, {"Origin": {"null"}}, {"Origin": {"http://evil.example"}},
			{"Origin": {"http://checkin.example.evil.example"}},
			{"Origin": {"http://checkin.example,http://evil.example"}},
			{"Origin": {"http://checkin.example", "http://evil.example"}},
			{"Origin": {"http://evil.example"}, "Referer": {"http://checkin.example/"}},
			{"Origin": {"https://checkin.example"}, "X-Forwarded-Proto": {"https"}},
		} {
			response := checkinHTTPRequest(router, endpoint.method, endpoint.path, endpoint.token, headers, endpoint.body)
			assert.Equal(t, http.StatusForbidden, response.Code, endpoint.path)
			assert.Contains(t, response.Body.String(), "AUTH_ORIGIN_FORBIDDEN")
		}
	}
	stored, err := policy.GetSettings(db)
	require.NoError(t, err)
	assert.Equal(t, settings, stored)
	var claims int64
	require.NoError(t, db.Model(&model.Checkin{}).Count(&claims).Error)
	assert.Zero(t, claims)

	// Request-supplied recipients, rewards, and verification flags cannot
	// replace the server-authenticated subject or administrator's reward rule.
	response := checkinHTTPRequest(router, http.MethodPost,
		fmt.Sprintf("/api/extensions/checkin/claim?user_id=%d", other.Id), userToken,
		http.Header{"Referer": {"http://checkin.example/checkin"}},
		[]byte(fmt.Sprintf(`{"user_id":%d,"quota_awarded":1000000,"verified":true}`, other.Id)))
	require.Equal(t, http.StatusOK, response.Code)
	require.Contains(t, response.Body.String(), `"success":true`)
	var awarded model.Checkin
	require.NoError(t, db.Where("user_id = ?", user.Id).Take(&awarded).Error)
	assert.Equal(t, settings.RewardMinQuota, awarded.QuotaAwarded)
	var persisted model.User
	require.NoError(t, db.First(&persisted, user.Id).Error)
	assert.Equal(t, user.Quota+settings.RewardMinQuota, persisted.Quota)
	persisted = model.User{}
	require.NoError(t, db.First(&persisted, other.Id).Error)
	assert.Equal(t, other.Quota, persisted.Quota)
	response = checkinHTTPRequest(router, http.MethodGet,
		fmt.Sprintf("/api/extensions/checkin/dashboard?user_id=%d", user.Id), otherToken, nil, nil)
	var dashboard struct {
		Data policy.DashboardData `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &dashboard))
	assert.Zero(t, dashboard.Data.Stats.TotalCheckins)
	assert.Empty(t, dashboard.Data.Records, "another account cannot read the claimant's history")
	response = checkinHTTPRequest(router, http.MethodPost, "/api/user/checkin", userToken, http.Header{"Origin": {"http://checkin.example"}}, nil)
	assert.Contains(t, response.Body.String(), policy.ErrAlreadyChecked.Key)

	// Suspension applies immediately to both entry points; Unicode reasons
	// round-trip at the same 500-character boundary as the administrator form.
	reason := strings.Repeat("审", 500)
	accountBody, err := common.Marshal(map[string]string{"state": "paused", "reason": reason})
	require.NoError(t, err)
	response = checkinHTTPRequest(router, http.MethodPost, fmt.Sprintf("/api/extensions/checkin/accounts/%d", other.Id), rootToken,
		http.Header{"Origin": {"http://checkin.example"}}, accountBody)
	require.Contains(t, response.Body.String(), `"success":true`)
	var account policy.Account
	require.NoError(t, db.Where("user_id = ?", other.Id).Take(&account).Error)
	assert.Equal(t, reason, account.Reason)
	for _, path := range []string{"/api/extensions/checkin/claim", "/api/user/checkin"} {
		response = checkinHTTPRequest(router, http.MethodPost, path, otherToken, http.Header{"Origin": {"http://checkin.example"}}, nil)
		assert.Contains(t, response.Body.String(), policy.ErrPaused.Key, path)
	}
	for _, invalidReason := range []string{"审核", strings.Repeat("审", 501)} {
		_, err := policy.UpdateAccount(db, other.Id, rootUser.Id, "active", invalidReason)
		assert.ErrorIs(t, err, policy.ErrInvalid)
	}
	_, err = policy.UpdateAccount(db, other.Id, rootUser.Id, "active", "review completed")
	require.NoError(t, err)
	checkinSettings(t, db, func(value *policy.Settings) { value.ThresholdAmount = "50" })
	for _, path := range []string{"/api/extensions/checkin/claim", "/api/user/checkin"} {
		response = checkinHTTPRequest(router, http.MethodPost, path, otherToken, http.Header{"Origin": {"http://checkin.example"}}, nil)
		assert.Contains(t, response.Body.String(), policy.ErrRechargeRequired.Key, path)
	}
	require.NoError(t, db.Model(&model.Checkin{}).Count(&claims).Error)
	assert.EqualValues(t, 1, claims, "no alternate route can bypass recipient, repeat, pause, or recharge policies")
}

type checkinHTTPTransport func(*http.Request) (*http.Response, error)

func (transport checkinHTTPTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func TestCheckinHTTPHumanVerificationAndReplay(t *testing.T) {
	db := checkinDB(t)
	settings := checkinSettings(t, db, func(value *policy.Settings) {
		value.Enabled, value.ThresholdAmount, value.FollowRegistrationRisk = true, "0", false
		value.RequireTurnstile = true
	})
	user, userToken := checkinHTTPUser(t, db, common.RoleCommonUser)
	other, otherToken := checkinHTTPUser(t, db, common.RoleCommonUser)
	legacyUser, legacyToken := checkinHTTPUser(t, db, common.RoleCommonUser)
	oldEnabled, oldSite, oldSecret := common.TurnstileCheckEnabled, common.TurnstileSiteKey, common.TurnstileSecretKey
	oldTransport := http.DefaultTransport
	t.Cleanup(func() {
		common.TurnstileCheckEnabled, common.TurnstileSiteKey, common.TurnstileSecretKey = oldEnabled, oldSite, oldSecret
		http.DefaultTransport = oldTransport
	})
	common.TurnstileCheckEnabled, common.TurnstileSiteKey, common.TurnstileSecretKey = true, "checkin-test-site", "checkin-test-secret"
	calls := 0
	used := map[string]bool{}
	http.DefaultTransport = checkinHTTPTransport(func(request *http.Request) (*http.Response, error) {
		calls++
		assert.Equal(t, "https://challenges.cloudflare.com/turnstile/v0/siteverify", request.URL.String())
		assert.Equal(t, http.MethodPost, request.Method)
		require.NoError(t, request.ParseForm())
		assert.Equal(t, "checkin-test-secret", request.PostForm.Get("secret"))
		token := request.PostForm.Get("response")
		valid := (token == "checkin-plugin-proof" || token == "checkin-legacy-proof") && !used[token]
		used[token] = true
		encoded, err := common.Marshal(map[string]bool{"success": valid})
		require.NoError(t, err)
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(encoded)), Request: request}, nil
	})
	router := checkinHTTPRouter()
	origin := http.Header{"Origin": {"http://checkin.example"}}
	for _, path := range []string{"/api/extensions/checkin/claim", "/api/user/checkin"} {
		for _, challenge := range []string{"", strings.Repeat("x", 2049)} {
			response := checkinHTTPRequest(router, http.MethodPost, path+"?turnstile="+url.QueryEscape(challenge), userToken, origin, []byte(`{"verified":true}`))
			assert.Contains(t, response.Body.String(), policy.ErrVerificationRequired.Key)
		}
	}
	assert.Zero(t, calls, "missing or oversized challenges are rejected before calling Cloudflare")
	_, err := model.UserCheckin(user.Id)
	assert.ErrorIs(t, err, policy.ErrVerificationRequired, "the host model cannot bypass required server verification")
	for _, path := range []string{"/api/extensions/checkin/claim", "/api/user/checkin"} {
		response := checkinHTTPRequest(router, http.MethodPost, path+"?turnstile=checkin-invalid-proof", userToken, origin, nil)
		assert.Contains(t, response.Body.String(), policy.ErrVerificationRequired.Key)
	}
	assert.Equal(t, 2, calls)
	for _, missingConfiguration := range []string{"global switch", "site key", "secret key"} {
		common.TurnstileCheckEnabled, common.TurnstileSiteKey, common.TurnstileSecretKey = true, "checkin-test-site", "checkin-test-secret"
		switch missingConfiguration {
		case "global switch":
			common.TurnstileCheckEnabled = false
		case "site key":
			common.TurnstileSiteKey = ""
		case "secret key":
			common.TurnstileSecretKey = ""
		}
		response := checkinHTTPRequest(router, http.MethodPost, "/api/extensions/checkin/claim?turnstile=checkin-plugin-proof", userToken, origin, nil)
		assert.Contains(t, response.Body.String(), policy.ErrVerificationUnavailable.Key, missingConfiguration)
	}
	assert.Equal(t, 2, calls, "incomplete verification configuration fails closed")
	common.TurnstileCheckEnabled, common.TurnstileSiteKey, common.TurnstileSecretKey = true, "checkin-test-site", "checkin-test-secret"
	response := checkinHTTPRequest(router, http.MethodPost, "/api/extensions/checkin/claim?turnstile=checkin-plugin-proof", userToken, origin, nil)
	require.Contains(t, response.Body.String(), `"success":true`)
	assert.Equal(t, 3, calls, "one successful attempt verifies the challenge exactly once")
	response = checkinHTTPRequest(router, http.MethodPost, "/api/user/checkin?turnstile=checkin-plugin-proof", otherToken, origin, nil)
	assert.Contains(t, response.Body.String(), policy.ErrVerificationRequired.Key)
	assert.Equal(t, 4, calls)
	response = checkinHTTPRequest(router, http.MethodPost, "/api/user/checkin?turnstile=checkin-legacy-proof", legacyToken, origin, nil)
	require.Contains(t, response.Body.String(), `"success":true`)
	assert.Equal(t, 5, calls, "the legacy entry also verifies exactly once")
	response = checkinHTTPRequest(router, http.MethodPost, "/api/extensions/checkin/claim?turnstile=checkin-legacy-proof", otherToken, origin, nil)
	assert.Contains(t, response.Body.String(), policy.ErrVerificationRequired.Key)
	assert.Equal(t, 6, calls)
	var records []model.Checkin
	require.NoError(t, db.Order("id").Find(&records).Error)
	require.Len(t, records, 2)
	assert.Equal(t, []int{user.Id, legacyUser.Id}, []int{records[0].UserId, records[1].UserId})
	for _, record := range records {
		assert.Equal(t, settings.RewardMinQuota, record.QuotaAwarded)
	}
	var persisted model.User
	require.NoError(t, db.First(&persisted, other.Id).Error)
	assert.Equal(t, other.Quota, persisted.Quota, "replayed CAPTCHA proofs never credit another account")
	var audits []policy.Audit
	require.NoError(t, db.Find(&audits).Error)
	auditJSON, err := common.Marshal(audits)
	require.NoError(t, err)
	for _, secret := range []string{"checkin-plugin-proof", "checkin-legacy-proof", "checkin-test-secret", userToken, legacyToken} {
		assert.NotContains(t, string(auditJSON), secret, "reward audit events must not contain usable authentication or verification secrets")
	}
}

func TestCheckinHTTPHistoricalPaymentReferences(t *testing.T) {
	db := checkinDB(t)
	settings := checkinSettings(t, db, func(value *policy.Settings) {
		value.Currency, value.ThresholdAmount, value.Timezone = "USD", "10", "UTC"
		value.FollowRegistrationRisk = false
	})
	rootUser, rootToken := checkinHTTPUser(t, db, common.RoleRootUser)
	router := checkinHTTPRouter()
	origin := http.Header{"Origin": {"http://checkin.example"}}
	paid := time.Date(2025, 8, 1, 12, 0, 0, 0, time.UTC)
	for _, input := range []struct {
		name, trade, reference, errorKey string
		refund                           bool
	}{
		{"129-byte order needs reference", strings.Repeat("a", 129), "", "Provide a payment reference for order numbers longer than 128 bytes", false},
		{"191-byte order needs reference", strings.Repeat("b", 191), "", "Provide a payment reference for order numbers longer than 128 bytes", false},
		{"long order with actual payment intent", strings.Repeat("c", 129), "pi_historical_checkin", "", true},
		{"longest order with actual invoice", strings.Repeat("d", 191), "in_historical_checkin", "", false},
		{"128-byte order fallback", strings.Repeat("e", 128), "", "", false},
		{"128-byte reference accepted", "checkin-reference-limit", "pi_" + strings.Repeat("f", 125), "", false},
		{"129-byte reference rejected", "checkin-reference-overflow", "pi_" + strings.Repeat("g", 126), "Invalid check-in parameters", false},
		{"192-byte order rejected", strings.Repeat("h", 192), "pi_order_overflow", "Invalid check-in parameters", false},
	} {
		t.Run(input.name, func(t *testing.T) {
			user := checkinUser(t, db, common.RoleCommonUser)
			require.NoError(t, db.Model(&model.User{}).Where("id = ?", user.Id).Update("quota", 1234567).Error)
			require.NoError(t, db.Create(&model.TopUp{
				UserId: user.Id, TradeNo: input.trade, PaymentProvider: model.PaymentProviderStripe,
				PaymentMethod: model.PaymentMethodStripe, CompleteTime: paid.Unix(), Status: common.TopUpStatusSuccess,
			}).Error)
			var previousNotices int64
			require.NoError(t, db.Model(&policy.PaymentRefund{}).Count(&previousNotices).Error)
			body := map[string]any{"user_id": user.Id, "source": policy.PaymentSourceTopUp,
				"trade_no": input.trade, "amount": "10", "currency": "USD", "reason": "Verified provider receipt"}
			if input.reference != "" {
				body["reference"] = input.reference
			}
			encoded, err := common.Marshal(body)
			require.NoError(t, err)
			response := checkinHTTPRequest(router, http.MethodPost, "/api/extensions/checkin/reconcile", rootToken, origin, encoded)
			require.Equal(t, http.StatusOK, response.Code)
			var payments, audits, notices int64
			require.NoError(t, db.Model(&policy.PaymentRecord{}).Where("user_id = ?", user.Id).Count(&payments).Error)
			require.NoError(t, db.Model(&policy.Audit{}).Where("user_id = ? AND action = ?", user.Id, "payment_reconcile").Count(&audits).Error)
			require.NoError(t, db.Model(&policy.PaymentRefund{}).Count(&notices).Error)
			if input.errorKey != "" {
				assert.Contains(t, response.Body.String(), `"success":false`)
				assert.Contains(t, response.Body.String(), input.errorKey)
				assert.Zero(t, payments)
				assert.Zero(t, audits)
				assert.Equal(t, previousNotices, notices)
			} else {
				require.Contains(t, response.Body.String(), `"success":true`)
				assert.EqualValues(t, 1, payments)
				assert.EqualValues(t, 1, audits)
				assert.Equal(t, previousNotices+1, notices)
				var payment policy.PaymentRecord
				require.NoError(t, db.Where("trade_no = ?", input.trade).Take(&payment).Error)
				expectedReference := input.reference
				if expectedReference == "" {
					expectedReference = input.trade
				}
				assert.Equal(t, expectedReference, payment.Reference)
				assert.Equal(t, paid.Unix(), payment.PaidAt)
				assert.Equal(t, "10", payment.Amount)
				assert.Equal(t, rootUser.Id, payment.ReconciledBy)
				assert.True(t, payment.Historical)
				if input.refund {
					qualification, err := policy.PaymentSummary(db, user.Id, settings, paid.Add(time.Hour))
					require.NoError(t, err)
					assert.True(t, qualification.Eligible)
					require.NoError(t, model.RecordPaymentRefund(db, model.PaymentProviderStripe, expectedReference, "5", "USD"))
					qualification, err = policy.PaymentSummary(db, user.Id, settings, paid.Add(time.Hour))
					require.NoError(t, err)
					assert.False(t, qualification.Eligible)
					assert.Equal(t, "5", qualification.QualifiedAmount.String())
				}
			}
			var wallet model.User
			require.NoError(t, db.First(&wallet, user.Id).Error)
			assert.Equal(t, 1234567, wallet.Quota, "historical qualification and refund never issue wallet credit")
		})
	}

	t.Run("existing provider reference stays immutable", func(t *testing.T) {
		user := checkinUser(t, db, common.RoleCommonUser)
		trade := strings.Repeat("i", 191)
		require.NoError(t, db.Create(&model.TopUp{
			UserId: user.Id, TradeNo: trade, PaymentProvider: model.PaymentProviderStripe,
			PaymentMethod: model.PaymentMethodStripe, CompleteTime: paid.Add(time.Hour).Unix(), Status: common.TopUpStatusSuccess,
		}).Error)
		require.NoError(t, policy.RecordPayment(db, user.Id, trade, model.PaymentProviderStripe, ledger.Payment{
			Amount: "10", Currency: "USD", Reference: "pi_immutable_checkin", PaidAt: paid.Unix(),
		}))
		for _, reference := range []string{"", "pi_immutable_checkin", "pi_conflicting_checkin"} {
			body := map[string]any{"user_id": user.Id, "source": policy.PaymentSourceTopUp,
				"trade_no": trade, "amount": "10", "currency": "USD", "reason": "Verified provider receipt"}
			if reference != "" {
				body["reference"] = reference
			}
			encoded, err := common.Marshal(body)
			require.NoError(t, err)
			response := checkinHTTPRequest(router, http.MethodPost, "/api/extensions/checkin/reconcile", rootToken, origin, encoded)
			require.Equal(t, http.StatusOK, response.Code)
			if reference == "pi_conflicting_checkin" {
				assert.Contains(t, response.Body.String(), `"success":false`)
				assert.Contains(t, response.Body.String(), "Check-in payment facts conflict")
			} else {
				assert.Contains(t, response.Body.String(), `"success":true`)
			}
			var payment policy.PaymentRecord
			require.NoError(t, db.Where("trade_no = ?", trade).Take(&payment).Error)
			assert.Equal(t, "pi_immutable_checkin", payment.Reference)
			assert.Equal(t, paid.Unix(), payment.PaidAt)
			assert.Equal(t, "10", payment.Amount)
			assert.Equal(t, policy.PaymentOriginProvider, payment.Origin)
			assert.Zero(t, payment.ReconciledBy)
		}
		var payments, audits int64
		require.NoError(t, db.Model(&policy.PaymentRecord{}).Where("user_id = ?", user.Id).Count(&payments).Error)
		require.NoError(t, db.Model(&policy.Audit{}).Where("user_id = ? AND action = ?", user.Id, "payment_reconcile").Count(&audits).Error)
		assert.EqualValues(t, 1, payments)
		assert.Zero(t, audits, "idempotent reconciliation creates no new receipt or audit")
		var wallet model.User
		require.NoError(t, db.First(&wallet, user.Id).Error)
		assert.Zero(t, wallet.Quota)
	})
}
