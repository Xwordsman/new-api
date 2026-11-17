package registrationrisk

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/extensions/referral/ledger"
	"github.com/QuantumNous/new-api/extensions/registrationrisk/guard"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
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

func riskDB(t *testing.T, dialect string) *gorm.DB {
	t.Helper()
	require.NoError(t, i18n.Init())
	if selected := os.Getenv("REGISTRATIONRISK_TEST_DIALECT"); selected != "" {
		require.Contains(t, []string{"sqlite", "mysql", "postgres"}, selected)
		dialect = selected
	}
	var driver gorm.Dialector = sqlite.Open(":memory:")
	if dialect != "sqlite" {
		dsn := os.Getenv("REGISTRATIONRISK_TEST_" + strings.ToUpper(dialect) + "_DSN")
		require.Contains(t, dsn, "/registrationrisk_extension_test?")
		if dialect == "mysql" {
			driver = mysql.Open(dsn)
		} else {
			driver = postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true})
		}
	}
	db, err := gorm.Open(driver, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	conn, err := db.DB()
	require.NoError(t, err)
	conn.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, conn.Close()) })
	oldDB, oldLogs, oldType := model.DB, model.LOG_DB, common.MainDatabaseType()
	oldRedis, oldBatch := common.RedisEnabled, common.BatchUpdateEnabled
	model.DB, model.LOG_DB = db, db
	common.RedisEnabled, common.BatchUpdateEnabled = false, false
	dbType := common.DatabaseTypeSQLite
	if dialect == "mysql" {
		dbType = common.DatabaseTypeMySQL
	} else if dialect == "postgres" {
		dbType = common.DatabaseTypePostgreSQL
	}
	common.SetMainDatabaseType(dbType)
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogs
		common.SetMainDatabaseType(oldType)
		common.RedisEnabled, common.BatchUpdateEnabled = oldRedis, oldBatch
	})
	for _, table := range []any{&guard.MemberProfile{}, &guard.MemberFinding{}, &guard.Secret{}, &guard.Counter{}, &guard.Challenge{}, &guard.Event{}, &guard.Account{}, &guard.Grant{}, &guard.Reservation{}, &guard.Alert{}, &guard.Audit{}, &guard.Payer{}, &ledger.RefundNotice{}, &ledger.Audit{}, &ledger.Transfer{}, &ledger.Reward{}, &ledger.PaymentIdentity{}, &ledger.Signal{}, &ledger.Binding{}, &ledger.Account{}, &ledger.Settings{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}, &model.SystemTask{}, &model.SystemTaskLock{}, &model.Task{}, &model.Log{}, &model.User{}, &model.Token{}, &model.Option{}} {
		require.NoError(t, db.Migrator().DropTable(table))
	}
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Token{}, &model.Option{}, &ledger.Binding{}))
	require.NoError(t, ledger.Migrate(db))
	require.NoError(t, guard.Migrate(db))
	return db
}

func TestRegistrationRiskDatabaseMatrix(t *testing.T) {
	dialects := []string{"sqlite"}
	if selected := os.Getenv("REGISTRATIONRISK_TEST_DIALECT"); selected != "" {
		dialects = []string{selected}
	} else if os.Getenv("REGISTRATIONRISK_TEST_EXTERNAL") == "1" {
		dialects = append(dialects, "mysql", "postgres")
	}
	for _, dialect := range dialects {
		t.Run(dialect, func(t *testing.T) {
			db := riskDB(t, dialect)
			now := time.Date(2026, 11, 9, 10, 0, 0, 0, time.UTC)
			s := guard.Defaults()
			s.Mode, s.BonusQuota, s.BonusDailyQuota = "enforce", 100, 100
			s.BlockedDomains, s.DomainExceptions = []string{" MAIL.TM. ", "mail.tm"}, []string{"trusted.mail.tm"}
			s.Rules = []guard.Rule{{ID: "browser", Enabled: true, Stage: "register", Signal: "device", WindowSeconds: 86400, Limit: 1, Action: "review"}}
			saved, err := guard.SaveSettings(db, s)
			require.NoError(t, err)
			assert.Equal(t, []string{"mail.tm"}, saved.BlockedDomains)
			_, err = guard.SaveSettings(db, s)
			assert.ErrorIs(t, err, guard.ErrConflict)
			for _, change := range []func(*guard.Settings){
				func(s *guard.Settings) { s.Mode = "invalid" },
				func(s *guard.Settings) { s.BonusQuota = -1 },
				func(s *guard.Settings) { s.IPAgentHourlyLimit = -1 },
				func(s *guard.Settings) { s.IPAgentHourlyLimit = 10001 },
				func(s *guard.Settings) { s.BlockedDomains = []string{"*.com"} },
				func(s *guard.Settings) { s.AllowOnly = true; s.AllowedDomains = nil },
				func(s *guard.Settings) { s.AlertWebhook = "http://insecure.example" },
				func(s *guard.Settings) { s.Rules = append(s.Rules, s.Rules[0]) },
			} {
				invalid := saved
				change(&invalid)
				_, err := guard.SaveSettings(db, invalid)
				assert.ErrorIs(t, err, guard.ErrInvalid)
			}
			denied, err := guard.Evaluate(db, guard.Input{Stage: "register", Source: "password", Email: "bot@sub.mail.tm", Device: "same-browser", IP: "::ffff:192.0.2.10"}, now)
			assert.ErrorIs(t, err, guard.ErrDenied)
			assert.Equal(t, "deny", denied.Event.Action)
			allowed, err := guard.Evaluate(db, guard.Input{Stage: "register", Source: "password", Email: "human@trusted.mail.tm", Device: "other-browser", IP: "192.0.2.10"}, now)
			require.NoError(t, err)
			assert.Equal(t, "allow", allowed.Event.Action)
			assert.Equal(t, denied.Event.IPHash, allowed.Event.IPHash, "mapped IPv4 cannot bypass IP rules")
			assert.Equal(t, denied.Event.NetworkHash, allowed.Event.NetworkHash)
			review, err := guard.Evaluate(db, guard.Input{Stage: "register", Source: "password", Email: "human@example.com", Device: "same-browser", IP: "198.51.100.20"}, now)
			require.NoError(t, err)
			assert.Equal(t, "review", review.Event.Action, "changing proxies does not reset a browser counter")
			assert.True(t, review.Event.Enforced)
			encoded, err := common.Marshal(review.Event)
			require.NoError(t, err)
			assert.NotContains(t, string(encoded), "human@example.com")
			assert.NotContains(t, string(encoded), "198.51.100.20")
			assert.NotContains(t, string(encoded), "same-browser")

			// A denied or mail-stage decision must never mint signup credit, even if
			// a future controller forgets to check Evaluate's error.
			err = db.Transaction(func(tx *gorm.DB) error { return guard.AfterSignup(guard.WithDecision(tx, denied), 99, now) })
			assert.ErrorIs(t, err, guard.ErrDenied)
			mail, err := guard.Evaluate(db, guard.Input{Stage: "email", Email: "human@example.com"}, now)
			require.NoError(t, err)
			err = db.Transaction(func(tx *gorm.DB) error { return guard.AfterSignup(guard.WithDecision(tx, mail), 99, now) })
			assert.ErrorIs(t, err, guard.ErrDenied)

			user := model.User{Username: "signup", Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
			err = db.Transaction(func(tx *gorm.DB) error {
				if err := user.InsertWithTx(guard.WithDecision(tx, review), 0); err != nil {
					return err
				}
				return errors.New("invitation failed")
			})
			require.Error(t, err)
			var count int64
			require.NoError(t, db.Model(&guard.Grant{}).Count(&count).Error)
			assert.Zero(t, count)
			user.Id = 0
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return user.InsertWithTx(guard.WithDecision(tx, review), 0) }))
			assert.Zero(t, user.Quota, "signup credit must not become paid balance")
			var grant guard.Grant
			require.NoError(t, db.First(&grant, "user_id = ?", user.Id).Error)
			assert.Equal(t, "review", grant.State)
			err = db.Transaction(func(tx *gorm.DB) error { return guard.AfterSignup(guard.WithDecision(tx, review), 999, now) })
			assert.ErrorIs(t, err, guard.ErrDenied, "signup decision cannot be replayed")
			assert.ErrorIs(t, guard.Review(db, 1, user.Id, true, "x", now), guard.ErrInvalid)
			require.NoError(t, guard.Review(db, 1, user.Id, true, "verified customer", now))
			assert.ErrorIs(t, guard.Review(db, 1, user.Id, true, "duplicate approval", now), guard.ErrConflict)
			require.NoError(t, db.First(&grant, "user_id = ?", user.Id).Error)
			assert.Equal(t, "active", grant.State)

			// Policy, secret and JSON alert metadata survive repeated migrations.
			alert := guard.Alert{Kind: "risk-volume", SummaryKey: "{{count}} risky attempts in {{minutes}} minutes", SummaryParams: map[string]any{"count": 10, "minutes": 60}}
			require.NoError(t, db.Create(&alert).Error)
			salt, err := guard.Salt(db)
			require.NoError(t, err)
			require.NoError(t, guard.Migrate(db))
			require.NoError(t, guard.Migrate(db))
			retained, err := guard.GetSettings(db)
			require.NoError(t, err)
			assert.Equal(t, saved, retained)
			retainedSalt, err := guard.Salt(db)
			require.NoError(t, err)
			assert.Equal(t, salt, retainedSalt)
			var stored guard.Alert
			require.NoError(t, db.First(&stored, alert.ID).Error)
			assert.EqualValues(t, 10, stored.SummaryParams["count"])

			saved.Mode = "observe"
			saved, err = guard.SaveSettings(db, saved)
			require.NoError(t, err)
			d, err := guard.Evaluate(db, guard.Input{Stage: "register", Source: "oauth", Email: "bot@mail.tm"}, now)
			require.NoError(t, err)
			assert.Equal(t, "deny", d.Event.Action)
			assert.False(t, d.Event.Enforced)
			saved.Mode = "off"
			_, err = guard.SaveSettings(db, saved)
			require.NoError(t, err)
			d, err = guard.Evaluate(db, guard.Input{Stage: "register", Source: "oauth", Email: "bot@mail.tm"}, now)
			require.NoError(t, err)
			assert.Equal(t, "allow", d.Event.Action)
		})
	}
}

