package referral

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/extensions/checkin/policy"
	"github.com/QuantumNous/new-api/extensions/referral/ledger"
	"github.com/QuantumNous/new-api/extensions/registrationrisk/guard"
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

const referralEpoch int64 = 1700000000

// The external dialects must point to these disposable databases, never a
// developer's existing installation. CI can require the entire matrix.
func referralTestDB(t *testing.T, dialect string) *gorm.DB {
	t.Helper()
	var dialector gorm.Dialector
	switch dialect {
	case "sqlite":
		dialector = sqlite.Open(":memory:")
	case "mysql":
		dsn := os.Getenv("REFERRAL_TEST_MYSQL_DSN")
		require.Contains(t, dsn, "/referral_ledger_test?")
		dialector = mysql.Open(dsn)
	case "postgres":
		dsn := os.Getenv("REFERRAL_TEST_POSTGRES_DSN")
		require.Contains(t, dsn, "/referral_ledger_test?")
		// Fixtures rebuild schemas in place; do not reuse plans from old columns.
		dialector = postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true})
	}
	db, err := gorm.Open(dialector, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	connection, err := db.DB()
	require.NoError(t, err)
	if dialect == "sqlite" {
		connection.SetMaxOpenConns(1)
	}
	t.Cleanup(func() { require.NoError(t, connection.Close()) })
	for _, table := range []any{&guard.MemberFinding{}, &guard.MemberProfile{}, &guard.Payer{}, &guard.Audit{}, &guard.Alert{}, &guard.Reservation{}, &guard.Grant{}, &guard.Account{}, &guard.Event{}, &guard.Challenge{}, &guard.Counter{}, &guard.Secret{}, &ledger.RefundNotice{}, &ledger.Audit{}, &ledger.Transfer{}, &ledger.Reward{}, &ledger.PaymentIdentity{}, &ledger.Signal{}, &ledger.Binding{}, &ledger.Account{}, &ledger.Settings{}, &model.Log{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}, &model.Option{}, &model.TopUp{}, &model.User{}} {
		require.NoError(t, db.Migrator().DropTable(table))
	}
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}, &model.Option{}, &model.TopUp{}))
	require.NoError(t, ledger.Migrate(db))
	require.NoError(t, ledger.Migrate(db))
	require.NoError(t, db.Model(&ledger.Settings{}).Where("id = ?", 1).Update("started_at", referralEpoch).Error)
	for id := 1; id <= 6; id++ {
		user := model.User{Username: fmt.Sprintf("referral-user-%d", id), Password: "unused-fixture-password", Status: common.UserStatusEnabled, Role: common.RoleCommonUser, Group: "default", AuthVersion: 1, AffCode: fmt.Sprintf("ref-%d", id), CreatedAt: referralEpoch}
		if id == 6 {
			user.Role = common.RoleRootUser
		}
		require.NoError(t, db.Create(&user).Error)
		require.Equal(t, id, user.Id)
	}
	return db
}

func referredUser(t *testing.T, db *gorm.DB, id int, network string, browser ...string) ledger.Binding {
	t.Helper()
	require.NoError(t, db.Model(&model.User{}).Where("id = ?", id).Update("inviter_id", 1).Error)
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
		marker := fmt.Sprintf("browser-%d", id)
		if len(browser) > 0 {
			marker = browser[0]
		}
		tx = ledger.WithSignupBrowser(tx, marker)
		return ledger.Register(ledger.WithSignupContext(tx, network, "referral-test-browser"), id, 1, referralEpoch)
	}))
	var binding ledger.Binding
	require.NoError(t, db.First(&binding, "user_id = ?", id).Error)
	return binding
}

func paidReferral(t *testing.T, db *gorm.DB, userID int, trade, amount string, paidAt int64) ledger.Reward {
	t.Helper()
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
		return ledger.RecordPayment(tx, userID, trade, "stripe", ledger.Payment{Amount: amount, Currency: "USD", Reference: trade, PaidAt: paidAt})
	}))
	var reward ledger.Reward
	require.NoError(t, db.First(&reward, "trade_no = ?", trade).Error)
	return reward
}

func referralAccount(t *testing.T, db *gorm.DB) ledger.Account {
	t.Helper()
	var account ledger.Account
	require.NoError(t, db.First(&account, "user_id = ?", 1).Error)
	return account
}

