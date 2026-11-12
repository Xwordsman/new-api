package registrationrisk

import (
	"bytes"
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
	for _, table := range []any{&guard.Secret{}, &guard.Counter{}, &guard.Challenge{}, &guard.Event{}, &guard.Account{}, &guard.Grant{}, &guard.Reservation{}, &guard.Alert{}, &guard.Audit{}, &guard.Payer{}, &ledger.Binding{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}, &model.SystemTask{}, &model.SystemTaskLock{}, &model.User{}, &model.Token{}, &model.Option{}} {
		require.NoError(t, db.Migrator().DropTable(table))
	}
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Token{}, &model.Option{}, &ledger.Binding{}))
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