func TestDuplicateRegistrationIsBlockedBeforeAccountCreation(t *testing.T) {
	t.Run("registered browser remains blocked across days and policy revisions", func(t *testing.T) {
		db := riskDB(t, "sqlite")
		now := time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC)
		s := guard.Defaults()
		s.Mode, s.Rules, s.BonusEnabled = "enforce", nil, false
		s, err := guard.SaveSettings(db, s)
		require.NoError(t, err)
		input := guard.Input{Stage: "register", Source: "password", Device: "registered-browser", IP: "192.0.2.1", UserAgent: "Browser/1"}
		first, err := guard.Evaluate(db, input, now)
		require.NoError(t, err)
		user := model.User{Username: "first-browser-account", Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
		require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
			return user.InsertWithTx(SignupContext(tx, first), 0)
		}))
		_, err = guard.SaveSettings(db, s)
		require.NoError(t, err)
		input.IP, input.Source, input.VerifiedEmail = "198.51.100.1", "oauth", true
		second, err := guard.Evaluate(db, input, now.Add(48*time.Hour))
		assert.ErrorIs(t, err, guard.ErrDenied)
		assert.Equal(t, "deny", second.Event.Action)
		assert.Contains(t, second.Event.Reasons, "registered-browser")

		// Observation records the same finding without enforcing it.
		s, err = guard.GetSettings(db)
		require.NoError(t, err)
		s.Mode = "observe"
		_, err = guard.SaveSettings(db, s)
		require.NoError(t, err)
		observed, err := guard.Evaluate(db, input, now.Add(48*time.Hour))
		require.NoError(t, err)
		assert.Equal(t, "deny", observed.Event.Action)
		assert.False(t, observed.Event.Enforced)
	})

	t.Run("parallel preflight decisions cannot create two accounts in one browser", func(t *testing.T) {
		db := riskDB(t, "sqlite")
		now := time.Now()
		s := guard.Defaults()
		s.Mode, s.Rules = "enforce", nil
		s.BonusQuota = 100
		_, err := guard.SaveSettings(db, s)
		require.NoError(t, err)
		input := guard.Input{Stage: "register", Source: "password", Device: "parallel-browser"}
		first, err := guard.Evaluate(db, input, now)
		require.NoError(t, err)
		second, err := guard.Evaluate(db, input, now)
		require.NoError(t, err)
		secondDB := db
		if common.MainDatabaseType() != common.DatabaseTypeSQLite {
			// Hold a real overlapping transaction with an established read snapshot.
			// MySQL's default REPEATABLE READ must not hide the first signup.
			conn, err := db.DB()
			require.NoError(t, err)
			conn.SetMaxOpenConns(2)
			secondDB = db.Begin()
			require.NoError(t, secondDB.Error)
			t.Cleanup(func() { require.NoError(t, secondDB.Rollback().Error) })
			var count int64
			require.NoError(t, secondDB.Model(&model.User{}).Count(&count).Error)
		}
		for i, decision := range []*guard.Decision{first, second} {
			user := model.User{Username: fmt.Sprintf("parallel-account-%d", i), Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
			signupDB := db
			if i == 1 {
				signupDB = secondDB
			}
			err := signupDB.Transaction(func(tx *gorm.DB) error { return user.InsertWithTx(SignupContext(tx, decision), 0) })
			if i == 0 {
				require.NoError(t, err)
			} else {
				assert.ErrorIs(t, err, guard.ErrDenied)
			}
		}
		var count int64
		require.NoError(t, db.Model(&model.User{}).Count(&count).Error)
		assert.EqualValues(t, 1, count, "the rejected signup transaction leaves no user")
		require.NoError(t, db.Model(&guard.Grant{}).Count(&count).Error)
		assert.EqualValues(t, 1, count, "the rejected signup cannot issue another grant")
	})

	t.Run("clearing cookies does not reset the IP and UA signup limit", func(t *testing.T) {
		db := riskDB(t, "sqlite")
		now := time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC)
		s := guard.Defaults()
		s.Mode, s.Rules, s.BonusEnabled = "enforce", nil, false
		_, err := guard.SaveSettings(db, s)
		require.NoError(t, err)
		// Historical registrations must count immediately after an upgrade.
		require.NoError(t, db.Create(&guard.MemberProfile{UserID: 90, RegistrationIP: "192.0.2.1", RegistrationAgent: "Browser/1", RegisteredAt: now.Unix()}).Error)
		input := guard.Input{Stage: "register", Source: "password", Device: "fresh-cookie", IP: "::ffff:192.0.2.1", UserAgent: "Browser/1"}
		first, err := guard.Evaluate(db, input, now)
		require.NoError(t, err)
		user := model.User{Username: "second-network-account", Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
		require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return user.InsertWithTx(SignupContext(tx, first), 0) }))
		input.Device = "another-fresh-cookie"
		denied, err := guard.Evaluate(db, input, now)
		assert.ErrorIs(t, err, guard.ErrDenied)
		assert.Contains(t, denied.Event.Reasons, "ip-agent-hour")
		input.UserAgent = "OtherBrowser/1"
		_, err = guard.Evaluate(db, input, now)
		require.NoError(t, err, "a shared IP alone must not trigger this limit")
		input.UserAgent = "Browser/1"
		_, err = guard.Evaluate(db, input, now.Add(time.Hour))
		require.NoError(t, err, "the IP and UA limit expires with its hourly window")
	})

	t.Run("IP and UA quota is transactional even without member capture", func(t *testing.T) {
		db := riskDB(t, "sqlite")
		now := time.Now()
		s := guard.Defaults()
		s.Mode, s.Rules, s.BonusEnabled, s.IPAgentHourlyLimit = "enforce", nil, false, 1
		_, err := guard.SaveSettings(db, s)
		require.NoError(t, err)
		policy, err := guard.GetMemberPolicy(db)
		require.NoError(t, err)
		policy.CaptureEnabled = false
		require.NoError(t, guard.SaveMemberPolicy(db, policy, 1, now))
		// Omitting User-Agent must not bypass the limit either.
		input := guard.Input{Stage: "register", Source: "password", IP: "192.0.2.1"}
		first, err := guard.Evaluate(db, input, now)
		require.NoError(t, err)
		second, err := guard.Evaluate(db, input, now)
		require.NoError(t, err)
		aborted := errors.New("account binding failed")
		err = db.Transaction(func(tx *gorm.DB) error {
			user := model.User{Username: "rolled-back-signup", Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
			if err := user.InsertWithTx(SignupContext(tx, first), 0); err != nil {
				return err
			}
			return aborted
		})
		require.ErrorIs(t, err, aborted)
		for i, decision := range []*guard.Decision{first, second} {
			user := model.User{Username: fmt.Sprintf("ip-agent-account-%d", i), Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
			err := db.Transaction(func(tx *gorm.DB) error { return user.InsertWithTx(SignupContext(tx, decision), 0) })
			if i == 0 {
				require.NoError(t, err, "failed transactions do not consume the signup allowance")
			} else {
				assert.ErrorIs(t, err, guard.ErrDenied, "the final check rejects a stale preflight decision")
			}
		}
		_, err = guard.Evaluate(db, input, now)
		assert.ErrorIs(t, err, guard.ErrDenied)
		var count int64
		require.NoError(t, db.Model(&model.User{}).Count(&count).Error)
		assert.EqualValues(t, 1, count)
		require.NoError(t, db.Model(&guard.MemberProfile{}).Count(&count).Error)
		assert.Zero(t, count, "raw client metadata capture remains disabled")
	})

	t.Run("legacy settings get protection and explicit opt outs persist", func(t *testing.T) {
		db := riskDB(t, "sqlite")
		require.NoError(t, db.Create(&model.Option{Key: "RegistrationRiskExtensionSettings", Value: `{"mode":"enforce","rules":[],"bonus_enabled":false}`}).Error)
		s, err := guard.GetSettings(db)
		require.NoError(t, err)
		assert.True(t, s.DenyRegisteredBrowser)
		assert.Equal(t, 2, s.IPAgentHourlyLimit)
		encoded, err := common.Marshal(s)
		require.NoError(t, err)
		var legacyPayload map[string]any
		require.NoError(t, common.Unmarshal(encoded, &legacyPayload))
		delete(legacyPayload, "deny_registered_browser")
		delete(legacyPayload, "ip_agent_hourly_limit")
		encoded, err = common.Marshal(legacyPayload)
		require.NoError(t, err)
		response := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(response)
		c.Set("id", 1)
		c.Request = httptest.NewRequest(http.MethodPut, "/admin/settings", bytes.NewReader(encoded))
		putSettings(c)
		var result struct{ Success bool }
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success, response.Body.String())
		s, err = guard.GetSettings(db)
		require.NoError(t, err)
		assert.True(t, s.DenyRegisteredBrowser, "an older dashboard preserves the new protection")
		assert.Equal(t, 2, s.IPAgentHourlyLimit)
		s.DenyRegisteredBrowser, s.IPAgentHourlyLimit = false, 0
		s, err = guard.SaveSettings(db, s)
		require.NoError(t, err)
		loaded, err := guard.GetSettings(db)
		require.NoError(t, err)
		assert.Equal(t, s, loaded)
		input := guard.Input{Stage: "register", Source: "password", Device: "allowed-shared-browser", IP: "192.0.2.1", UserAgent: "Browser/1"}
		for i := range 2 {
			decision, err := guard.Evaluate(db, input, time.Now())
			require.NoError(t, err)
			user := model.User{Username: fmt.Sprintf("allowed-shared-account-%d", i), Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return user.InsertWithTx(SignupContext(tx, decision), 0) }))
		}
	})
}

