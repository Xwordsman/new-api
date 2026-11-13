package model

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	payments "github.com/QuantumNous/new-api/extensions/checkin/policy"
	lucky "github.com/QuantumNous/new-api/extensions/luckydraw/policy"
	"github.com/QuantumNous/new-api/extensions/referral/ledger"
	mysqldriver "github.com/go-sql-driver/mysql"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestSearchRedemptionsFiltersAndPaginates(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&Redemption{}))
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
	})

	now := common.GetTimestamp()
	redemptions := []Redemption{
		{Id: 1, Name: "alpha-active", Key: "00000000000000000000000000000001", Status: common.RedemptionCodeStatusEnabled, ExpiredTime: 0},
		{Id: 2, Name: "alpha-future", Key: "00000000000000000000000000000002", Status: common.RedemptionCodeStatusEnabled, ExpiredTime: now + 3600},
		{Id: 3, Name: "alpha-expired", Key: "00000000000000000000000000000003", Status: common.RedemptionCodeStatusEnabled, ExpiredTime: now - 10},
		{Id: 4, Name: "beta-disabled", Key: "00000000000000000000000000000004", Status: common.RedemptionCodeStatusDisabled, ExpiredTime: 0},
		{Id: 5, Name: "beta-used", Key: "00000000000000000000000000000005", Status: common.RedemptionCodeStatusUsed, ExpiredTime: 0},
	}
	require.NoError(t, DB.Create(&redemptions).Error)

	tests := []struct {
		name      string
		keyword   string
		status    string
		startIdx  int
		num       int
		wantTotal int64
		wantIds   []int
	}{
		{
			name:      "no filters returns all rows",
			num:       10,
			wantTotal: 5,
			wantIds:   []int{5, 4, 3, 2, 1},
		},
		{
			name:      "keyword filters by name prefix",
			keyword:   "alpha",
			num:       10,
			wantTotal: 3,
			wantIds:   []int{3, 2, 1},
		},
		{
			name:      "enabled status excludes expired rows",
			status:    "1",
			num:       10,
			wantTotal: 2,
			wantIds:   []int{2, 1},
		},
		{
			name:      "expired status returns enabled expired rows",
			status:    "expired",
			num:       10,
			wantTotal: 1,
			wantIds:   []int{3},
		},
		{
			name:      "disabled status",
			status:    "2",
			num:       10,
			wantTotal: 1,
			wantIds:   []int{4},
		},
		{
			name:      "used status",
			status:    "3",
			num:       10,
			wantTotal: 1,
			wantIds:   []int{5},
		},
		{
			name:      "pagination keeps unpaged total",
			startIdx:  1,
			num:       2,
			wantTotal: 5,
			wantIds:   []int{4, 3},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rows, total, err := SearchRedemptions(tt.keyword, tt.status, tt.startIdx, tt.num)
			require.NoError(t, err)
			assert.Equal(t, tt.wantTotal, total)
			gotIds := make([]int, 0, len(rows))
			for _, row := range rows {
				gotIds = append(gotIds, row.Id)
			}
			assert.Equal(t, tt.wantIds, gotIds)
		})
	}
}

func setupRedeemFixture(t *testing.T, quota int) (userId int, key string) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&Redemption{}))
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
		DB.Exec("DELETE FROM users")
		DB.Exec("DELETE FROM logs")
	})

	user := &User{Username: "redeem-user", Password: "password", Status: common.UserStatusEnabled, Quota: 0}
	require.NoError(t, DB.Create(user).Error)

	key = "10000000000000000000000000000001"
	redemption := &Redemption{
		Name:        "redeem-test",
		Key:         key,
		Status:      common.RedemptionCodeStatusEnabled,
		Quota:       quota,
		CreatedTime: common.GetTimestamp(),
	}
	require.NoError(t, DB.Create(redemption).Error)
	return user.Id, key
}

func TestRedeemCreditsQuotaExactlyOnce(t *testing.T) {
	userId, key := setupRedeemFixture(t, 500)

	quota, err := Redeem(key, userId)
	require.NoError(t, err)
	assert.Equal(t, 500, quota)

	var user User
	require.NoError(t, DB.First(&user, "id = ?", userId).Error)
	assert.Equal(t, 500, user.Quota)

	var redemption Redemption
	require.NoError(t, DB.First(&redemption, "name = ?", "redeem-test").Error)
	assert.Equal(t, common.RedemptionCodeStatusUsed, redemption.Status)
	assert.Equal(t, userId, redemption.UsedUserId)

	// Redeeming the same code again must fail and must not credit quota.
	_, err = Redeem(key, userId)
	require.Error(t, err)
	require.NoError(t, DB.First(&user, "id = ?", userId).Error)
	assert.Equal(t, 500, user.Quota)
}