func TestReferralAccountingMatrix(t *testing.T) {
	dialects := []string{"sqlite"}
	for _, dialect := range []string{"mysql", "postgres"} {
		if os.Getenv("REFERRAL_TEST_"+strings.ToUpper(dialect)+"_DSN") != "" {
			dialects = append(dialects, dialect)
		} else if os.Getenv("REFERRAL_TEST_REQUIRE_MATRIX") == "1" {
			t.Fatalf("missing %s database for required matrix", dialect)
		}
	}
	for _, dialect := range dialects {
		t.Run(dialect, func(t *testing.T) {
			t.Run("CNY sale credits default to one to one and retain conversion snapshots", func(t *testing.T) {
				db := referralTestDB(t, dialect)
				for _, table := range []any{&policy.PaymentRefund{}, &policy.PaymentRecord{}, &policy.Audit{}, &policy.Account{}, &policy.Settings{}} {
					require.NoError(t, db.Migrator().DropTable(table))
				}
				require.NoError(t, policy.Migrate(db))
				require.NoError(t, policy.Migrate(db))
				referredUser(t, db, 2, "192.0.2.2")
				payment := ledger.Payment{Amount: "1", Currency: "CNY", Reference: "redemption:1", PaidAt: referralEpoch + 1}
				for range 2 {
					require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
						if err := policy.RecordRedemptionPayment(tx, 2, payment.Reference, "redemption", payment); err != nil {
							return err
						}
						return ledger.RecordPayment(tx, 2, payment.Reference, "redemption", payment)
					}))
				}
				var reward ledger.Reward
				require.NoError(t, db.First(&reward, "trade_no = ?", payment.Reference).Error)
				assert.Equal(t, 500000, reward.PaidQuota)
				assert.Equal(t, 25000, reward.Quota)
				assert.Equal(t, "1", reward.ExchangeRate)
				var eligibilityPayment policy.PaymentRecord
				require.NoError(t, db.First(&eligibilityPayment, "trade_no = ?", payment.Reference).Error)
				assert.Equal(t, "1", eligibilityPayment.CNYPerUSD)
				assert.Equal(t, "1", eligibilityPayment.USDPerUnit)
				settings, err := policy.GetSettings(db)
				require.NoError(t, err)
				for _, currency := range []string{"CNY", "USD"} {
					settings.Currency, settings.ThresholdAmount = currency, "1"
					summary, err := policy.PaymentSummary(db, 2, settings, time.Unix(referralEpoch+2, 0))
					require.NoError(t, err)
					assert.Equal(t, "1", summary.QualifiedAmount.String())
					assert.True(t, summary.Eligible)
				}
				// Administrators can choose a different business conversion. Startup
				// preserves that setting, and old orders keep their original snapshot.
				referralSettings, err := ledger.GetSettings(db)
				require.NoError(t, err)
				referralSettings.CNYPerUSD = "2"
				require.NoError(t, ledger.UpdateSettings(db, referralSettings, 6))
				settings.CNYPerUSD = "2"
				_, err = policy.UpdateSettings(db, settings, 6)
				require.NoError(t, err)
				require.NoError(t, ledger.Migrate(db))
				require.NoError(t, policy.Migrate(db))
				referralSettings, err = ledger.GetSettings(db)
				require.NoError(t, err)
				assert.Equal(t, "2", referralSettings.CNYPerUSD)
				settings, err = policy.GetSettings(db)
				require.NoError(t, err)
				assert.Equal(t, "2", settings.CNYPerUSD)
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
					if err := policy.RecordRedemptionPayment(tx, 2, payment.Reference, "redemption", payment); err != nil {
						return err
					}
					return ledger.RecordPayment(tx, 2, payment.Reference, "redemption", payment)
				}))
				require.NoError(t, db.First(&reward, reward.ID).Error)
				assert.Equal(t, 500000, reward.PaidQuota)
				assert.Equal(t, 25000, reward.Quota)
				require.NoError(t, db.First(&eligibilityPayment, eligibilityPayment.ID).Error)
				assert.Equal(t, "1", eligibilityPayment.USDPerUnit)
				assert.Zero(t, referralAccount(t, db).Balance, "unclaimed rewards never credit the wallet")
			})
			t.Run("snapshots cap deduplication cooling and window boundaries", func(t *testing.T) {
				db := referralTestDB(t, dialect)
				binding := referredUser(t, db, 2, "192.0.2.2")
				settings, err := ledger.GetSettings(db)
				require.NoError(t, err)
				settings.RateBPS, settings.WindowDays, settings.CoolingHours, settings.CapQuota = 700, 45, 12, 150*500000
				require.NoError(t, ledger.UpdateSettings(db, settings, 6))
				assert.ErrorIs(t, ledger.UpdateSettings(db, settings, 6), ledger.ErrInvalid)
				newBinding := referredUser(t, db, 3, "192.0.2.3")
				assert.Equal(t, 700, newBinding.RateBPS)
				assert.Equal(t, referralEpoch+45*86400, newBinding.ExpiresAt)
				assert.Equal(t, 12, newBinding.CoolingHours)
				reward := paidReferral(t, db, 2, "capped", "4000", referralEpoch+1)
				assert.Equal(t, 100*500000, reward.Quota)
				assert.Equal(t, 500, reward.RateBPS)
				paidReferral(t, db, 2, "capped", "4000", referralEpoch+1)
				var count int64
				require.NoError(t, db.Model(&ledger.Reward{}).Count(&count).Error)
				assert.EqualValues(t, 1, count)
				_, err = ledger.Claim(db, 1, reward.ID, reward.AvailableAt-1)
				assert.ErrorIs(t, err, ledger.ErrUnavailable)
				_, err = ledger.Claim(db, 4, reward.ID, reward.AvailableAt)
				assert.ErrorIs(t, err, ledger.ErrUnavailable)
				n, err := ledger.Claim(db, 1, reward.ID, reward.AvailableAt)
				require.NoError(t, err)
				assert.Equal(t, 1, n)
				_, err = ledger.Claim(db, 1, reward.ID, reward.AvailableAt)
				assert.ErrorIs(t, err, ledger.ErrUnavailable)
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
					return ledger.RecordPayment(tx, 2, "expired", "stripe", ledger.Payment{Amount: "100", Currency: "USD", PaidAt: binding.ExpiresAt})
				}))
				require.NoError(t, db.Model(&ledger.Reward{}).Where("trade_no = ?", "expired").Count(&count).Error)
				assert.Zero(t, count)
			})
			t.Run("partial capped refund uses net payment and never reopens cap", func(t *testing.T) {
				db := referralTestDB(t, dialect)
				referredUser(t, db, 2, "192.0.2.2")
				reward := paidReferral(t, db, 2, "partial", "4000", referralEpoch+1)
				require.NoError(t, ledger.Refund(db, "stripe", "partial", "2000", "USD"))
				require.NoError(t, db.First(&reward, reward.ID).Error)
				assert.Zero(t, reward.Reversed, "$2000 net payment still earns the full $100 cap")
				require.NoError(t, ledger.Refund(db, "stripe", "partial", "3000", "USD"))
				require.NoError(t, db.First(&reward, reward.ID).Error)
				assert.Equal(t, 50*500000, reward.Reversed)
				require.NoError(t, ledger.Refund(db, "stripe", "partial", "1000", "USD"))
				later := paidReferral(t, db, 2, "after-refund", "1000", referralEpoch+2)
				assert.Zero(t, later.Quota)
				_, err := ledger.Claim(db, 1, reward.ID, reward.AvailableAt)
				require.NoError(t, err)
				assert.Equal(t, 50*500000, referralAccount(t, db).Balance)
			})
			t.Run("claimed refund creates debt without wallet debit and future earnings offset it", func(t *testing.T) {
				db := referralTestDB(t, dialect)
				referredUser(t, db, 2, "192.0.2.2")
				reward := paidReferral(t, db, 2, "refund-debt", "100", referralEpoch+1)
				_, err := ledger.Claim(db, 1, reward.ID, reward.AvailableAt)
				require.NoError(t, err)
				_, replayed, err := ledger.TransferBalance(db, 1, "debt-transfer-request", reward.Quota, reward.AvailableAt)
				require.NoError(t, err)
				assert.False(t, replayed)
				require.NoError(t, ledger.Refund(db, "stripe", "refund-debt", "100", "USD"))
				require.NoError(t, ledger.Refund(db, "stripe", "refund-debt", "100", "USD"))
				account := referralAccount(t, db)
				assert.Equal(t, 5*500000, account.Debt)
				assert.Zero(t, account.Balance)
				var user model.User
				require.NoError(t, db.First(&user, 1).Error)
				assert.Equal(t, 5*500000, user.Quota)
				later := paidReferral(t, db, 2, "offset-debt", "200", referralEpoch+2)
				_, err = ledger.Claim(db, 1, later.ID, later.AvailableAt)
				require.NoError(t, err)
				account = referralAccount(t, db)
				assert.Zero(t, account.Debt)
				assert.Equal(t, 5*500000, account.Balance)
			})
			t.Run("refund before payment and unsupported currency reconciliation", func(t *testing.T) {
				db := referralTestDB(t, dialect)
				referredUser(t, db, 2, "192.0.2.2")
				require.NoError(t, ledger.Refund(db, "stripe", "early-refund", "50", "USD"))
				reward := paidReferral(t, db, 2, "early-refund", "100", referralEpoch+1)
				assert.Equal(t, 1250000, reward.Reversed)
				payment := ledger.Payment{Amount: "100", Currency: "EUR", Reference: "fx", PaidAt: referralEpoch + 2}
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return ledger.RecordPayment(tx, 2, "fx", "stripe", payment) }))
				require.NoError(t, db.Where("trade_no = ?", "fx").First(&ledger.Reward{}).Error)
				payment.USDPerUnit = "1.1"
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return ledger.RecordPayment(tx, 2, "fx", "stripe", payment) }))
				var priced ledger.Reward
				require.NoError(t, db.Where("trade_no = ?", "fx").First(&priced).Error)
				assert.Equal(t, 2750000, priced.Quota)
				assert.Equal(t, "pending", priced.State)
			})
			t.Run("audited refunds enforce bounds and roll back shared eligibility notices", func(t *testing.T) {
				db := referralTestDB(t, dialect)
				for _, table := range []any{&policy.PaymentRefund{}, &policy.PaymentRecord{}, &policy.Audit{}, &policy.Account{}, &policy.Settings{}} {
					require.NoError(t, db.Migrator().DropTable(table))
				}
				require.NoError(t, policy.Migrate(db))
				oldDB, oldPayment, oldRefund := model.DB, model.ReferralPaymentHook, model.CheckinRefundHook
				model.DB, model.ReferralPaymentHook, model.CheckinRefundHook = db, ledger.RecordPayment, policy.Refund
				t.Cleanup(func() {
					model.DB, model.ReferralPaymentHook, model.CheckinRefundHook = oldDB, oldPayment, oldRefund
				})
				referredUser(t, db, 2, "192.0.2.2")
				reward := paidReferral(t, db, 2, "manual-refund", "100", referralEpoch+1)
				reason := strings.Repeat("退", 500)
				require.ErrorIs(t, ledger.AuditRefund(db, reward.TradeNo, "1", reason, 0), ledger.ErrInvalid)
				gin.SetMode(gin.TestMode)
				router := gin.New()
				router.POST("/refund", func(c *gin.Context) {
					c.Set("id", 6)
					refund(c)
				})
				for _, test := range []struct {
					name, amount   string
					success        bool
					noticeCount    int64
					refundedAmount string
					reversedQuota  int
					auditCount     int64
				}{
					{"overpayment before eligibility ledger", "100.01", false, 0, "0", 0, 0},
					{"valid audited refund", "30", true, 1, "30", 750000, 1},
					{"retry preserves cumulative refund", "30", true, 1, "30", 750000, 2},
					{"decreased manual refund", "20", false, 1, "30", 750000, 2},
					{"overpayment after valid refund", "101", false, 1, "30", 750000, 2},
				} {
					t.Run(test.name, func(t *testing.T) {
						body := common.GetJsonString(map[string]any{"trade_no": reward.TradeNo, "amount": test.amount, "reason": "  " + reason + "  "})
						request := httptest.NewRequest(http.MethodPost, "/refund", strings.NewReader(body))
						request.Header.Set("Content-Type", "application/json")
						response := httptest.NewRecorder()
						router.ServeHTTP(response, request)
						var result struct {
							Success bool `json:"success"`
						}
						require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
						assert.Equal(t, test.success, result.Success)
						var notices int64
						require.NoError(t, db.Model(&policy.PaymentRefund{}).Count(&notices).Error)
						assert.Equal(t, test.noticeCount, notices, "failed manual refunds must roll back derived eligibility notices")
						var notice ledger.RefundNotice
						require.NoError(t, db.Where("provider = ? AND reference = ?", "stripe", reward.TradeNo).First(&notice).Error)
						assert.Equal(t, test.refundedAmount, notice.Amount)
						require.NoError(t, db.First(&reward, reward.ID).Error)
						assert.Equal(t, test.reversedQuota, reward.Reversed, "failed manual refunds must roll back referral reward reversals")
						var audits int64
						require.NoError(t, db.Model(&ledger.Audit{}).Where("action = ?", "refund").Count(&audits).Error)
						assert.Equal(t, test.auditCount, audits)
					})
				}
				// A valid early refund is retained even without an eligibility payment;
				// a later verified cash payment must immediately reflect that refund.
				require.NoError(t, policy.RecordPayment(db, 2, reward.TradeNo, "stripe", ledger.Payment{
					Amount: "100", Currency: "USD", Reference: reward.TradeNo, PaidAt: referralEpoch + 1,
				}))
				var payment policy.PaymentRecord
				require.NoError(t, db.Where("trade_no = ?", reward.TradeNo).First(&payment).Error)
				assert.Equal(t, "30", payment.RefundedAmount)
				require.NoError(t, db.First(&reward, reward.ID).Error)
				assert.Equal(t, 750000, reward.Reversed)
				t.Run("rejected refund rolls back both recorded ledgers", func(t *testing.T) {
					body := common.GetJsonString(map[string]any{"trade_no": reward.TradeNo, "amount": "101", "reason": reason})
					request := httptest.NewRequest(http.MethodPost, "/refund", strings.NewReader(body))
					request.Header.Set("Content-Type", "application/json")
					response := httptest.NewRecorder()
					router.ServeHTTP(response, request)
					var result struct {
						Success bool `json:"success"`
					}
					require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
					assert.False(t, result.Success)
					require.NoError(t, db.First(&payment, payment.ID).Error)
					assert.Equal(t, "30", payment.RefundedAmount)
					var eligibilityNotice policy.PaymentRefund
					require.NoError(t, db.Where("provider = ? AND reference = ?", "stripe", reward.TradeNo).First(&eligibilityNotice).Error)
					assert.Equal(t, "30", eligibilityNotice.Amount)
					var referralNotice ledger.RefundNotice
					require.NoError(t, db.Where("provider = ? AND reference = ?", "stripe", reward.TradeNo).First(&referralNotice).Error)
					assert.Equal(t, "30", referralNotice.Amount)
					require.NoError(t, db.First(&reward, reward.ID).Error)
					assert.Equal(t, 750000, reward.Reversed)
					var audits int64
					require.NoError(t, db.Model(&ledger.Audit{}).Where("action = ?", "refund").Count(&audits).Error)
					assert.EqualValues(t, 2, audits)
				})
			})
			t.Run("shared registration and verified payer require review including nonreferred payers", func(t *testing.T) {
				db := referralTestDB(t, dialect)
				referredUser(t, db, 2, "192.0.2.2", "shared-browser")
				binding := referredUser(t, db, 3, "192.0.2.3", "shared-browser")
				assert.Equal(t, "review", binding.State)
				reward := paidReferral(t, db, 3, "network", "100", referralEpoch+1)
				_, err := ledger.Claim(db, 1, reward.ID, reward.AvailableAt)
				assert.ErrorIs(t, err, ledger.ErrUnavailable)
				require.NoError(t, ledger.Review(db, binding.ID, 6, true, "Separate legitimate team members"))
				_, err = ledger.Claim(db, 1, reward.ID, reward.AvailableAt)
				require.NoError(t, err)
				for _, id := range []int{1, 2} {
					payment := ledger.Payment{Amount: "100", Currency: "USD", Reference: fmt.Sprintf("payer-%d", id), Payer: "same-verified-payer", PaidAt: referralEpoch + 2}
					require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
						return ledger.RecordPayment(tx, id, fmt.Sprintf("payer-%d", id), "stripe", payment)
					}))
				}
				binding = ledger.Binding{}
				require.NoError(t, db.Where("user_id = ?", 2).First(&binding).Error)
				assert.Equal(t, "review", binding.State)
				assert.Equal(t, "Shared payment account requires review", binding.Reason)
			})
			t.Run("claim rechecks account and pause preserves transfers", func(t *testing.T) {
				db := referralTestDB(t, dialect)
				referredUser(t, db, 2, "192.0.2.2")
				reward := paidReferral(t, db, 2, "disabled", "100", referralEpoch+1)
				require.NoError(t, db.Model(&model.User{}).Where("id = ?", 2).Update("status", common.UserStatusDisabled).Error)
				_, err := ledger.Claim(db, 1, reward.ID, reward.AvailableAt)
				assert.ErrorIs(t, err, ledger.ErrUnavailable)
				require.NoError(t, db.Model(&ledger.Account{}).Where("user_id = ?", 1).Update("balance", 100).Error)
				settings, err := ledger.GetSettings(db)
				require.NoError(t, err)
				settings.Enabled = false
				require.NoError(t, ledger.UpdateSettings(db, settings, 6))
				_, err = ledger.Claim(db, 1, reward.ID, reward.AvailableAt)
				assert.ErrorIs(t, err, ledger.ErrUnavailable)
				_, _, err = ledger.TransferBalance(db, 1, "paused-transfer-request", 100, referralEpoch)
				require.NoError(t, err)
			})
			t.Run("concurrent claims and transfer retries credit exactly once", func(t *testing.T) {
				db := referralTestDB(t, dialect)
				referredUser(t, db, 2, "192.0.2.2")
				reward := paidReferral(t, db, 2, "concurrent", "100", referralEpoch+1)
				var wg sync.WaitGroup
				claims := make(chan error, 2)
				for range 2 {
					wg.Go(func() { _, err := ledger.Claim(db, 1, reward.ID, reward.AvailableAt); claims <- err })
				}
				wg.Wait()
				close(claims)
				for err := range claims {
					if err != nil {
						assert.ErrorIs(t, err, ledger.ErrUnavailable)
					}
				}
				assert.Equal(t, reward.Quota, referralAccount(t, db).Balance)
				results := make(chan error, 2)
				for range 2 {
					wg.Go(func() {
						_, _, err := ledger.TransferBalance(db, 1, "same-transfer-request", reward.Quota, referralEpoch)
						results <- err
					})
				}
				wg.Wait()
				close(results)
				for err := range results {
					require.NoError(t, err)
				}
				var user model.User
				require.NoError(t, db.First(&user, 1).Error)
				assert.Equal(t, reward.Quota, user.Quota)
				assert.Zero(t, referralAccount(t, db).Balance)
				_, _, err := ledger.TransferBalance(db, 1, "same-transfer-request", 1, referralEpoch)
				assert.ErrorIs(t, err, ledger.ErrInvalid, "an idempotency key is bound to its original amount")
				_, _, err = ledger.TransferBalance(db, 1, "different-request-id", 1, referralEpoch)
				assert.ErrorIs(t, err, ledger.ErrUnavailable)
				require.NoError(t, db.Model(&ledger.Account{}).Where("user_id = ?", 1).Update("balance", 100).Error)
				require.NoError(t, db.Model(&model.User{}).Where("id = ?", 1).Update("quota", common.MaxWalletQuota).Error)
				_, _, err = ledger.TransferBalance(db, 1, "wallet-bound-request", 100, referralEpoch)
				assert.ErrorIs(t, err, ledger.ErrUnavailable)
				assert.Equal(t, 100, referralAccount(t, db).Balance)
			})
			t.Run("zero rewards cannot block the next eligible claim batch", func(t *testing.T) {
				db := referralTestDB(t, dialect)
				referredUser(t, db, 2, "192.0.2.2")
				// One full batch of exhausted-cap orders precedes an eligible
				// order from another friend. None may starve that next reward.
				rows := make([]ledger.Reward, 200)
				for i := range rows {
					rows[i] = ledger.Reward{TradeNo: fmt.Sprintf("no-reward-%d", i), InviterID: 1, UserID: 2, State: "pending", AvailableAt: referralEpoch}
				}
				require.NoError(t, db.Create(&rows).Error)
				referredUser(t, db, 3, "192.0.2.3")
				reward := paidReferral(t, db, 3, "next-eligible", "100", referralEpoch+1)
				claimed, err := ledger.Claim(db, 1, 0, reward.AvailableAt)
				require.NoError(t, err)
				assert.Equal(t, 1, claimed)
				assert.Equal(t, reward.Quota, referralAccount(t, db).Balance)
			})
			t.Run("runtime hooks join signup and recharge transactions on every node", func(t *testing.T) {
				db := referralTestDB(t, dialect)
				require.NoError(t, db.AutoMigrate(&model.Log{}))
				oldDB, oldLog := model.DB, model.LOG_DB
				oldMainType, oldLogType, oldRedis := common.MainDatabaseType(), common.LogDatabaseType(), common.RedisEnabled
				oldSignup, oldPayment, oldTransfer := model.ReferralRegistrationHook, model.ReferralPaymentHook, model.ReferralTransferHook
				oldCompleted := model.ReferralSignupCompletedHook
				oldSignupQuota := common.QuotaForNewUser
				t.Cleanup(func() {
					model.DB, model.LOG_DB = oldDB, oldLog
					common.SetDatabaseTypes(oldMainType, oldLogType)
					common.RedisEnabled, common.QuotaForNewUser = oldRedis, oldSignupQuota
					model.ReferralRegistrationHook, model.ReferralPaymentHook, model.ReferralTransferHook = oldSignup, oldPayment, oldTransfer
					model.ReferralSignupCompletedHook = oldCompleted
				})
				model.DB, model.LOG_DB = db, db
				common.SetDatabaseTypes(common.DatabaseType(dialect), common.DatabaseType(dialect))
				common.RedisEnabled, common.QuotaForNewUser = false, 321
				model.ReferralRegistrationHook, model.ReferralPaymentHook, model.ReferralTransferHook = nil, nil, nil
				// Slave startup skips migrations but must still install hooks.
				Initialize(db)
				settings, err := ledger.GetSettings(db)
				require.NoError(t, err)
				settings.SignupBonusEnabled, settings.SignupBonusQuota = true, 500000
				require.NoError(t, ledger.UpdateSettings(db, settings, 6))
				require.NotNil(t, model.ReferralTransferHook)
				user := model.User{Username: "host-invitee", Status: common.UserStatusEnabled, Group: "default", CreatedAt: referralEpoch + 1}
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
					return user.InsertWithTx(ledger.WithSignupContext(tx, "192.0.2.20", "host-signup"), 1)
				}))
				var binding ledger.Binding
				require.NoError(t, db.First(&binding, "user_id = ?", user.Id).Error)
				assert.Equal(t, "active", binding.State)
				assert.Equal(t, 321, user.Quota, "normal signup gifts are retained")
				assert.Equal(t, 500000, referralAccount(t, db).Balance, "fixed invitation reward is automatic")
				abort := fmt.Errorf("abort signup")
				rolledBack := model.User{Username: "rolled-back-signup", Status: common.UserStatusEnabled, CreatedAt: referralEpoch + 1}
				require.ErrorIs(t, db.Transaction(func(tx *gorm.DB) error {
					if err := rolledBack.InsertWithTx(ledger.WithSignupContext(tx, "192.0.2.21", "host-signup"), 1); err != nil {
						return err
					}
					return abort
				}), abort)
				var count int64
				require.NoError(t, db.Model(&ledger.Binding{}).Where("user_id = ?", rolledBack.Id).Count(&count).Error)
				assert.Zero(t, count)
				assert.Equal(t, 500000, referralAccount(t, db).Balance, "failed signup cannot leave an invitation reward")
				// Registration risk must hold the bonus before the final signup hook.
				require.NoError(t, guard.Migrate(db))
				event := guard.Event{Stage: "register", Action: "review", Enforced: true}
				require.NoError(t, db.Create(&event).Error)
				risky := model.User{Username: "risk-held-invitee", Status: common.UserStatusEnabled, CreatedAt: referralEpoch + 1}
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
					tx = ledger.WithSignupContext(tx, "192.0.2.22", "host-signup")
					tx = guard.WithDecision(tx, &guard.Decision{Event: event, Settings: guard.Settings{HoldReferral: true}})
					return risky.InsertWithTx(tx, 1)
				}))
				var held ledger.Binding
				require.NoError(t, db.First(&held, "user_id = ?", risky.Id).Error)
				assert.Equal(t, "review", held.State)
				assert.Zero(t, held.SignupBonusPaidAt)
				assert.Equal(t, 500000, referralAccount(t, db).Balance)
				response := httptest.NewRecorder()
				context, _ := gin.CreateTestContext(response)
				context.Set("id", 1)
				dashboard(context)
				var summary struct {
					Success bool
					Data    struct{ Pending, Review, Claimable int }
				}
				require.NoError(t, common.Unmarshal(response.Body.Bytes(), &summary))
				require.True(t, summary.Success)
				assert.Equal(t, 500000, summary.Data.Pending, "held gifts are visible to the inviter")
				assert.Equal(t, 500000, summary.Data.Review)
				assert.Zero(t, summary.Data.Claimable, "risk-held gifts cannot be claimed")
				require.NoError(t, ledger.Review(db, held.ID, 6, true, "Verified real invited user"))
				require.NoError(t, ledger.Review(db, held.ID, 6, true, "Repeated review approval"))
				assert.Equal(t, 1000000, referralAccount(t, db).Balance)
				order := model.TopUp{UserId: user.Id, TradeNo: "host-recharge", Money: 200, Amount: 100, PaymentProvider: model.PaymentProviderStripe, PaymentMethod: model.PaymentMethodStripe, Status: common.TopUpStatusPending}
				require.NoError(t, db.Create(&order).Error)
				payment := ledger.Payment{Amount: "100", Currency: "USD", Reference: "host-payment", Payer: "host-payer", PaidAt: referralEpoch + 2}
				require.NoError(t, model.Recharge(order.TradeNo, "", "192.0.2.20", payment))
				require.NoError(t, model.Recharge(order.TradeNo, "", "192.0.2.20", payment))
				var reward ledger.Reward
				require.NoError(t, db.First(&reward, "trade_no = ?", order.TradeNo).Error)
				assert.Equal(t, 5*500000, reward.Quota, "reward uses actual $100, excluding the promotional credit")
				require.NoError(t, db.First(&user, user.Id).Error)
				assert.Equal(t, 200*500000+321, user.Quota, "callback replay credits the wallet only once")
				require.NoError(t, db.Model(&model.User{}).Where("id = ?", user.Id).Update("quota", common.MaxWalletQuota).Error)
				order.Id, order.TradeNo, order.Status = 0, "host-wallet-full", common.TopUpStatusPending
				require.NoError(t, db.Create(&order).Error)
				payment.Reference, payment.Payer = "rollback-payment", "rollback-payer"
				require.Error(t, model.Recharge(order.TradeNo, "", "192.0.2.20", payment))
				require.NoError(t, db.First(&order, order.Id).Error)
				assert.Equal(t, common.TopUpStatusPending, order.Status)
				require.NoError(t, db.Model(&ledger.Reward{}).Where("trade_no = ?", order.TradeNo).Count(&count).Error)
				assert.Zero(t, count, "failed wallet credit cannot leave a referral reward")
				require.NoError(t, db.First(&binding, binding.ID).Error)
				assert.Equal(t, reward.Quota, binding.Reserved, "failed callback cannot consume the invitee cap")
			})
			t.Run("signup bonus snapshots replay isolation and paid rewards remain independent", func(t *testing.T) {
				db := referralTestDB(t, dialect)
				settings, err := ledger.GetSettings(db)
				require.NoError(t, err)
				settings.SignupBonusEnabled, settings.SignupBonusQuota = true, 500000
				require.NoError(t, ledger.UpdateSettings(db, settings, 6))
				binding := referredUser(t, db, 2, "192.0.2.2")
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return ledger.CompleteSignup(tx, 2) }))
				require.NoError(t, ledger.Register(db, 2, 1, referralEpoch))
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return ledger.CompleteSignup(tx, 2) }))
				assert.Equal(t, 500000, referralAccount(t, db).Balance)
				assert.Equal(t, 500000, referralAccount(t, db).Earned)
				var count int64
				require.NoError(t, db.Model(&ledger.Audit{}).Where("action = ?", "signup_bonus").Count(&count).Error)
				assert.EqualValues(t, 1, count)
				require.NoError(t, db.Model(&model.TopUp{}).Count(&count).Error)
				assert.Zero(t, count, "gifts never become paid top-ups")
				require.NoError(t, db.Model(&ledger.Reward{}).Count(&count).Error)
				assert.Zero(t, count, "gifts never generate percentage commissions")
				// A repeated browser marker waits for review and retains its original amount.
				held := referredUser(t, db, 3, "192.0.2.3", "browser-2")
				assert.Equal(t, "review", held.State)
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return ledger.CompleteSignup(tx, 3) }))
				settings, err = ledger.GetSettings(db)
				require.NoError(t, err)
				settings.SignupBonusQuota = 1000000
				require.NoError(t, ledger.UpdateSettings(db, settings, 6))
				require.NoError(t, ledger.Review(db, held.ID, 6, false, "Duplicate account suspected"))
				assert.Equal(t, 500000, referralAccount(t, db).Balance)
				require.NoError(t, ledger.Review(db, held.ID, 6, true, "Independent account confirmed"))
				assert.Equal(t, 1000000, referralAccount(t, db).Balance)
				// Fixed bonuses do not consume the payment commission cap.
				reward := paidReferral(t, db, 2, "bonus-independent-cap", "4000", referralEpoch+1)
				assert.Equal(t, binding.CapQuota, reward.Quota)
				require.NoError(t, db.First(&binding, binding.ID).Error)
				assert.Positive(t, binding.SignupBonusPaidAt)
				assert.Equal(t, reward.Quota, binding.Reserved)
			})
			t.Run("disabled historical invalid and imported invitations receive no signup bonus", func(t *testing.T) {
				db := referralTestDB(t, dialect)
				disabled := referredUser(t, db, 2, "192.0.2.2")
				assert.Zero(t, disabled.SignupBonusQuota)
				settings, err := ledger.GetSettings(db)
				require.NoError(t, err)
				settings.SignupBonusEnabled, settings.SignupBonusQuota = true, 500000
				require.NoError(t, ledger.UpdateSettings(db, settings, 6))
				require.NoError(t, ledger.Register(db, 3, 1, referralEpoch-1))
				require.NoError(t, db.Model(&model.User{}).Where("id = ?", 4).Updates(map[string]any{"inviter_id": 1, "created_at": referralEpoch + 1}).Error)
				require.NoError(t, ledger.ImportHistory(db, 1))
				var imported ledger.Binding
				require.NoError(t, db.First(&imported, "user_id = ?", 4).Error)
				assert.Zero(t, imported.SignupBonusQuota, "imported users cannot receive a retroactive signup gift")
				for _, id := range []int{2, 3, 4} {
					var binding ledger.Binding
					require.NoError(t, db.First(&binding, "user_id = ?", id).Error)
					require.NoError(t, ledger.Review(db, binding.ID, 6, true, "Verified existing invitation"))
					require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return ledger.CompleteSignup(tx, id) }))
				}
				require.NoError(t, ledger.Register(db, 1, 1, referralEpoch))
				require.NoError(t, ledger.Register(db, 5, 0, referralEpoch))
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return ledger.CompleteSignup(tx, 5) }))
				assert.Zero(t, referralAccount(t, db).Balance)
				settings, err = ledger.GetSettings(db)
				require.NoError(t, err)
				settings.SignupBonusQuota = -1
				assert.ErrorIs(t, ledger.UpdateSettings(db, settings, 6), ledger.ErrInvalid)
				settings.SignupBonusQuota = 0
				assert.ErrorIs(t, ledger.UpdateSettings(db, settings, 6), ledger.ErrInvalid)
			})
			t.Run("full referral account holds signup bonus and debt offsets the gift", func(t *testing.T) {
				db := referralTestDB(t, dialect)
				settings, err := ledger.GetSettings(db)
				require.NoError(t, err)
				settings.SignupBonusEnabled, settings.SignupBonusQuota = true, 500000
				require.NoError(t, ledger.UpdateSettings(db, settings, 6))
				require.NoError(t, db.Create(&ledger.Account{UserID: 1, Balance: common.MaxWalletQuota}).Error)
				binding := referredUser(t, db, 2, "192.0.2.2")
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return ledger.CompleteSignup(tx, 2) }))
				require.NoError(t, db.First(&binding, binding.ID).Error)
				assert.Equal(t, "review", binding.State)
				assert.Zero(t, binding.SignupBonusPaidAt)
				require.NoError(t, db.Model(&ledger.Account{}).Where("user_id = ?", 1).Updates(map[string]any{"balance": 0, "debt": 200000}).Error)
				require.NoError(t, ledger.Review(db, binding.ID, 6, true, "Balance capacity restored"))
				account := referralAccount(t, db)
				assert.Equal(t, 300000, account.Balance)
				assert.Zero(t, account.Debt)
				assert.Equal(t, 500000, account.Earned)
			})
			t.Run("concurrent review approvals credit the signup bonus once", func(t *testing.T) {
				db := referralTestDB(t, dialect)
				settings, err := ledger.GetSettings(db)
				require.NoError(t, err)
				settings.SignupBonusEnabled, settings.SignupBonusQuota = true, 500000
				require.NoError(t, ledger.UpdateSettings(db, settings, 6))
				// Missing registration signals require approval.
				require.NoError(t, ledger.Register(db, 2, 1, referralEpoch))
				var binding ledger.Binding
				require.NoError(t, db.First(&binding, "user_id = ?", 2).Error)
				assert.Equal(t, "review", binding.State)
				var wg sync.WaitGroup
				results := make(chan error, 2)
				for range 2 {
					wg.Go(func() { results <- ledger.Review(db, binding.ID, 6, true, "Verified invitation approval") })
				}
				wg.Wait()
				close(results)
				for err := range results {
					require.NoError(t, err)
				}
				assert.Equal(t, 500000, referralAccount(t, db).Balance)
			})
			t.Run("signup cooling snapshots and retries preserve one gift without recharge", func(t *testing.T) {
				db := referralTestDB(t, dialect)
				settings, err := ledger.GetSettings(db)
				require.NoError(t, err)
				settings.SignupBonusEnabled, settings.SignupBonusQuota = true, 500000
				require.NoError(t, ledger.UpdateSettings(db, settings, 6))
				binding := referredUser(t, db, 2, "192.0.2.2")
				assert.Equal(t, referralEpoch+86400, binding.SignupBonusAvailableAt)
				require.NoError(t, ledger.ReleaseSignupBonuses(db, binding.SignupBonusAvailableAt-1))
				assert.Zero(t, referralAccount(t, db).Balance)
				settings, err = ledger.GetSettings(db)
				require.NoError(t, err)
				settings.Enabled, settings.SignupCoolingHours, settings.SignupBonusQuota = false, 48, 1000000
				require.NoError(t, ledger.UpdateSettings(db, settings, 6))
				require.NoError(t, ledger.ReleaseSignupBonuses(db, binding.SignupBonusAvailableAt))
				assert.Zero(t, referralAccount(t, db).Balance, "paused programs do not issue gifts")
				settings, err = ledger.GetSettings(db)
				require.NoError(t, err)
				settings.Enabled, settings.SignupBonusEnabled = true, false
				require.NoError(t, ledger.UpdateSettings(db, settings, 6))
				for range 2 {
					require.NoError(t, ledger.ReleaseSignupBonuses(db, binding.SignupBonusAvailableAt))
				}
				assert.Equal(t, 500000, referralAccount(t, db).Balance, "existing promises retain their amount and deadline")
				var count int64
				require.NoError(t, db.Model(&ledger.Audit{}).Where("action = ?", "signup_bonus").Count(&count).Error)
				assert.EqualValues(t, 1, count)
				require.NoError(t, db.Model(&model.TopUp{}).Count(&count).Error)
				assert.Zero(t, count)
				require.NoError(t, db.Model(&ledger.Reward{}).Count(&count).Error)
				assert.Zero(t, count)
			})
			t.Run("shared offices stay active but repeated browser markers hold both unpaid gifts", func(t *testing.T) {
				for _, sharedBrowser := range []bool{false, true} {
					t.Run(fmt.Sprint(sharedBrowser), func(t *testing.T) {
						db := referralTestDB(t, dialect)
						settings, err := ledger.GetSettings(db)
						require.NoError(t, err)
						settings.SignupBonusEnabled, settings.SignupBonusQuota = true, 500000
						require.NoError(t, ledger.UpdateSettings(db, settings, 6))
						first := referredUser(t, db, 2, "192.0.2.2", "first-browser")
						network, browser := "192.0.2.2", "second-browser"
						if sharedBrowser {
							network, browser = "198.51.100.3", "first-browser"
						}
						referredUser(t, db, 3, network, browser)
						require.NoError(t, ledger.ReleaseSignupBonuses(db, first.SignupBonusAvailableAt))
						var bindings []ledger.Binding
						require.NoError(t, db.Order("user_id").Find(&bindings).Error)
						require.Len(t, bindings, 2)
						for _, binding := range bindings {
							if sharedBrowser {
								assert.Equal(t, "review", binding.State)
								assert.Zero(t, binding.SignupBonusPaidAt)
							} else {
								assert.Equal(t, "active", binding.State)
								assert.Positive(t, binding.SignupBonusPaidAt)
							}
						}
						if sharedBrowser {
							assert.Zero(t, referralAccount(t, db).Balance)
						} else {
							assert.Equal(t, 1000000, referralAccount(t, db).Balance)
						}
					})
				}
			})
			t.Run("invitation bursts use one exact window and hold the complete unpaid cluster", func(t *testing.T) {
				db := referralTestDB(t, dialect)
				settings, err := ledger.GetSettings(db)
				require.NoError(t, err)
				settings.SignupBonusEnabled, settings.SignupBonusQuota, settings.InviteBurstLimit = true, 500000, 3
				require.NoError(t, ledger.UpdateSettings(db, settings, 6))
				for index, minute := range []int64{0, 61, 120, 61} {
					id := index + 2
					require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
						tx = ledger.WithSignupBrowser(tx, fmt.Sprintf("burst-browser-%d", id))
						return ledger.Register(ledger.WithSignupContext(tx, "192.0.2.2", "same-office-browser"), id, 1, referralEpoch+minute*60)
					}))
					if id == 4 {
						var count int64
						require.NoError(t, db.Model(&ledger.Binding{}).Where("state = ?", "review").Count(&count).Error)
						assert.Zero(t, count, "three registrations across two hours are not one hourly burst")
					}
				}
				var bindings []ledger.Binding
				require.NoError(t, db.Order("user_id").Find(&bindings).Error)
				require.Len(t, bindings, 4)
				assert.Equal(t, "active", bindings[0].State)
				for _, binding := range bindings[1:] {
					assert.Equal(t, "review", binding.State)
					assert.Equal(t, "Concentrated invitation registrations require review", binding.Reason)
					assert.Zero(t, binding.SignupBonusPaidAt)
				}
			})
			t.Run("approval cannot skip cooling and disabled accounts cannot receive a due gift", func(t *testing.T) {
				db := referralTestDB(t, dialect)
				settings, err := ledger.GetSettings(db)
				require.NoError(t, err)
				settings.SignupBonusEnabled, settings.SignupBonusQuota = true, 500000
				require.NoError(t, ledger.UpdateSettings(db, settings, 6))
				registered := time.Now().Unix() + 3600
				require.NoError(t, ledger.Register(db, 2, 1, registered))
				var binding ledger.Binding
				require.NoError(t, db.First(&binding, "user_id = ?", 2).Error)
				require.NoError(t, ledger.Review(db, binding.ID, 6, true, "Confirmed independent user"))
				assert.Zero(t, referralAccount(t, db).Balance)
				require.NoError(t, db.Model(&model.User{}).Where("id = ?", 2).Update("status", common.UserStatusDisabled).Error)
				require.NoError(t, ledger.ReleaseSignupBonuses(db, binding.SignupBonusAvailableAt))
				require.NoError(t, db.First(&binding, binding.ID).Error)
				assert.Equal(t, "review", binding.State)
				assert.Zero(t, binding.SignupBonusPaidAt)
				assert.Zero(t, referralAccount(t, db).Balance)
			})
			t.Run("cooling upgrade preserves paid bonuses and backfills only unpaid deadlines", func(t *testing.T) {
				db := referralTestDB(t, dialect)
				settings, err := ledger.GetSettings(db)
				require.NoError(t, err)
				settings.SignupBonusEnabled, settings.SignupBonusQuota = true, 500000
				require.NoError(t, ledger.UpdateSettings(db, settings, 6))
				paid := referredUser(t, db, 2, "192.0.2.2")
				require.NoError(t, ledger.CompleteSignup(db, 2))
				pending := referredUser(t, db, 3, "192.0.2.3")
				before := referralAccount(t, db)
				for _, column := range []string{"SignupCoolingHours", "ReviewSharedBrowser", "InviteBurstLimit", "InviteBurstMinutes"} {
					require.NoError(t, db.Migrator().DropColumn(&ledger.Settings{}, column))
				}
				require.NoError(t, db.Migrator().DropIndex(&ledger.Binding{}, "idx_extension_referral_bindings_signup_bonus_available_at"))
				require.NoError(t, db.Migrator().DropColumn(&ledger.Binding{}, "SignupBonusAvailableAt"))
				for range 2 {
					require.NoError(t, ledger.Migrate(db))
				}
				settings, err = ledger.GetSettings(db)
				require.NoError(t, err)
				assert.Equal(t, 24, settings.SignupCoolingHours)
				assert.True(t, settings.ReviewSharedBrowser)
				assert.Equal(t, 5, settings.InviteBurstLimit)
				assert.Equal(t, 60, settings.InviteBurstMinutes)
				require.NoError(t, db.First(&paid, paid.ID).Error)
				require.NoError(t, db.First(&pending, pending.ID).Error)
				assert.Positive(t, paid.SignupBonusPaidAt)
				assert.Equal(t, referralEpoch+86400, pending.SignupBonusAvailableAt)
				assert.Equal(t, before, referralAccount(t, db))
			})
			t.Run("existing schema upgrades twice without backfilling or losing balances", func(t *testing.T) {
				db := referralTestDB(t, dialect)
				binding := referredUser(t, db, 2, "192.0.2.2")
				reward := paidReferral(t, db, 2, "before-upgrade", "100", referralEpoch+1)
				_, err := ledger.Claim(db, 1, reward.ID, reward.AvailableAt)
				require.NoError(t, err)
				before := referralAccount(t, db)
				// Recreate the released schema by removing only the new columns.
				for _, column := range []string{"SignupBonusEnabled", "SignupBonusQuota"} {
					require.NoError(t, db.Migrator().DropColumn(&ledger.Settings{}, column))
				}
				for _, column := range []string{"SignupBonusQuota", "SignupBonusPaidAt"} {
					require.NoError(t, db.Migrator().DropColumn(&ledger.Binding{}, column))
				}
				require.NoError(t, Migrate(db))
				require.NoError(t, Migrate(db))
				settings, err := ledger.GetSettings(db)
				require.NoError(t, err)
				assert.False(t, settings.SignupBonusEnabled)
				assert.Zero(t, settings.SignupBonusQuota)
				require.NoError(t, db.First(&binding, binding.ID).Error)
				assert.Zero(t, binding.SignupBonusQuota)
				assert.Zero(t, binding.SignupBonusPaidAt)
				assert.Equal(t, reward.Quota, binding.Reserved)
				assert.Equal(t, before, referralAccount(t, db))
				require.NoError(t, ledger.Register(db, 2, 1, referralEpoch))
				var count int64
				require.NoError(t, db.Model(&ledger.Binding{}).Where("user_id = ?", 2).Count(&count).Error)
				assert.EqualValues(t, 1, count)
			})
			t.Run("legacy balances import once and historical invitations require approval", func(t *testing.T) {
				db := referralTestDB(t, dialect)
				require.NoError(t, db.Model(&model.User{}).Where("id = ?", 1).Update("aff_quota", 12345).Error)
				require.NoError(t, db.Model(&model.User{}).Where("id = ?", 2).Updates(map[string]any{"inviter_id": 1, "created_at": referralEpoch - 86400}).Error)
				require.NoError(t, ledger.ImportLegacyBalances(db))
				require.NoError(t, ledger.ImportLegacyBalances(db))
				assert.Equal(t, 12345, referralAccount(t, db).Balance)
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return ledger.ImportHistory(tx, 0) }))
				var binding ledger.Binding
				require.NoError(t, db.Where("user_id = ?", 2).First(&binding).Error)
				assert.Equal(t, "historical", binding.State)
				require.NoError(t, ledger.Review(db, binding.ID, 6, true, "Verified historical invitation"))
				require.NoError(t, ledger.Register(db, 2, 1, referralEpoch-86400))
				require.NoError(t, db.First(&binding, binding.ID).Error)
				assert.Equal(t, "active", binding.State, "duplicate registration cannot discard approval")
			})
		})
	}
}