func TestEmailChallengesExpireThrottleAndConsumeOnce(t *testing.T) {
	db := riskDB(t, "sqlite")
	now := time.Now()
	code, err := guard.IssueCode(db, " Person@Example.com ", now)
	require.NoError(t, err)
	assert.Len(t, code, 6)
	_, err = guard.IssueCode(db, "person@example.com", now)
	assert.ErrorIs(t, err, guard.ErrDenied)
	var challenge guard.Challenge
	require.NoError(t, db.First(&challenge).Error)
	assert.NotContains(t, challenge.CodeHash, code)
	var group sync.WaitGroup
	results := make(chan error, 2)
	for range 2 {
		group.Go(func() { results <- guard.ConsumeCode(db, "person@example.com", code, now) })
	}
	group.Wait()
	close(results)
	successes := 0
	for err := range results {
		if err == nil {
			successes++
		} else {
			assert.ErrorIs(t, err, guard.ErrCode)
		}
	}
	assert.Equal(t, 1, successes)
	code, err = guard.IssueCode(db, "expired@example.com", now)
	require.NoError(t, err)
	assert.ErrorIs(t, guard.ConsumeCode(db, "expired@example.com", code, now.Add(600*time.Second)), guard.ErrCode)
	code, err = guard.IssueCode(db, "locked@example.com", now)
	require.NoError(t, err)
	wrong := "000000"
	if wrong == code {
		wrong = "000001"
	}
	for range 5 {
		assert.ErrorIs(t, guard.ConsumeCode(db, "locked@example.com", wrong, now), guard.ErrCode)
	}
	assert.ErrorIs(t, guard.ConsumeCode(db, "locked@example.com", code, now), guard.ErrCode)
	_, err = guard.IssueCode(db, "locked@example.com", now.Add(61*time.Second))
	assert.ErrorIs(t, err, guard.ErrDenied, "resending does not reset brute-force failures")
	_, err = guard.IssueCode(db, "locked@example.com", now.Add(time.Hour))
	assert.NoError(t, err)
}

func TestPromotionalBillingReservationsAndBounds(t *testing.T) {
	db := riskDB(t, "sqlite")
	service.EnablePromotionalFunding()
	s := guard.Defaults()
	s.BonusModels, s.BonusConcurrency, s.BonusRPM = []string{"gpt-test"}, 2, 100
	_, err := guard.SaveSettings(db, s)
	require.NoError(t, err)
	for i, tc := range []struct {
		name                                           string
		wallet, reserve, actual, wantGrant, wantWallet int
	}{
		{"trial with empty paid wallet", 0, 0, 60, 940, 0},
		{"exact initial estimate", 0, 0, 100, 900, 0},
		{"additional reservation uses wallet", 200, 150, 130, 900, 170},
		{"overage uses wallet", 200, 0, 140, 900, 160},
	} {
		t.Run(tc.name, func(t *testing.T) {
			uid := i + 1
			require.NoError(t, db.Create(&model.User{Id: uid, Username: fmt.Sprint("billing", uid), AffCode: fmt.Sprint(uid), Quota: tc.wallet, Status: common.UserStatusEnabled}).Error)
			require.NoError(t, db.Create(&guard.Grant{UserID: uid, Total: 1000, Remaining: 1000, State: "active", ExpiresAt: time.Now().Unix() + 3600}).Error)
			require.NoError(t, db.Create(&model.Token{Id: uid, UserId: uid, Key: fmt.Sprint("key", uid), RemainQuota: 1000}).Error)
			info := &relaycommon.RelayInfo{UserId: uid, TokenId: uid, TokenKey: fmt.Sprint("key", uid), RequestId: fmt.Sprint("request", uid), OriginModelName: "gpt-test"}
			info.UserSetting.BillingPreference = "wallet_only"
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
			session, apiErr := service.NewBillingSession(c, info, 100)
			require.Nil(t, apiErr)
			assert.Equal(t, service.BillingSourcePromotional, info.BillingSource)
			if tc.reserve > 0 {
				require.NoError(t, session.ReserveBeforeSubmit(tc.reserve))
			}
			for _, invalid := range []int{-1, math.MaxInt32 + 1} {
				assert.Error(t, session.ReserveBeforeSubmit(invalid), "invalid reservation must fail before any accounting mutation")
				_, apiErr := service.NewBillingSession(c, info, invalid)
				assert.NotNil(t, apiErr)
			}
			require.NoError(t, session.Settle(tc.actual))
			require.NoError(t, session.Settle(tc.actual))
			assert.False(t, session.NeedsRefund())
			session.Refund(c)
			var grant guard.Grant
			var user model.User
			var token model.Token
			require.NoError(t, db.First(&grant, "user_id = ?", uid).Error)
			require.NoError(t, db.First(&user, uid).Error)
			require.NoError(t, db.First(&token, uid).Error)
			assert.Equal(t, tc.wantGrant, grant.Remaining)
			assert.Equal(t, tc.wantWallet, user.Quota)
			assert.Equal(t, 1000-tc.actual, token.RemainQuota)
			assert.Equal(t, min(100, tc.actual), info.PromotionalConsumed)
			assert.Equal(t, max(0, tc.actual-100), info.PromotionalWalletConsumed)
		})
	}
}

func TestSignupBudgetHoldsExcessAndPreservesPaidBalances(t *testing.T) {
	db := riskDB(t, "sqlite")
	now := time.Now()
	s := guard.Defaults()
	s.Mode, s.Rules, s.BonusQuota, s.BonusDailyQuota = "enforce", nil, 100, 100
	_, err := guard.SaveSettings(db, s)
	require.NoError(t, err)
	for _, tc := range []struct {
		id    int
		state string
	}{{1, "active"}, {2, "review"}} {
		d, err := guard.Evaluate(db, guard.Input{Stage: "register", Source: "password"}, now)
		require.NoError(t, err)
		user := model.User{Username: fmt.Sprint("budget", tc.id), AffCode: fmt.Sprint(tc.id), Quota: 75}
		require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Create(&user).Error; err != nil {
				return err
			}
			return guard.AfterSignup(guard.WithDecision(tx, d), user.Id, now)
		}))
		var grant guard.Grant
		require.NoError(t, db.First(&grant, "user_id = ?", user.Id).Error)
		assert.Equal(t, tc.state, grant.State)
		assert.Equal(t, 100, grant.Remaining)
		if tc.state == "review" {
			_, err := guard.ReserveTrial(db, "budget-held", user.Id, 10, "gpt-test", now)
			assert.ErrorIs(t, err, guard.ErrUnavailable)
			require.NoError(t, guard.Review(db, 99, user.Id, true, "approved after budget review", now))
		}
		var persisted model.User
		require.NoError(t, db.First(&persisted, user.Id).Error)
		assert.Equal(t, 75, persisted.Quota)
	}
}

func TestUnavailablePromotionsFallBackWithoutDoubleChargingTokens(t *testing.T) {
	db := riskDB(t, "sqlite")
	service.EnablePromotionalFunding()
	s := guard.Defaults()
	s.BonusModels = []string{"eligible"}
	_, err := guard.SaveSettings(db, s)
	require.NoError(t, err)
	for i, tc := range []struct {
		name, model string
		remaining   int
		expires     int64
	}{
		{"excluded model", "other", 1000, time.Now().Unix() + 3600},
		{"insufficient grant", "eligible", 50, time.Now().Unix() + 3600},
		{"expired grant", "eligible", 1000, time.Now().Unix() - 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			uid := i + 1
			require.NoError(t, db.Create(&model.User{Id: uid, Username: fmt.Sprint("fallback", uid), AffCode: fmt.Sprint(uid), Quota: 200}).Error)
			require.NoError(t, db.Create(&model.Token{Id: uid, UserId: uid, Key: fmt.Sprint("fallback-key", uid), RemainQuota: 1000}).Error)
			require.NoError(t, db.Create(&guard.Grant{UserID: uid, Total: 1000, Remaining: tc.remaining, State: "active", ExpiresAt: tc.expires}).Error)
			info := &relaycommon.RelayInfo{UserId: uid, TokenId: uid, TokenKey: fmt.Sprint("fallback-key", uid), RequestId: fmt.Sprint("fallback-request", uid), OriginModelName: tc.model}
			info.UserSetting.BillingPreference = "wallet_only"
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
			session, apiErr := service.NewBillingSession(c, info, 100)
			require.Nil(t, apiErr)
			assert.Equal(t, service.BillingSourceWallet, info.BillingSource)
			require.NoError(t, session.Settle(140))
			var user model.User
			var token model.Token
			var grant guard.Grant
			require.NoError(t, db.First(&user, uid).Error)
			require.NoError(t, db.First(&token, uid).Error)
			require.NoError(t, db.First(&grant, "user_id = ?", uid).Error)
			assert.Equal(t, 60, user.Quota)
			assert.Equal(t, 860, token.RemainQuota)
			assert.Equal(t, tc.remaining, grant.Remaining)
		})
	}
}