func TestRedeemRejectsWalletOverflow(t *testing.T) {
	userId, key := setupRedeemFixture(t, 11)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", userId).Update("quota", common.MaxWalletQuota-10).Error)

	_, err := Redeem(key, userId)
	require.ErrorIs(t, err, ErrRedeemFailed)

	var user User
	require.NoError(t, DB.First(&user, "id = ?", userId).Error)
	assert.Equal(t, common.MaxWalletQuota-10, user.Quota)

	var redemption Redemption
	require.NoError(t, DB.First(&redemption, "key = ?", key).Error)
	assert.Equal(t, common.RedemptionCodeStatusEnabled, redemption.Status)
}

func TestRedemptionQuotaRejectsWalletOverflow(t *testing.T) {
	setupRedeemFixture(t, 500)

	redemption := &Redemption{
		Name:        "overflow-redemption",
		Key:         "10000000000000000000000000000002",
		Status:      common.RedemptionCodeStatusEnabled,
		Quota:       common.MaxWalletQuota + 1,
		CreatedTime: common.GetTimestamp(),
	}
	require.Error(t, redemption.Insert())
}

// Exactly one of several concurrent redeems of the same code may win, and
// quota must be credited exactly once.
func TestRedeemConcurrentSingleSuccess(t *testing.T) {
	userId, key := setupRedeemFixture(t, 300)

	const goroutines = 5
	successes := make([]bool, goroutines)
	var wg sync.WaitGroup
	wg.Add(goroutines)
	for i := range goroutines {
		go func(idx int) {
			defer wg.Done()
			if _, err := Redeem(key, userId); err == nil {
				successes[idx] = true
			}
		}(i)
	}
	wg.Wait()

	successCount := 0
	for _, ok := range successes {
		if ok {
			successCount++
		}
	}
	assert.Equal(t, 1, successCount, "exactly one concurrent redeem should succeed")

	var user User
	require.NoError(t, DB.First(&user, "id = ?", userId).Error)
	assert.Equal(t, 300, user.Quota, "quota must be credited exactly once")
}

// Mirrors the released schema before sale metadata was introduced. Keep this
// independent of Redemption so the upgrade test really starts without columns.
type legacyRechargeRedemption struct {
	Id           int
	UserId       int
	Key          string `gorm:"type:char(32);uniqueIndex:idx_redemptions_key"`
	Status       int    `gorm:"default:1"`
	Name         string `gorm:"index:idx_redemptions_name"`
	Quota        int    `gorm:"default:100"`
	CreatedTime  int64  `gorm:"bigint"`
	RedeemedTime int64  `gorm:"bigint"`
	UsedUserId   int
	DeletedAt    gorm.DeletedAt `gorm:"index:idx_redemptions_deleted_at"`
	ExpiredTime  int64          `gorm:"bigint"`
}

func (legacyRechargeRedemption) TableName() string { return "redemptions" }