func TestReferralAPIIsolationAndAuthorization(t *testing.T) {
	db := referralTestDB(t, "sqlite")
	oldDB, oldLog, oldSecret, oldSecure := model.DB, model.LOG_DB, common.SessionSecret, common.SessionCookieSecure
	oldRedis, oldType := common.RedisEnabled, common.MainDatabaseType()
	common.RedisEnabled = false
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	model.DB, model.LOG_DB, common.SessionSecret, common.SessionCookieSecure = db, db, "referral-session-test-secret", true
	t.Cleanup(func() {
		model.DB, model.LOG_DB, common.SessionSecret, common.SessionCookieSecure = oldDB, oldLog, oldSecret, oldSecure
	})
	t.Cleanup(func() { common.RedisEnabled = oldRedis; common.SetMainDatabaseType(oldType) })
	referredUser(t, db, 2, "192.0.2.2")
	reward := paidReferral(t, db, 2, "api-owned", "100", referralEpoch+1)
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterRoutes(router.Group("/api"))
	bundle, err := service.CreateLoginSession(1, "password", "192.0.2.1", "referral-test")
	require.NoError(t, err)
	other, err := service.CreateLoginSession(4, "password", "192.0.2.4", "referral-test")
	require.NoError(t, err)
	request := func(method, path, body, token, origin string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "https://panel.example.com/api/extensions/referral"+path, strings.NewReader(body))
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
	assert.Equal(t, http.StatusUnauthorized, request("GET", "/dashboard", "", "", "").Code)
	assert.Equal(t, http.StatusForbidden, request("GET", "/admin/settings", "", bundle.AccessToken, "").Code)
	assert.Equal(t, http.StatusForbidden, request("POST", "/claim", `{}`, bundle.AccessToken, "https://evil.example.com").Code)
	result := request("GET", "/rewards", "", bundle.AccessToken, "")
	assert.Contains(t, result.Body.String(), `"qualification":"active"`)
	assert.Contains(t, result.Body.String(), "api-owned")
	result = request("GET", "/rewards?user_id=2", "", other.AccessToken, "")
	assert.NotContains(t, result.Body.String(), "api-owned")
	result = request("POST", "/claim", fmt.Sprintf(`{"reward_id":%d}`, reward.ID), other.AccessToken, "https://panel.example.com")
	assert.Contains(t, result.Body.String(), `"success":false`)
	result = request("POST", "/claim", fmt.Sprintf(`{"reward_id":%d}`, reward.ID), bundle.AccessToken, "https://panel.example.com")
	assert.Contains(t, result.Body.String(), `"success":true`)
}