func TestPromotionalPartialSettlementRetriesWithoutRefundingCommittedWallet(t *testing.T) {
	db := riskDB(t, "sqlite")
	service.EnablePromotionalFunding()
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "partial", AffCode: "partial", Quota: 200}).Error)
	require.NoError(t, db.Create(&model.Token{Id: 1, UserId: 1, Key: "partial-key", RemainQuota: 100}).Error)
	grant := guard.Grant{UserID: 1, Total: 1000, Remaining: 1000, State: "active", ExpiresAt: time.Now().Unix() + 3600}
	require.NoError(t, db.Create(&grant).Error)
	info := &relaycommon.RelayInfo{UserId: 1, TokenId: 1, TokenKey: "partial-key", RequestId: "partial-request", OriginModelName: "gpt-test"}
	info.UserSetting.BillingPreference = "wallet_only"
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	session, apiErr := service.NewBillingSession(c, info, 100)
	require.Nil(t, apiErr)
	assert.Error(t, session.ReserveBeforeSubmit(150), "token failure must roll back the extra paid reservation")
	var user model.User
	require.NoError(t, db.First(&user, 1).Error)
	assert.Equal(t, 200, user.Quota)
	require.NoError(t, db.Delete(&grant).Error)
	assert.ErrorIs(t, session.Settle(130), guard.ErrConflict)
	assert.False(t, session.NeedsRefund(), "paid leg is already committed")
	session.Refund(c)
	assert.ErrorIs(t, session.Settle(140), guard.ErrConflict, "retry cannot change a committed charge")
	grant.Remaining = 900
	require.NoError(t, db.Create(&grant).Error)
	require.NoError(t, session.Settle(130))
	require.NoError(t, session.Settle(130))
	require.NoError(t, db.First(&user, 1).Error)
	require.NoError(t, db.First(&grant, "user_id = ?", 1).Error)
	var token model.Token
	require.NoError(t, db.First(&token, 1).Error)
	assert.Equal(t, 170, user.Quota, "retry must not charge the paid leg twice")
	assert.Equal(t, 900, grant.Remaining)
	assert.Equal(t, -30, token.RemainQuota, "only actual usage is recorded, including overage")
}

type riskTransport func(*http.Request) (*http.Response, error)

func (f riskTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestSignedBrowserCookieAndCaptchaCannotBeForged(t *testing.T) {
	db := riskDB(t, "sqlite")
	oldSecure, oldTransport, oldTurnstile := common.SessionCookieSecure, http.DefaultTransport, common.TurnstileCheckEnabled
	oldSite, oldSecret := common.TurnstileSiteKey, common.TurnstileSecretKey
	common.SessionCookieSecure, common.TurnstileSiteKey, common.TurnstileSecretKey = true, "site", "secret"
	t.Cleanup(func() {
		common.SessionCookieSecure, http.DefaultTransport, common.TurnstileCheckEnabled = oldSecure, oldTransport, oldTurnstile
		common.TurnstileSiteKey, common.TurnstileSecretKey = oldSite, oldSecret
	})
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "https://risk.example/api/status", nil)
	device, err := Device(c)
	require.NoError(t, err)
	cookies := c.Writer.Header().Values("Set-Cookie")
	require.Len(t, cookies, 1)
	assert.Contains(t, cookies[0], "HttpOnly")
	assert.Contains(t, cookies[0], "Secure")
	assert.Contains(t, cookies[0], "SameSite=Lax")
	cookie := (&http.Response{Header: c.Writer.Header()}).Cookies()[0]
	for _, tc := range []struct {
		name, value string
		same        bool
	}{{"valid", cookie.Value, true}, {"tampered", cookie.Value + "x", false}, {"expired", device + ".1.invalid", false}} {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("GET", "https://risk.example/api/status", nil)
			c.Request.AddCookie(&http.Cookie{Name: deviceCookie, Value: tc.value})
			got, err := Device(c)
			require.NoError(t, err)
			assert.Equal(t, tc.same, got == device)
		})
	}
	s := guard.Defaults()
	s.Mode, s.Captcha, s.CaptchaHostname = "enforce", true, "risk.example"
	_, err = guard.SaveSettings(db, s)
	require.NoError(t, err)
	router := gin.New()
	router.POST("/register", Captcha(), func(c *gin.Context) { c.String(200, "accepted") })
	for _, tc := range []struct {
		token, response string
		accepted        bool
	}{{"", `{}`, false}, {"test", `{"success":false}`, false}, {"test", `{"success":true,"hostname":"foreign.example"}`, false}, {"test", `{"success":true,"hostname":"risk.example"}`, true}} {
		http.DefaultTransport = riskTransport(func(r *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(tc.response))}, nil
		})
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("POST", "/register?turnstile="+tc.token, nil))
		assert.Equal(t, tc.accepted, w.Body.String() == "accepted")
	}
}

func TestGrantLimitsRefundExpiryAndTrustedPayerReview(t *testing.T) {
	db := riskDB(t, "sqlite")
	now := time.Now()
	s := guard.Defaults()
	s.Mode, s.BonusModels, s.BonusRPM, s.BonusConcurrency, s.LeaseSeconds = "enforce", []string{"gpt-test"}, 2, 1, 60
	_, err := guard.SaveSettings(db, s)
	require.NoError(t, err)
	for _, uid := range []int{1, 2} {
		require.NoError(t, db.Create(&model.User{Id: uid, Username: fmt.Sprint("payer", uid), AffCode: fmt.Sprint(uid), Quota: 500, Status: common.UserStatusEnabled}).Error)
		require.NoError(t, db.Create(&guard.Account{UserID: uid, State: "active"}).Error)
		require.NoError(t, db.Create(&guard.Grant{UserID: uid, Total: 1000, Remaining: 1000, State: "active", ExpiresAt: now.Unix() + 3600}).Error)
		require.NoError(t, db.Create(&ledger.Binding{UserID: uid, State: "active"}).Error)
	}
	_, err = guard.ReserveTrial(db, "wrong-model", 1, 100, "gpt-other", now)
	assert.ErrorIs(t, err, guard.ErrUnavailable)
	_, err = guard.ReserveTrial(db, "one", 1, 100, "gpt-test", now)
	require.NoError(t, err)
	_, err = guard.ReserveTrial(db, "one", 1, 100, "gpt-test", now)
	require.NoError(t, err, "same request retry reserves only once")
	_, err = guard.ReserveTrial(db, "two", 1, 100, "gpt-test", now)
	assert.ErrorIs(t, err, guard.ErrUnavailable, "live reservation occupies concurrency")
	require.NoError(t, guard.FinishTrial(db, "one", 1, 60, false))
	require.NoError(t, guard.FinishTrial(db, "one", 1, 60, false))
	_, err = guard.ReserveTrial(db, "two", 1, 100, "gpt-test", now)
	require.NoError(t, err)
	require.NoError(t, guard.FinishTrial(db, "two", 1, 0, true))
	require.NoError(t, guard.FinishTrial(db, "two", 1, 0, true))
	_, err = guard.ReserveTrial(db, "three", 1, 100, "gpt-test", now)
	assert.ErrorIs(t, err, guard.ErrUnavailable, "refunding does not reset RPM")
	_, err = guard.ReserveTrial(db, "leased", 1, 100, "gpt-test", now.Add(time.Minute))
	require.NoError(t, err)
	_, err = guard.ReserveTrial(db, "next-lease", 1, 100, "gpt-test", now.Add(2*time.Minute))
	require.NoError(t, err, "expired lease releases concurrency")
	require.NoError(t, db.Model(&guard.Grant{}).Where("user_id = ?", 1).Update("expires_at", now.Unix()).Error)
	require.NoError(t, guard.FinishTrial(db, "next-lease", 1, 0, true))
	_, err = guard.ReserveTrial(db, "expired", 1, 1, "gpt-test", now.Add(3*time.Minute))
	assert.ErrorIs(t, err, guard.ErrUnavailable, "a refund cannot reactivate expired credit")
	var user model.User
	require.NoError(t, db.First(&user, 1).Error)
	assert.Equal(t, 500, user.Quota, "grant refunds never enter paid balance")
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return guard.MarkSharedPayer(tx, 1, "stripe", "trusted-provider-payer", now) }))
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return guard.MarkSharedPayer(tx, 2, "stripe", "trusted-provider-payer", now) }))
	for _, uid := range []int{1, 2} {
		var grant guard.Grant
		var binding ledger.Binding
		user = model.User{}
		require.NoError(t, db.First(&grant, "user_id = ?", uid).Error)
		require.NoError(t, db.First(&binding, "user_id = ?", uid).Error)
		require.NoError(t, db.First(&user, uid).Error)
		assert.Equal(t, "review", grant.State)
		assert.Equal(t, "review", binding.State)
		assert.Equal(t, 500, user.Quota)
		assert.Equal(t, common.UserStatusEnabled, user.Status)
	}
	require.NoError(t, guard.Review(db, 99, 2, false, "confirmed reward abuse", now))
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return guard.MarkSharedPayer(tx, 2, "stripe", "trusted-provider-payer", now) }))
	var rejected guard.Grant
	require.NoError(t, db.First(&rejected, "user_id = ?", 2).Error)
	assert.Equal(t, "rejected", rejected.State)
}