func openRedemptionRechargeDB(t *testing.T) *gorm.DB {
	t.Helper()
	dialect := os.Getenv("REDEMPTION_TEST_DIALECT")
	if dialect == "" {
		dialect = "sqlite"
	}
	require.Contains(t, []string{"sqlite", "mysql", "postgres"}, dialect)
	dsn := "local"
	if dialect != "sqlite" {
		dsn = os.Getenv("REDEMPTION_TEST_DSN")
		require.NotEmpty(t, dsn, "use a disposable redemption_linkage_test database")
		if dialect == "mysql" {
			config, err := mysqldriver.ParseDSN(dsn)
			require.NoError(t, err)
			require.Equal(t, "redemption_linkage_test", config.DBName)
		} else {
			parsed, err := url.Parse(dsn)
			require.NoError(t, err)
			require.Contains(t, []string{"postgres", "postgresql"}, parsed.Scheme)
			require.Equal(t, "/redemption_linkage_test", parsed.Path)
		}
	}
	oldDB, oldLogDB := DB, LOG_DB
	oldMain, oldLog := common.MainDatabaseType(), common.LogDatabaseType()
	oldSQLite, oldTurnstile := common.SQLitePath, common.TurnstileCheckEnabled
	oldPayment, oldReferral, oldRefund := CheckinRedemptionPaymentHook, ReferralPaymentHook, CheckinRefundHook
	t.Setenv("REDEMPTION_TEST_CONNECTION", dsn)
	common.SQLitePath = filepath.ToSlash(filepath.Join(t.TempDir(), "redemption.db")) + "?_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_txlock=immediate"
	db, kind, err := chooseDB("REDEMPTION_TEST_CONNECTION", false)
	require.NoError(t, err)
	db = db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	connection, err := db.DB()
	require.NoError(t, err)
	connection.SetMaxOpenConns(8)
	connection.SetMaxIdleConns(8)
	t.Cleanup(func() {
		DB, LOG_DB = oldDB, oldLogDB
		common.SetDatabaseTypes(oldMain, oldLog)
		common.SQLitePath, common.TurnstileCheckEnabled = oldSQLite, oldTurnstile
		CheckinRedemptionPaymentHook, ReferralPaymentHook, CheckinRefundHook = oldPayment, oldReferral, oldRefund
		initCol()
		require.NoError(t, connection.Close())
	})
	if dialect != "sqlite" {
		query := "SELECT DATABASE()"
		if dialect == "postgres" {
			query = "SELECT current_database()"
		}
		var actual string
		require.NoError(t, db.Raw(query).Scan(&actual).Error)
		require.Equal(t, "redemption_linkage_test", actual, "refuse to modify a non-test database")
	}
	query := "SELECT version()"
	if dialect == "sqlite" {
		query = "SELECT sqlite_version()"
	}
	var version string
	require.NoError(t, db.Raw(query).Scan(&version).Error)
	t.Logf("database: %s %s", dialect, version)
	DB, LOG_DB = db, db
	common.SetDatabaseTypes(kind, kind)
	common.TurnstileCheckEnabled = false
	initCol()
	CheckinRedemptionPaymentHook, ReferralPaymentHook, CheckinRefundHook = payments.RecordRedemptionPayment, ledger.RecordPayment, payments.Refund
	tables := []any{&Redemption{}, &TopUp{}, &Checkin{}, &Log{}, &User{},
		&payments.Settings{}, &payments.Account{}, &payments.Audit{}, &payments.PaymentRecord{}, &payments.PaymentRefund{},
		&lucky.Settings{}, &lucky.Account{}, &lucky.Pool{}, &lucky.Stock{}, &lucky.Record{}, &lucky.Audit{},
		&ledger.Settings{}, &ledger.Account{}, &ledger.Binding{}, &ledger.Signal{}, &ledger.PaymentIdentity{}, &ledger.Reward{}, &ledger.Transfer{}, &ledger.Audit{}, &ledger.RefundNotice{}}
	for _, table := range tables {
		require.NoError(t, db.Migrator().DropTable(table))
	}
	require.NoError(t, db.AutoMigrate(&User{}, &Log{}, &Checkin{}, &TopUp{}))
	require.NoError(t, payments.Migrate(db))
	require.NoError(t, lucky.Migrate(db))
	require.NoError(t, ledger.Migrate(db))
	s, err := payments.GetSettings(db)
	require.NoError(t, err)
	s.FollowRegistrationRisk = false
	_, err = payments.UpdateSettings(db, s, 1)
	require.NoError(t, err)
	ls, err := lucky.GetSettings(db)
	require.NoError(t, err)
	ls.FollowRegistrationRisk = false
	_, err = lucky.UpdateSettings(db, ls, 1)
	require.NoError(t, err)
	return db
}

func rechargeUser(t *testing.T, db *gorm.DB, name string) User {
	t.Helper()
	user := User{Username: name, AffCode: name, Status: common.UserStatusEnabled, Group: "default"}
	require.NoError(t, db.Create(&user).Error)
	return user
}

func rechargeCode(t *testing.T, kind, amount, currency string, commission bool, quota int) Redemption {
	t.Helper()
	code := Redemption{Name: "recharge", Key: common.GetUUID(), Status: common.RedemptionCodeStatusEnabled, Quota: quota, CodeType: kind, RechargeAmount: amount, RechargeCurrency: currency, ReferralEnabled: commission}
	require.NoError(t, code.Insert())
	return code
}