func TestReferralMinorAmounts(t *testing.T) {
	for _, tc := range []struct{ amount, currency, want string }{{"1234", "USD", "12.34"}, {"1234", "JPY", "1234"}, {"1234", "KWD", "1.234"}} {
		value, err := ledger.MinorAmount(tc.amount, tc.currency)
		require.NoError(t, err)
		assert.Equal(t, tc.want, value)
	}
	for _, invalid := range []string{"-1", "NaN", "1.5"} {
		_, err := ledger.MinorAmount(invalid, "USD")
		assert.Error(t, err)
	}
}

func TestReferralPaginationMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			if dialect != "sqlite" && os.Getenv("REFERRAL_TEST_"+strings.ToUpper(dialect)+"_DSN") == "" {
				if os.Getenv("REFERRAL_TEST_REQUIRE_MATRIX") == "1" {
					t.Fatalf("missing %s database for required matrix", dialect)
				}
				t.Skip("external database not configured")
			}
			db := referralTestDB(t, dialect)
			oldDB := model.DB
			model.DB = db
			t.Cleanup(func() { model.DB = oldDB })
			bindings := make([]ledger.Binding, 51)
			rewardRows := make([]ledger.Reward, 51)
			transferRows := make([]ledger.Transfer, 51)
			for i := range bindings {
				bindings[i] = ledger.Binding{UserID: i + 2, InviterID: 1, State: "active"}
				rewardRows[i] = ledger.Reward{TradeNo: fmt.Sprintf("page-%d", i), UserID: i + 2, InviterID: 1, State: "pending"}
				transferRows[i] = ledger.Transfer{UserID: 1, RequestID: fmt.Sprintf("page-transfer-%d", i)}
			}
			require.NoError(t, db.Create(&bindings).Error)
			require.NoError(t, db.Create(&rewardRows).Error)
			require.NoError(t, db.Create(&transferRows).Error)
			router := gin.New()
			router.Use(func(c *gin.Context) { c.Set("id", 1) })
			router.GET("/invitees", invitees)
			router.GET("/rewards", rewards)
			router.GET("/transfers", transfers)
			for _, resource := range []string{"invitees", "rewards", "transfers"} {
				for _, tc := range []struct {
					query string
					count int
					first int
				}{
					{"?p=1&page_size=100", 50, 51},
					{"?p=2&page_size=100", 1, 1},
					{"?p=-1&page_size=-1", 1, 51},
					{"?p=9223372036854775807&page_size=50", 0, 0},
				} {
					response := httptest.NewRecorder()
					router.ServeHTTP(response, httptest.NewRequest("GET", "/"+resource+tc.query, nil))
					var result struct {
						Success bool
						Data    struct {
							Items []struct{ ID int }
							Total int
						}
					}
					require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
					require.True(t, result.Success, "%s%s: %s", resource, tc.query, response.Body.String())
					require.Len(t, result.Data.Items, tc.count, "%s%s", resource, tc.query)
					assert.Equal(t, 51, result.Data.Total)
					if tc.count > 0 {
						assert.Equal(t, tc.first, result.Data.Items[0].ID, "%s%s", resource, tc.query)
					}
				}
			}
		})
	}
}