func TestRiskRoutesRequireRootSessionOriginAndOwnCredit(t *testing.T) {
	db := riskDB(t, "sqlite")
	oldSecret, oldSecure := common.SessionSecret, common.SessionCookieSecure
	common.SessionSecret, common.SessionCookieSecure = "registration-risk-session-test", true
	t.Cleanup(func() { common.SessionSecret, common.SessionCookieSecure = oldSecret, oldSecure })
	require.NoError(t, db.AutoMigrate(&model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}, &model.SystemTask{}, &model.SystemTaskLock{}))
	require.NoError(t, model.EnsureLegacyAccessTokenRetireAt(time.Now().Unix()))
	tokens := map[string]string{}
	for _, actor := range []struct {
		name string
		role int
	}{{"member", common.RoleCommonUser}, {"admin", common.RoleAdminUser}, {"root", common.RoleRootUser}} {
		user := model.User{Username: actor.name, Role: actor.role, Status: common.UserStatusEnabled, AuthVersion: 1, AffCode: actor.name}
		require.NoError(t, db.Create(&user).Error)
		session := model.UserSession{SID: "risk-" + actor.name, UserID: user.Id, Version: 1, UserAuthVersion: 1, Status: model.UserSessionStatusActive, RefreshHash: "unusable", LoginMethod: "password", LastActiveAt: time.Now().Unix(), ExpiresAt: time.Now().Unix() + 3600}
		require.NoError(t, model.CreateUserSession(&session))
		token, _, err := service.IssueAccessToken(service.AuthIdentity{UserID: user.Id, SessionID: session.SID, UserAuthVersion: 1, SessionVersion: 1})
		require.NoError(t, err)
		tokens[actor.name] = token
	}
	require.NoError(t, db.Create(&guard.Grant{UserID: 999, Remaining: 123, State: "active"}).Error)
	RegisterTasks()
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
		{"GET", "/credit", "", "", "", 401, false},
		{"GET", "/credit?user_id=999", "member", "", "", 200, true},
		{"GET", "/admin/settings", "member", "", "", 403, false},
		{"GET", "/admin/settings", "admin", "", "", 403, false},
		{"GET", "/admin/settings", "root", "", "", 200, true},
		{"GET", "/admin/members", "member", "", "", 403, false},
		{"GET", "/admin/members", "admin", "", "", 403, false},
		{"GET", "/admin/members", "root", "", "", 200, true},
		{"GET", "/admin/members?user_id=bad", "root", "", "", 200, false},
		{"GET", "/admin/member-policy", "member", "", "", 403, false},
		{"GET", "/admin/member-policy", "root", "", "", 200, true},
		{"GET", "/admin/member-analysis", "admin", "", "", 403, false},
		{"GET", "/admin/member-analysis", "root", "", "", 200, true},
		{"POST", "/admin/members/review", "root", "", "{}", 403, false},
		{"POST", "/admin/members/review", "root", "https://foreign.example", "{}", 403, false},
		{"POST", "/admin/members/review", "root", "https://registrationrisk.example", "{}", 200, false},
		{"PUT", "/admin/member-policy", "root", "https://foreign.example", "{}", 403, false},
		{"PUT", "/admin/member-policy", "root", "https://registrationrisk.example", "{}", 200, false},
		{"POST", "/admin/member-analysis", "root", "https://foreign.example", "", 403, false},
		{"POST", "/admin/member-analysis", "root", "", "", 403, false},
		{"POST", "/admin/member-analysis", "member", "https://registrationrisk.example", "", 403, false},
		{"POST", "/admin/member-analysis", "root", "https://registrationrisk.example", "", 200, true},
		{"GET", "/admin/records?kind=invalid", "root", "", "", 200, false},
		{"PUT", "/admin/settings", "root", "https://foreign.example", "{}", 403, false},
		{"PUT", "/admin/settings", "root", "https://registrationrisk.example", "{broken", 200, false},
		{"POST", "/admin/review", "root", "https://registrationrisk.example", `{"user_id":999,"approve":true,"reason":"x"}`, 200, false},
		{"POST", "/admin/check-alerts", "root", "https://foreign.example", "", 403, false},
		{"POST", "/admin/check-alerts", "root", "https://registrationrisk.example", "", 200, true},
	} {
		t.Run(fmt.Sprintf("%s %s %s %s", tc.method, tc.path, tc.who, tc.origin), func(t *testing.T) {
			r := httptest.NewRequest(tc.method, "https://registrationrisk.example/api/extensions/registration-risk"+tc.path, bytes.NewBufferString(tc.body))
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
				var result struct {
					Success bool
					Data    struct{ Grant *guard.Grant }
				}
				require.NoError(t, common.Unmarshal(w.Body.Bytes(), &result))
				assert.Equal(t, tc.success, result.Success, w.Body.String())
				if strings.HasPrefix(tc.path, "/credit") {
					assert.Nil(t, result.Data.Grant, "query parameters cannot read another user's credit")
				}
			}
		})
	}
}