func TestRedemptionRechargeMigrationPreservesLegacyGifts(t *testing.T) {
	for _, upgrade := range []bool{false, true} {
		t.Run(fmt.Sprintf("upgrade=%t", upgrade), func(t *testing.T) {
			db := openRedemptionRechargeDB(t)
			user := rechargeUser(t, db, "legacy-buyer")
			require.NoError(t, db.Model(&user).Update("quota", 1234).Error)
			if upgrade {
				require.NoError(t, db.AutoMigrate(&legacyRechargeRedemption{}))
				legacy := []legacyRechargeRedemption{
					{Id: 1, Name: "unused", Key: "legacy-unused", Quota: 500, CreatedTime: 100},
					{Id: 2, Name: "consumed", Key: "legacy-used", Quota: 700, Status: common.RedemptionCodeStatusUsed, RedeemedTime: 200, UsedUserId: user.Id},
					{Id: 3, Name: "deleted", Key: "legacy-deleted", Quota: 900, DeletedAt: gorm.DeletedAt{Time: time.Unix(300, 0), Valid: true}},
				}
				require.NoError(t, db.Create(&legacy).Error)
			}
			for range 2 {
				require.NoError(t, db.AutoMigrate(&Redemption{}))
				require.NoError(t, payments.Migrate(db))
			}
			assert.True(t, db.Migrator().HasIndex(&Redemption{}, "idx_redemptions_key"))
			assert.True(t, db.Migrator().HasIndex(&Redemption{}, "idx_redemptions_name"))
			assert.True(t, db.Migrator().HasIndex(&Redemption{}, "idx_redemptions_deleted_at"))
			if !upgrade {
				code := rechargeCode(t, "sale", "50", "CNY", false, 500)
				_, err := Redeem(code.Key, user.Id)
				require.NoError(t, err)
				return
			}
			var codes []Redemption
			require.NoError(t, db.Unscoped().Order("id").Find(&codes).Error)
			require.Len(t, codes, 3)
			assert.Equal(t, int64(100), codes[0].CreatedTime)
			assert.Equal(t, 700, codes[1].Quota)
			assert.Equal(t, int64(200), codes[1].RedeemedTime)
			assert.Equal(t, user.Id, codes[1].UsedUserId)
			assert.True(t, codes[2].DeletedAt.Valid)
			duplicate := Redemption{Name: "duplicate", Key: "legacy-unused", Quota: 500}
			require.Error(t, duplicate.Insert(), "code key must stay unique after migration")
			_, err := Redeem("legacy-unused", user.Id)
			require.NoError(t, err)
			_, err = Redeem("legacy-used", user.Id)
			require.Error(t, err)
			var current User
			require.NoError(t, db.First(&current, user.Id).Error)
			assert.Equal(t, 1734, current.Quota)
			var paymentsCount int64
			require.NoError(t, db.Model(&payments.PaymentRecord{}).Count(&paymentsCount).Error)
			assert.Zero(t, paymentsCount, "neither legacy use nor historical redeemed codes are recharge evidence")
		})
	}
}