func TestAlertsDeduplicateRetrySeparatelyAndRetainLedgers(t *testing.T) {
	db := riskDB(t, "sqlite")
	require.NoError(t, i18n.Init())
	now := time.Now()
	s := guard.Defaults()
	s.AlertEnabled, s.AlertRiskCount, s.AlertWebhook, s.RetentionDays = true, 1, "https://alerts.example/hook", 1
	_, err := guard.SaveSettings(db, s)
	require.NoError(t, err)
	require.NoError(t, db.Create(&guard.Event{Stage: "register", Action: "deny", CreatedAt: now.Unix()}).Error)
	require.NoError(t, db.Create(&guard.Event{Stage: "register", Action: "deny", CreatedAt: now.Add(-48 * time.Hour).Unix()}).Error)
	require.NoError(t, db.Create(&guard.Grant{UserID: 1, Total: 1, Remaining: 1, State: "expired", CreatedAt: now.Add(-48 * time.Hour).Unix()}).Error)
	oldTransport := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = oldTransport })
	calls, fail := 0, true
	http.DefaultTransport = riskTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		assert.Contains(t, string(body), "registration-risk")
		status := 200
		if fail {
			status = 503
		}
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(""))}, nil
	})
	require.NoError(t, maintain(db, now, true))
	require.NoError(t, maintain(db, now, true))
	assert.Equal(t, 1, calls, "deduplication and retry backoff apply to forced checks")
	var alert guard.Alert
	require.NoError(t, db.First(&alert).Error)
	assert.Zero(t, alert.DeliveredAt)
	assert.Equal(t, "Webhook delivery failed", alert.LastError)
	assert.Equal(t, "{{count}} risky attempts in {{minutes}} minutes", alert.SummaryKey)
	// A receipt for a completed email leg must survive a failed webhook retry.
	require.NoError(t, db.Model(&alert).Update("email_done", true).Error)
	fail = false
	require.NoError(t, maintain(db, now.Add(time.Minute), true))
	assert.Equal(t, 2, calls)
	require.NoError(t, db.First(&alert).Error)
	assert.True(t, alert.EmailDone)
	assert.True(t, alert.WebhookDone)
	assert.Positive(t, alert.DeliveredAt)
	var count int64
	require.NoError(t, db.Model(&guard.Alert{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
	require.NoError(t, db.Model(&guard.Event{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
	require.NoError(t, db.Model(&guard.Grant{}).Count(&count).Error)
	assert.EqualValues(t, 1, count, "retention never deletes accounting ledgers")
}

func TestMemberProfilesAndAnalysisDatabaseMatrix(t *testing.T) {
	dialects := []string{"sqlite"}
	if selected := os.Getenv("REGISTRATIONRISK_TEST_DIALECT"); selected != "" {
		dialects = []string{selected}
	} else if os.Getenv("REGISTRATIONRISK_TEST_EXTERNAL") == "1" {
		dialects = append(dialects, "mysql", "postgres")
	}
	for _, dialect := range dialects {
		t.Run(dialect, func(t *testing.T) {
			db := riskDB(t, dialect)
			now := time.Now().Truncate(time.Second)
			var version string
			if dialect == "sqlite" {
				require.NoError(t, db.Raw("SELECT sqlite_version()").Scan(&version).Error)
			} else {
				require.NoError(t, db.Raw("SELECT version()").Scan(&version).Error)
			}
			t.Log(dialect, version)
			// Represent the released schema: existing users/risk accounts and no
			// member tables. Upgrading twice preserves history without inventing it.
			require.NoError(t, db.Migrator().DropTable(&guard.MemberFinding{}, &guard.MemberProfile{}))
			legacy := model.User{Username: "legacy", Email: "old@example.com", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Quota: 123, Remark: "account note", CreatedAt: now.Unix() - 400*86400}
			require.NoError(t, db.Create(&legacy).Error)
			require.NoError(t, db.Create(&guard.Account{UserID: legacy.Id, State: "active", CreatedAt: legacy.CreatedAt, DeviceHash: "old-device"}).Error)
			require.NoError(t, guard.Migrate(db))
			require.NoError(t, guard.Migrate(db))
			var membersBefore []memberRow
			require.NoError(t, memberQuery(db).Select(memberColumns).Scan(&membersBefore).Error)
			require.Len(t, membersBefore, 1)
			assert.Empty(t, membersBefore[0].RegistrationIP)
			assert.Equal(t, "account note", membersBefore[0].Remark)
			assert.Equal(t, "active", membersBefore[0].Qualification)

			s := guard.Defaults()
			s.Mode, s.BonusEnabled = "off", false
			s.BlockedDomains, s.DomainExceptions = []string{"mail.tm"}, []string{"trusted.mail.tm"}
			_, err := guard.SaveSettings(db, s)
			require.NoError(t, err)
			decision, err := guard.Evaluate(db, guard.Input{Stage: "register", Source: "oauth", Email: "new@mail.tm", IP: "::ffff:192.0.2.10", UserAgent: "Browser\n" + strings.Repeat("界", 400)}, now)
			require.NoError(t, err)
			err = db.Transaction(func(tx *gorm.DB) error {
				if err := guard.AfterSignup(guard.WithDecision(tx, decision), 99, now); err != nil {
					return err
				}
				return errors.New("abort registration")
			})
			require.Error(t, err)
			var count int64
			require.NoError(t, db.Model(&guard.MemberProfile{}).Count(&count).Error)
			assert.Zero(t, count, "failed registration must not create a member profile")
			newUser := model.User{Username: "new-member", AffCode: "new-member", Email: "new@mail.tm", CreatedAt: now.Unix(), Status: common.UserStatusEnabled, Quota: 456}
			require.NoError(t, db.Create(&newUser).Error)
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return guard.AfterSignup(guard.WithDecision(tx, decision), newUser.Id, now) }))
			assert.ErrorIs(t, guard.AfterSignup(guard.WithDecision(db, decision), 99, now), guard.ErrDenied)
			var profile guard.MemberProfile
			require.NoError(t, db.First(&profile, "user_id = ?", newUser.Id).Error)
			assert.Equal(t, "192.0.2.10", profile.RegistrationIP)
			assert.NotContains(t, profile.RegistrationAgent, "\n")
			assert.LessOrEqual(t, len(profile.RegistrationAgent), 1024)
			assert.Equal(t, "oauth", profile.RegistrationSource)
			require.Error(t, db.Create(&guard.MemberProfile{UserID: newUser.Id}).Error, "unique user profile must survive migration")
			require.NoError(t, guard.ReviewMember(db, newUser.Id, legacy.Id, 0, "watch", "check shared household", now))
			assert.ErrorIs(t, guard.ReviewMember(db, newUser.Id, legacy.Id, 0, "cleared", "stale review", now), guard.ErrConflict)
			assert.ErrorIs(t, guard.ReviewMember(db, newUser.Id, legacy.Id, 1, "cleared", " ", now), guard.ErrInvalid)
			assert.ErrorIs(t, guard.ReviewMember(db, newUser.Id, legacy.Id, 1, "invalid", "note", now), guard.ErrInvalid)
			require.NoError(t, guard.RecordMemberLogin(db, newUser.Id, "198.51.100.20", "Login Browser", "passkey", now))
			require.NoError(t, guard.RecordMemberLogin(db, newUser.Id, "198.51.100.99", "Old Browser", "oauth", now.Add(-time.Second)))
			require.NoError(t, db.First(&profile, "user_id = ?", newUser.Id).Error)
			assert.Equal(t, "Login Browser", profile.LastLoginAgent)
			assert.Equal(t, "passkey", profile.LastLoginMethod)
			assert.Equal(t, "192.0.2.10", profile.RegistrationIP)
			assert.Equal(t, "check shared household", profile.Note)
			assert.EqualValues(t, 1, profile.Version)
			require.NoError(t, guard.RecordMemberLogin(db, legacy.Id, "198.51.100.20", "Legacy Browser", "oauth", now))
			policy := guard.DefaultMemberPolicy()
			policy.DeviceLimit, policy.SignupIPLimit, policy.LoginIPLimit = 2, 2, 2
			policy.NetworkLimit, policy.InviterLimit, policy.PayerLimit = 0, 0, 2
			require.NoError(t, guard.SaveMemberPolicy(db, policy, legacy.Id, now))
			assert.ErrorIs(t, guard.SaveMemberPolicy(db, policy, legacy.Id, now), guard.ErrConflict)
			policy.Revision++
			invalid := policy
			invalid.LoginIPLimit = 1
			assert.ErrorIs(t, guard.SaveMemberPolicy(db, invalid, legacy.Id, now), guard.ErrInvalid)
			require.NoError(t, db.Create(&[]guard.Payer{{Digest: "trusted-payer", UserID: legacy.Id}, {Digest: "trusted-payer", UserID: newUser.Id}}).Error)
			unknown := model.User{Username: "unknown", AffCode: "unknown", Email: "human@trusted.mail.tm", Status: common.UserStatusEnabled}
			require.NoError(t, db.Create(&unknown).Error)
			require.NoError(t, db.Model(&guard.Account{}).Where("user_id = ?", newUser.Id).Update("state", "review").Error)
			summary, err := analyzeMembers(db, "first-snapshot", memberAnalysisPayload{ActorID: legacy.Id, Policy: policy}, now)
			require.NoError(t, err)
			assert.Equal(t, 3, summary.Total)
			assert.Equal(t, 2, summary.Flagged)
			assert.Equal(t, 1, summary.Insufficient)
			var findings []guard.MemberFinding
			require.NoError(t, db.Order("user_id").Find(&findings).Error)
			require.Len(t, findings, 3)
			assert.Equal(t, []guard.MemberSignal{{Code: "login-ip", Count: 2, Threshold: 2, RelatedIDs: []int{newUser.Id}}, {Code: "payer", Count: 2, Threshold: 2, RelatedIDs: []int{newUser.Id}}}, findings[0].Signals)
			assert.Equal(t, []guard.MemberSignal{{Code: "login-ip", Count: 2, Threshold: 2, RelatedIDs: []int{legacy.Id}}, {Code: "payer", Count: 2, Threshold: 2, RelatedIDs: []int{legacy.Id}}, {Code: "domain", Count: 1, RelatedIDs: []int{}}}, findings[1].Signals)
			assert.Empty(t, findings[2].Signals, "blank metadata and allowed domain exceptions never form signals")
			assert.Equal(t, "unavailable", findings[2].Coverage)
			_, err = analyzeMembers(db, "first-snapshot", memberAnalysisPayload{ActorID: legacy.Id, Policy: policy}, now)
			require.NoError(t, err, "resumed snapshot replaces its own rows")
			require.NoError(t, db.Model(&guard.MemberFinding{}).Count(&count).Error)
			assert.EqualValues(t, 3, count)
			require.NoError(t, guard.Migrate(db))
			require.NoError(t, guard.Migrate(db))
			stored, err := guard.GetMemberPolicy(db)
			require.NoError(t, err)
			assert.Equal(t, policy, stored)
			stored.CaptureEnabled = false
			require.NoError(t, guard.SaveMemberPolicy(db, stored, legacy.Id, now))
			require.NoError(t, guard.RecordMemberLogin(db, newUser.Id, "192.0.2.99", "Disabled capture", "oauth", now.Add(time.Hour)))
			require.NoError(t, db.First(&profile, "user_id = ?", newUser.Id).Error)
			assert.Equal(t, "198.51.100.20", profile.LastLoginIP)
			require.NoError(t, guard.PurgeMemberMetadata(db, now.Add(181*24*time.Hour)))
			require.NoError(t, db.First(&profile, "user_id = ?", newUser.Id).Error)
			assert.Empty(t, profile.RegistrationIP)
			assert.Empty(t, profile.LastLoginAgent)
			assert.Equal(t, now.Unix(), profile.RegisteredAt)
			assert.Equal(t, "check shared household", profile.Note)
			var user model.User
			require.NoError(t, db.First(&user, newUser.Id).Error)
			assert.Equal(t, 456, user.Quota)
			assert.Equal(t, common.UserStatusEnabled, user.Status, "analysis and profile review never ban users or alter funds")
		})
	}
}

func TestMemberRewardReviewDatabaseMatrix(t *testing.T) {
	dialects := []string{"sqlite"}
	if os.Getenv("REGISTRATIONRISK_TEST_EXTERNAL") == "1" {
		dialects = append(dialects, "mysql", "postgres")
	}
	for _, dialect := range dialects {
		t.Run(dialect, func(t *testing.T) {
			db := riskDB(t, dialect)
			now := time.Now().Truncate(time.Second)
			for id := 1; id <= 7; id++ {
				user := model.User{Username: fmt.Sprintf("office-member-%d", id), AffCode: fmt.Sprintf("office-%d", id), Email: fmt.Sprintf("office-%d@example.com", id), Status: common.UserStatusEnabled, CreatedAt: now.Unix(), Quota: 500000}
				ip := "198.51.100.10"
				if id >= 2 && id <= 4 {
					user.InviterId, ip = 1, "192.0.2.10"
				}
				require.NoError(t, db.Create(&user).Error)
				require.Equal(t, id, user.Id)
				device := fmt.Sprintf("office-browser-%d", id)
				if id == 7 {
					device = "office-browser-6"
				}
				require.NoError(t, db.Create(&guard.Account{UserID: id, CreatedAt: now.Unix(), DeviceHash: device, NetworkHash: ip, State: "active"}).Error)
				require.NoError(t, db.Create(&guard.MemberProfile{UserID: id, RegistrationIP: ip, RegistrationAgent: "Identical office browser", RegisteredAt: now.Unix(), LastLoginIP: ip, LastSeenAt: now.Unix(), Note: "Preserve review note"}).Error)
				if id >= 2 && id <= 4 {
					binding := ledger.Binding{UserID: id, InviterID: 1, RegisteredAt: now.Unix() - int64(id)*60, State: "active", SignupBonusQuota: 500000, SignupBonusAvailableAt: now.Unix() + 86400}
					if id == 2 {
						binding.SignupBonusPaidAt = now.Unix()
					}
					require.NoError(t, db.Create(&binding).Error)
				}
			}
			settings, err := ledger.GetSettings(db)
			require.NoError(t, err)
			settings.InviteBurstLimit = 0
			require.NoError(t, ledger.UpdateSettings(db, settings, 1))
			policy := guard.DefaultMemberPolicy()
			policy.SignupIPLimit, policy.LoginIPLimit, policy.NetworkLimit, policy.InviterLimit = 2, 2, 2, 2
			summary, err := analyzeMembers(db, "office-clues", memberAnalysisPayload{Policy: policy}, now)
			require.NoError(t, err)
			assert.Equal(t, 2, summary.Review, "only the repeated cookie needs review without the burst rule")
			assert.Zero(t, summary.Priority)
			var finding guard.MemberFinding
			require.NoError(t, db.Where("task_id = ? AND user_id = ?", "office-clues", 2).Take(&finding).Error)
			assert.Equal(t, 1, finding.Priority, "multiple network clues must not add up to identity evidence")
			assert.EqualValues(t, 500000, finding.RewardPaid)
			assert.Zero(t, finding.RewardPending, "manual wallet grants are not referral rewards")
			require.NoError(t, db.Model(&ledger.Settings{}).Where("id = ?", 1).Update("invite_burst_limit", 3).Error)
			riskSettings := guard.Defaults()
			riskSettings.AlertEnabled, riskSettings.AlertWebhook = true, "https://alerts.example/hook"
			_, err = guard.SaveSettings(db, riskSettings)
			require.NoError(t, err)
			for range 2 {
				summary, err = analyzeMembers(db, "office-rewards", memberAnalysisPayload{Policy: policy}, now)
				require.NoError(t, err)
			}
			assert.Equal(t, 6, summary.Review)
			assert.Equal(t, 4, summary.Priority, "inviter and all three invitees require reward review")
			finding = guard.MemberFinding{}
			require.NoError(t, db.Where("task_id = ? AND user_id = ?", "office-rewards", 1).Take(&finding).Error)
			assert.Equal(t, 3, finding.Priority)
			assert.EqualValues(t, 500000, finding.RewardPaid)
			assert.EqualValues(t, 1000000, finding.RewardPending)
			assert.Contains(t, finding.Signals, guard.MemberSignal{Code: "invite-burst", Count: 3, Threshold: 3, RelatedIDs: []int{4, 3, 2}})
			var alerts int64
			require.NoError(t, db.Model(&guard.Alert{}).Where("kind = ?", "member-analysis").Count(&alerts).Error)
			assert.EqualValues(t, 1, alerts, "scheduled and manual analyses share alert deduplication")
			policy.AlertPriority = 0
			_, err = analyzeMembers(db, "alerts-disabled", memberAnalysisPayload{Policy: policy}, now.Add(2*time.Hour))
			require.NoError(t, err)
			require.NoError(t, db.Model(&guard.Alert{}).Where("kind = ?", "member-analysis").Count(&alerts).Error)
			assert.EqualValues(t, 1, alerts)
			// Upgrade a representative released snapshot without the new fields.
			require.NoError(t, db.Migrator().DropIndex(&guard.MemberFinding{}, "idx_extension_registration_member_findings_priority"))
			for _, column := range []string{"Priority", "RewardPaid", "RewardPending", "Recommendation"} {
				require.NoError(t, db.Migrator().DropColumn(&guard.MemberFinding{}, column))
			}
			require.NoError(t, db.Create(&ledger.Signal{UserID: 6, Network: "original-network", Client: "original-client"}).Error)
			require.NoError(t, db.Migrator().DropIndex(&ledger.Signal{}, "idx_extension_referral_signals_browser"))
			require.NoError(t, db.Migrator().DropColumn(&ledger.Signal{}, "Browser"))
			for range 2 {
				require.NoError(t, ledger.Migrate(db))
				require.NoError(t, Migrate(db))
			}
			var signal ledger.Signal
			require.NoError(t, db.First(&signal, "user_id = ?", 6).Error)
			assert.NotEmpty(t, signal.Browser, "old signup cookies must participate in future reward checks")
			assert.Equal(t, "original-network", signal.Network)
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
				tx = SignupContext(tx, &guard.Decision{Event: guard.Event{DeviceHash: "office-browser-6"}})
				return ledger.Register(ledger.WithSignupContext(tx, "203.0.113.7", "different-browser-version"), 7, 1, now.Unix())
			}))
			var binding ledger.Binding
			require.NoError(t, db.First(&binding, "user_id = ?", 7).Error)
			assert.Equal(t, "review", binding.State)
			assert.Equal(t, "Shared registration browser requires review", binding.Reason)
			var profile guard.MemberProfile
			require.NoError(t, db.First(&profile, "user_id = ?", 6).Error)
			assert.Equal(t, "Preserve review note", profile.Note)
			finding = guard.MemberFinding{}
			require.NoError(t, db.Where("task_id = ? AND user_id = ?", "office-rewards", 1).Take(&finding).Error)
			assert.NotEmpty(t, finding.Signals)
			require.Error(t, db.Create(&guard.MemberFinding{TaskID: "office-rewards", UserID: 1}).Error)
			var users []model.User
			require.NoError(t, db.Find(&users).Error)
			for _, user := range users {
				assert.Equal(t, 500000, user.Quota)
				assert.Equal(t, common.UserStatusEnabled, user.Status)
			}
			policy.AutoAnalysis, policy.AnalysisMinutes = false, 90
			require.NoError(t, guard.SaveMemberPolicy(db, policy, 1, now))
			assert.False(t, memberAnalysisHandler{}.Enabled())
			assert.Equal(t, 90*time.Minute, memberAnalysisHandler{}.Interval())
		})
	}
}

func TestAssociatedInviterRewardsRequireExplicitApproval(t *testing.T) {
	db := riskDB(t, "sqlite")
	now := time.Now().Truncate(time.Second)
	for id := 1; id <= 3; id++ {
		user := model.User{Username: fmt.Sprintf("association-%d", id), AffCode: fmt.Sprintf("association-%d", id), Status: common.UserStatusEnabled, CreatedAt: now.Unix()}
		require.NoError(t, db.Create(&user).Error)
		browser := "shared-browser"
		if id == 2 {
			browser = "unique-invitee-browser"
		}
		require.NoError(t, ledger.Observe(ledger.WithSignupBrowser(db, browser), id, fmt.Sprintf("192.0.2.%d", id), "Browser"))
		require.NoError(t, db.Create(&guard.Account{UserID: id, DeviceHash: browser, CreatedAt: now.Unix(), State: "active"}).Error)
	}
	settings, err := ledger.GetSettings(db)
	require.NoError(t, err)
	settings.Enabled = true
	require.NoError(t, ledger.UpdateSettings(db, settings, 1))
	binding := ledger.Binding{UserID: 2, InviterID: 1, State: "active", RegisteredAt: now.Unix() - 172800, ExpiresAt: now.Unix() + 86400, SignupBonusQuota: 500, SignupBonusAvailableAt: now.Unix() - 86400}
	require.NoError(t, db.Create(&binding).Error)
	reward := ledger.Reward{UserID: 2, InviterID: 1, TradeNo: "associated-payment", Quota: 100, State: "pending", AvailableAt: now.Unix() - 86400}
	require.NoError(t, db.Create(&reward).Error)
	// A unique invitee browser cannot bypass an associated reward recipient.
	require.NoError(t, ledger.ReleaseSignupBonuses(db, now.Unix()))
	require.NoError(t, db.First(&binding, binding.ID).Error)
	assert.Equal(t, "review", binding.State)
	assert.Zero(t, binding.SignupBonusPaidAt)
	_, err = ledger.Claim(db, 1, reward.ID, now.Unix())
	assert.ErrorIs(t, err, ledger.ErrUnavailable)
	// Direct member claiming must perform the same fresh recipient check.
	require.NoError(t, db.Model(&binding).Update("state", "active").Error)
	_, err = ledger.Claim(db, 1, reward.ID, now.Unix())
	assert.ErrorIs(t, err, ledger.ErrUnavailable)
	// Analysis freezes existing bindings before cooling ends, in both directions.
	require.NoError(t, db.Model(&binding).Update("state", "active").Error)
	_, err = analyzeMembers(db, "hold-existing", memberAnalysisPayload{Policy: guard.DefaultMemberPolicy()}, now)
	require.NoError(t, err)
	require.NoError(t, db.First(&binding, binding.ID).Error)
	assert.Equal(t, "review", binding.State)
	groups, total, err := loadMemberGroups(db, "hold-existing", "review", 1)
	require.NoError(t, err)
	require.Equal(t, 1, total, "one associated group, not duplicate invitation cases")
	require.Len(t, groups[0].Members, 2)
	assert.Equal(t, []int{1, 3}, []int{groups[0].Members[0].ID, groups[0].Members[1].ID})
	require.Len(t, groups[0].Bindings, 1)
	assert.Equal(t, "association-2", groups[0].Bindings[0].Username)
	assert.Equal(t, "association-1", groups[0].Bindings[0].InviterName)
	assert.EqualValues(t, 100, groups[0].Bindings[0].Pending)
	encoded, err := common.Marshal(groups)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "shared-browser")
	assert.NotContains(t, string(encoded), "device_hash")
	// Evidence expiry and member notes are not financial approval.
	require.NoError(t, db.Model(&ledger.Signal{}).Where("user_id > 0").Update("browser", "").Error)
	require.NoError(t, guard.ReviewMember(db, 1, 1, 0, "cleared", "Checked member profile", now))
	require.NoError(t, ledger.ReleaseSignupBonuses(db, now.Add(365*24*time.Hour).Unix()))
	require.NoError(t, db.First(&binding, binding.ID).Error)
	assert.Equal(t, "review", binding.State)
	assert.Zero(t, binding.SignupBonusPaidAt)
	require.NoError(t, ledger.Review(db, binding.ID, 1, true, "Confirmed legitimate invitation"))
	require.NoError(t, ledger.ReleaseSignupBonuses(db, now.Unix()))
	count, err := ledger.Claim(db, 1, reward.ID, now.Unix())
	require.NoError(t, err)
	assert.Equal(t, 1, count)
	var account ledger.Account
	require.NoError(t, db.First(&account, "user_id = ?", 1).Error)
	assert.Equal(t, 600, account.Balance)
	_, err = analyzeMembers(db, "approved-rerun", memberAnalysisPayload{Policy: guard.DefaultMemberPolicy()}, now)
	require.NoError(t, err)
	groups, _, err = loadMemberGroups(db, "approved-rerun", "review", 1)
	require.NoError(t, err)
	require.Len(t, groups[0].Bindings, 1)
	assert.Equal(t, "active", groups[0].Bindings[0].State, "analysis cannot overwrite an explicit approval")
	assert.Positive(t, groups[0].Bindings[0].SignupBonusPaidAt)
	assert.Zero(t, groups[0].Bindings[0].Pending, "financial state is live")
	_, err = ledger.Claim(db, 1, reward.ID, now.Unix())
	assert.ErrorIs(t, err, ledger.ErrUnavailable)
	require.NoError(t, db.First(&account, "user_id = ?", 1).Error)
	assert.Equal(t, 600, account.Balance, "retries cannot pay twice")
}