func TestRedemptionRechargeQualifiesBothPluginsAndRefunds(t *testing.T) {
	db := openRedemptionRechargeDB(t)
	require.NoError(t, db.AutoMigrate(&Redemption{}))
	user := rechargeUser(t, db, "buyer")
	gift := rechargeCode(t, "gift", "999", "USD", true, 500)
	assert.Empty(t, gift.RechargeAmount)
	assert.False(t, gift.ReferralEnabled)
	_, err := Redeem(gift.Key, user.Id)
	require.NoError(t, err)
	sale := rechargeCode(t, "sale", "100.00", "CNY", false, 9000000)
	_, err = Redeem(sale.Key, user.Id)
	require.NoError(t, err)
	usd := rechargeCode(t, "sale", "1.25", "USD", false, 100)
	_, err = Redeem(usd.Key, user.Id)
	require.NoError(t, err)
	rows, total, err := payments.GetPayments(db, payments.PaymentQuery{Source: "redemption", UserID: user.Id, Page: 1, PageSize: 10})
	require.NoError(t, err)
	require.Equal(t, int64(2), total)
	for _, row := range rows {
		assert.Equal(t, "redemption", row.Provider)
		assert.Equal(t, payments.PaymentOriginRedemption, row.Origin)
		assert.NotContains(t, row.Reference, sale.Key)
	}
	// Recording remains on while both reward plugins are off.
	now := time.Now()
	checkin, err := payments.Dashboard(db, user.Id, "", now)
	require.NoError(t, err)
	assert.False(t, checkin.Enabled)
	assert.Equal(t, "109", checkin.Eligibility.QualifiedAmount)
	draw, err := lucky.Dashboard(db, user.Id, now)
	require.NoError(t, err)
	assert.False(t, draw.Drawable)
	assert.Equal(t, "109", draw.QualifiedAmount)
	s, err := payments.GetSettings(db)
	require.NoError(t, err)
	s.Enabled, s.ThresholdAmount = true, "100"
	_, err = payments.UpdateSettings(db, s, 1)
	require.NoError(t, err)
	ls, err := lucky.GetSettings(db)
	require.NoError(t, err)
	ls.Enabled = true
	_, err = lucky.UpdateSettings(db, ls, 1)
	require.NoError(t, err)
	checkin, err = payments.Dashboard(db, user.Id, "", now)
	require.NoError(t, err)
	assert.True(t, checkin.Claimable)
	draw, err = lucky.Dashboard(db, user.Id, now)
	require.NoError(t, err)
	assert.True(t, draw.Drawable)
	// External-shop refunds are administrator-audited qualification adjustments.
	for range 2 {
		require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
			if err := payments.RefundPayment(tx, fmt.Sprintf("redemption:%d", sale.Id), "100", "Shop refund confirmed", 1); err != nil {
				return err
			}
			return RecordPaymentRefund(tx, "redemption", fmt.Sprint(sale.Id), "100", "CNY")
		}))
	}
	checkin, err = payments.Dashboard(db, user.Id, "", now)
	require.NoError(t, err)
	assert.Equal(t, "9", checkin.Eligibility.QualifiedAmount)
	assert.False(t, checkin.Claimable)
	draw, err = lucky.Dashboard(db, user.Id, now)
	require.NoError(t, err)
	assert.False(t, draw.Drawable)
	var current User
	require.NoError(t, db.First(&current, user.Id).Error)
	assert.Equal(t, 9000600, current.Quota, "refund of qualification must not silently debit the wallet")
	var topups, rewards int64
	require.NoError(t, db.Model(&TopUp{}).Count(&topups).Error)
	require.NoError(t, db.Model(&ledger.Reward{}).Count(&rewards).Error)
	assert.Zero(t, topups, "redemption must not fabricate gateway orders")
	assert.Zero(t, rewards, "commission is opt-in")
}

func TestRedemptionRechargeCommissionCoolingCapAndReversal(t *testing.T) {
	db := openRedemptionRechargeDB(t)
	require.NoError(t, db.AutoMigrate(&Redemption{}))
	inviter, buyer := rechargeUser(t, db, "inviter"), rechargeUser(t, db, "invitee")
	s, err := ledger.GetSettings(db)
	require.NoError(t, err)
	s.CapQuota = 1000
	require.NoError(t, ledger.UpdateSettings(db, s, inviter.Id))
	require.NoError(t, ledger.Register(db, buyer.Id, inviter.Id, time.Now().Unix()))
	code := rechargeCode(t, "sale", "100", "CNY", true, 500)
	_, err = Redeem(code.Key, buyer.Id)
	require.NoError(t, err)
	var reward ledger.Reward
	require.NoError(t, db.First(&reward).Error)
	assert.Equal(t, 1000, reward.Quota, "per-invitee cap still applies")
	assert.Equal(t, reward.PaidAt+24*3600, reward.AvailableAt)
	assert.Empty(t, reward.PayerHash, "an external shop provides no verified payer identity")
	claimed, err := ledger.Claim(db, inviter.Id, reward.ID, reward.PaidAt)
	require.ErrorIs(t, err, ledger.ErrUnavailable)
	assert.Zero(t, claimed, "cooldown cannot be bypassed")
	claimed, err = ledger.Claim(db, inviter.Id, reward.ID, reward.AvailableAt+1)
	require.ErrorIs(t, err, ledger.ErrUnavailable)
	assert.Zero(t, claimed, "missing registration evidence still requires review")
	for range 2 {
		require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
			if err := payments.RefundPayment(tx, reward.TradeNo, "100", "Shop refund reviewed", inviter.Id); err != nil {
				return err
			}
			return RecordPaymentRefund(tx, "redemption", fmt.Sprint(code.Id), "100", "CNY")
		}))
	}
	require.NoError(t, db.First(&reward, reward.ID).Error)
	assert.Equal(t, reward.Quota, reward.Reversed)
	var audits int64
	require.NoError(t, db.Model(&payments.Audit{}).Where("action = ?", "payment_refund").Count(&audits).Error)
	assert.Equal(t, int64(1), audits, "duplicate refunds must be idempotent")
}

func TestRedemptionRechargeRollbackAndNoReactivation(t *testing.T) {
	for _, failure := range []string{"missing hook", "payment", "referral", "wallet"} {
		t.Run(failure, func(t *testing.T) {
			db := openRedemptionRechargeDB(t)
			require.NoError(t, db.AutoMigrate(&Redemption{}))
			user := rechargeUser(t, db, "buyer")
			code := rechargeCode(t, "sale", "100", "CNY", true, 100)
			switch failure {
			case "missing hook":
				CheckinRedemptionPaymentHook = nil
			case "payment":
				CheckinRedemptionPaymentHook = func(tx *gorm.DB, id int, trade, provider string, payment ledger.Payment) error {
					if err := payments.RecordRedemptionPayment(tx, id, trade, provider, payment); err != nil {
						return err
					}
					return errors.New("payment ledger failure")
				}
			case "referral":
				inviter := rechargeUser(t, db, "inviter")
				require.NoError(t, ledger.Register(db, user.Id, inviter.Id, time.Now().Unix()))
				ReferralPaymentHook = func(tx *gorm.DB, id int, trade, provider string, payment ledger.Payment) error {
					if err := ledger.RecordPayment(tx, id, trade, provider, payment); err != nil {
						return err
					}
					return errors.New("referral ledger failure")
				}
			case "wallet":
				require.NoError(t, db.Model(&user).Update("quota", common.MaxWalletQuota-99).Error)
			}
			_, err := Redeem(code.Key, user.Id)
			require.ErrorIs(t, err, ErrRedeemFailed)
			var current Redemption
			require.NoError(t, db.First(&current, code.Id).Error)
			assert.Equal(t, common.RedemptionCodeStatusEnabled, current.Status)
			assert.Zero(t, current.UsedUserId)
			var count int64
			for _, table := range []any{&payments.PaymentRecord{}, &payments.PaymentRefund{}, &ledger.Reward{}, &ledger.RefundNotice{}} {
				require.NoError(t, db.Model(table).Count(&count).Error)
				assert.Zero(t, count)
			}
			require.NoError(t, db.First(&user, user.Id).Error)
			if failure == "wallet" {
				assert.Equal(t, common.MaxWalletQuota-99, user.Quota)
			} else {
				assert.Zero(t, user.Quota)
			}
		})
	}
	t.Run("concurrent use and stale admin edit", func(t *testing.T) {
		db := openRedemptionRechargeDB(t)
		require.NoError(t, db.AutoMigrate(&Redemption{}))
		user := rechargeUser(t, db, "buyer")
		code := rechargeCode(t, "sale", "100", "CNY", false, 500)
		results := make([]error, 4)
		var wg sync.WaitGroup
		for i := range results {
			wg.Go(func() { _, results[i] = Redeem(code.Key, user.Id) })
		}
		wg.Wait()
		successes := 0
		for _, err := range results {
			if err == nil {
				successes++
			}
		}
		assert.Equal(t, 1, successes)
		require.Error(t, code.Update(), "an admin form loaded before redemption cannot reactivate a used code")
		_, err := Redeem(code.Key, user.Id)
		require.Error(t, err)
		var count int64
		require.NoError(t, db.Model(&payments.PaymentRecord{}).Count(&count).Error)
		assert.Equal(t, int64(1), count)
		require.NoError(t, db.First(&user, user.Id).Error)
		assert.Equal(t, 500, user.Quota)
	})
}

func TestRedemptionRechargeValidation(t *testing.T) {
	for _, invalid := range []string{"", "0", "-1", "+1", "1e2", "1.001", "1000000000.01", " 100", "1.", strings.Repeat("0", 49) + "1"} {
		t.Run(invalid, func(t *testing.T) {
			code := Redemption{CodeType: "sale", RechargeAmount: invalid, RechargeCurrency: "CNY"}
			require.Error(t, code.NormalizeRecharge())
		})
	}
	for _, currency := range []string{"CNY", "USD"} {
		code := Redemption{CodeType: "sale", RechargeAmount: "100.00", RechargeCurrency: currency}
		require.NoError(t, code.NormalizeRecharge())
		assert.Equal(t, "100", code.RechargeAmount)
	}
	code := Redemption{CodeType: "sale", RechargeAmount: "100", RechargeCurrency: "EUR"}
	require.Error(t, code.NormalizeRecharge())
	payment := ledger.Payment{Amount: "100", Currency: "CNY"}
	require.ErrorIs(t, payments.RecordPayment(nil, 1, "sale", " Redemption ", payment), payments.ErrPaymentInvalid)
	require.ErrorIs(t, payments.ReconcilePayment(nil, 1, "sale", "redemption", "topup", payment, 1, "review"), payments.ErrPaymentInvalid)
}