func TestAPIRequestIPsRecordedWithoutMemberOptIn(t *testing.T) {
	db := riskDB(t, "sqlite")
	require.NoError(t, db.AutoMigrate(&model.Log{}))
	user := model.User{Username: "ip-log-member", Status: common.UserStatusEnabled}
	require.NoError(t, db.Create(&user).Error)
	oldConsume := common.LogConsumeEnabled
	common.LogConsumeEnabled = true
	t.Cleanup(func() { common.LogConsumeEnabled = oldConsume })
	c, engine := gin.CreateTestContext(httptest.NewRecorder())
	require.NoError(t, engine.SetTrustedProxies([]string{"10.0.0.0/8"}))
	c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	c.Request.RemoteAddr = "203.0.113.20:1234"
	c.Request.Header.Set("X-Forwarded-For", "192.0.2.99")
	c.Set("username", user.Username)
	model.RecordConsumeLog(c, user.Id, model.RecordConsumeLogParams{Other: model.NewLogOther()})
	model.RecordErrorLog(c, user.Id, 0, "model", "", "upstream failed", 0, 0, false, "", model.NewLogOther())
	var logs []model.Log
	require.NoError(t, db.Order("id").Find(&logs).Error)
	require.Len(t, logs, 2)
	for _, entry := range logs {
		assert.Equal(t, "203.0.113.20", entry.Ip)
	}
	c.Request.RemoteAddr = "10.0.0.2:1234"
	model.RecordConsumeLog(c, user.Id, model.RecordConsumeLogParams{Other: model.NewLogOther()})
	var proxied model.Log
	require.NoError(t, db.Order("id DESC").First(&proxied).Error)
	assert.Equal(t, "192.0.2.99", proxied.Ip, "only a trusted proxy can supply the forwarded client IP")
	visible, err := model.GetLogByTokenId(0)
	require.NoError(t, err)
	for _, entry := range visible {
		assert.Empty(t, entry.Ip, "member display preference must still be respected")
	}
	require.NoError(t, db.Model(&user).Update("setting", `{"record_ip_log":true}`).Error)
	visible, err = model.GetLogByTokenId(0)
	require.NoError(t, err)
	for _, entry := range visible {
		assert.NotEmpty(t, entry.Ip)
	}
	// Persist the original IP privately so background settlement has the same
	// evidence after a process restart, without leaking it through task DTOs.
	require.NoError(t, db.AutoMigrate(&model.Task{}))
	task := model.Task{TaskID: "ip-provenance", UserId: user.Id, PrivateData: model.TaskPrivateData{ClientIP: "203.0.113.44"}}
	require.NoError(t, db.Create(&task).Error)
	var loaded model.Task
	require.NoError(t, db.First(&loaded, task.ID).Error)
	assert.Equal(t, "203.0.113.44", loaded.PrivateData.ClientIP)
	public, err := common.Marshal(loaded)
	require.NoError(t, err)
	assert.NotContains(t, string(public), "203.0.113.44")
	model.RecordTaskBillingLog(model.RecordTaskBillingLogParams{UserId: user.Id, ClientIP: loaded.PrivateData.ClientIP})
	var settled model.Log
	require.NoError(t, db.Order("id DESC").First(&settled).Error)
	assert.Equal(t, "203.0.113.44", settled.Ip)
}

func TestMemberAnalysisTasksRetainCompletedResultsAndHidePrivateFields(t *testing.T) {
	db := riskDB(t, "sqlite")
	require.NoError(t, db.AutoMigrate(&model.SystemTask{}, &model.SystemTaskLock{}))
	user := model.User{Username: "member", Password: "private-hash", Email: "person@example.com", AccessToken: nil, Status: common.UserStatusEnabled}
	require.NoError(t, db.Create(&user).Error)
	p := guard.DefaultMemberPolicy()
	first, created, err := service.EnqueueSystemTask(memberTaskType, memberAnalysisPayload{ActorID: user.Id, Policy: p})
	require.NoError(t, err)
	assert.True(t, created)
	again, created, err := service.EnqueueSystemTask(memberTaskType, memberAnalysisPayload{ActorID: user.Id, Policy: p})
	require.NoError(t, err)
	assert.False(t, created)
	assert.Equal(t, first.TaskID, again.TaskID)
	task, claimed, err := model.ClaimSystemTask(first.ID, memberTaskType, "member-test", time.Now().Unix()+60)
	require.NoError(t, err)
	require.True(t, claimed)
	memberAnalysisHandler{}.Run(context.Background(), task, "member-test")
	finished, err := model.GetSystemTaskByTaskID(task.TaskID)
	require.NoError(t, err)
	require.Equal(t, model.SystemTaskStatusSucceeded, finished.Status)
	for _, status := range []model.SystemTaskStatus{model.SystemTaskStatusPending, model.SystemTaskStatusFailed} {
		if status == model.SystemTaskStatusPending {
			_, _, err = service.EnqueueSystemTask(memberTaskType, memberAnalysisPayload{ActorID: user.Id, Policy: p})
			require.NoError(t, err)
		} else {
			require.NoError(t, db.Model(&model.SystemTask{}).Where("status = ?", model.SystemTaskStatusPending).Updates(map[string]any{"status": status, "active_key": nil, "error": "private database diagnostics"}).Error)
		}
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("GET", "/?kind=all", nil)
		memberAnalysis(c)
		var result struct {
			Success bool
			Data    struct {
				Status model.SystemTaskStatus
				Total  int
				Items  []guard.MemberFinding
			}
		}
		require.NoError(t, common.Unmarshal(w.Body.Bytes(), &result))
		require.True(t, result.Success, w.Body.String())
		assert.Equal(t, status, result.Data.Status)
		assert.Equal(t, 1, result.Data.Total)
		require.Len(t, result.Data.Items, 1)
		assert.Equal(t, user.Id, result.Data.Items[0].UserID)
		assert.NotContains(t, w.Body.String(), "private database diagnostics")
	}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", fmt.Sprintf("/?user_id=%d", user.Id), nil)
	members(c)
	assert.NotContains(t, w.Body.String(), "private-hash")
	assert.NotContains(t, w.Body.String(), "password")
	assert.NotContains(t, w.Body.String(), "device_hash")
	assert.Contains(t, w.Body.String(), "person@example.com")
	last, _, err := service.EnqueueSystemTask(memberTaskType, memberAnalysisPayload{ActorID: user.Id, Policy: p})
	require.NoError(t, err)
	task, claimed, err = model.ClaimSystemTask(last.ID, memberTaskType, "member-test", time.Now().Unix()+60)
	require.NoError(t, err)
	require.True(t, claimed)
	memberAnalysisHandler{}.Run(context.Background(), task, "member-test")
	var oldCount int64
	require.NoError(t, db.Model(&guard.MemberFinding{}).Where("task_id = ?", first.TaskID).Count(&oldCount).Error)
	assert.Zero(t, oldCount, "publishing a successful snapshot prunes older completed results")
}
