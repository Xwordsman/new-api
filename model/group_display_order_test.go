package model

import (
	"maps"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	mysqldriver "github.com/go-sql-driver/mysql"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func openGroupDisplayOrderTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dialect := os.Getenv("GROUP_ORDER_TEST_DIALECT")
	if dialect == "" {
		dialect = "sqlite"
	}
	require.Contains(t, []string{"sqlite", "mysql", "postgres"}, dialect)
	dsn := "local"
	if dialect != "sqlite" {
		dsn = os.Getenv("GROUP_ORDER_TEST_DSN")
		require.NotEmpty(t, dsn, "use a disposable group_display_order_test database")
		if dialect == "mysql" {
			config, err := mysqldriver.ParseDSN(dsn)
			require.NoError(t, err)
			require.Equal(t, "group_display_order_test", config.DBName)
		} else {
			parsed, err := url.Parse(dsn)
			require.NoError(t, err)
			require.Contains(t, []string{"postgres", "postgresql"}, parsed.Scheme)
			require.Equal(t, "/group_display_order_test", parsed.Path)
		}
	}
	originalDB, originalSQLite := DB, common.SQLitePath
	originalMain, originalLog := common.MainDatabaseType(), common.LogDatabaseType()
	common.OptionMapRWMutex.RLock()
	originalOptions := maps.Clone(common.OptionMap)
	common.OptionMapRWMutex.RUnlock()
	originalOrder := setting.GroupDisplayOrderJSONString()
	originalAuto := setting.AutoGroups2JsonString()
	originalRatios := ratio_setting.GroupRatio2JSONString()
	t.Setenv("GROUP_ORDER_TEST_CONNECTION", dsn)
	common.SQLitePath = filepath.ToSlash(filepath.Join(t.TempDir(), "group-order.db"))
	db, kind, err := chooseDB("GROUP_ORDER_TEST_CONNECTION", false)
	require.NoError(t, err)
	db = db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	connection, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() {
		DB, common.SQLitePath = originalDB, originalSQLite
		common.SetDatabaseTypes(originalMain, originalLog)
		initCol()
		common.OptionMapRWMutex.Lock()
		common.OptionMap = originalOptions
		common.OptionMapRWMutex.Unlock()
		require.NoError(t, setting.UpdateGroupDisplayOrder(originalOrder))
		require.NoError(t, setting.UpdateAutoGroupsByJsonString(originalAuto))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(originalRatios))
		require.NoError(t, connection.Close())
	})
	if dialect != "sqlite" {
		query := "SELECT DATABASE()"
		if dialect == "postgres" {
			query = "SELECT current_database()"
		}
		var actual string
		require.NoError(t, db.Raw(query).Scan(&actual).Error)
		require.Equal(t, "group_display_order_test", actual, "refuse to modify a non-test database")
	}
	query := "SELECT version()"
	if dialect == "sqlite" {
		query = "SELECT sqlite_version()"
	}
	var version string
	require.NoError(t, db.Raw(query).Scan(&version).Error)
	t.Logf("database: %s %s", dialect, version)
	DB = db
	common.SetMainDatabaseType(kind)
	initCol()
	common.OptionMapRWMutex.Lock()
	common.OptionMap = make(map[string]string)
	common.OptionMapRWMutex.Unlock()
	require.NoError(t, setting.UpdateGroupDisplayOrder("[]"))
	require.NoError(t, db.Migrator().DropTable(&Option{}))
	return db
}

func TestGroupDisplayOrderPersistenceAndValidation(t *testing.T) {
	db := openGroupDisplayOrderTestDB(t)
	// Options already existed in the released schema. Preserve its keys and
	// values when storing the new display-only option.
	require.NoError(t, db.AutoMigrate(&Option{}))
	legacy := []Option{
		{Key: "GroupRatio", Value: `{"default":1,"vip":0.8,"10":2,"2":3}`},
		{Key: "AutoGroups", Value: `["default","vip"]`},
	}
	require.NoError(t, db.Create(&legacy).Error)
	for _, option := range legacy {
		require.NoError(t, updateOptionMap(option.Key, option.Value))
	}
	for range 2 {
		require.NoError(t, db.AutoMigrate(&Option{}))
	}
	assert.Equal(t, []string{"default", "vip"}, setting.OrderGroupNames([]string{"vip", "default"}))

	order := `["vip","hidden","10","2","default","deleted"]`
	require.NoError(t, UpdateOption("GroupDisplayOrder", order))
	for range 2 {
		// Hydrate the display option from database rows, as startup and periodic
		// option sync do, without resetting unrelated global settings.
		require.NoError(t, setting.UpdateGroupDisplayOrder("[]"))
		options, err := AllOption()
		require.NoError(t, err)
		for _, option := range options {
			if option.Key == "GroupDisplayOrder" {
				require.NoError(t, updateOptionMap(option.Key, option.Value))
			}
		}
		assert.JSONEq(t, order, setting.GroupDisplayOrderJSONString())
		assert.Equal(t, []string{"vip", "10", "2", "default", "new"},
			setting.OrderGroupNames([]string{"default", "new", "2", "10", "vip", "vip"}))
	}
	for _, option := range legacy {
		var saved Option
		require.NoError(t, db.Where(Option{Key: option.Key}).First(&saved).Error)
		assert.Equal(t, option.Value, saved.Value)
	}
	assert.JSONEq(t, legacy[1].Value, setting.AutoGroups2JsonString())

	for _, invalid := range []string{`{}`, `null`, `["vip","vip"]`, `[""]`, `[" vip"]`, `[null]`, `[1]`} {
		t.Run(invalid, func(t *testing.T) {
			require.Error(t, UpdateOption("GroupDisplayOrder", invalid))
			require.Error(t, UpdateOptionsBulk(map[string]string{"GroupDisplayOrder": invalid}))
			var saved Option
			require.NoError(t, db.Where(Option{Key: "GroupDisplayOrder"}).First(&saved).Error)
			assert.Equal(t, order, saved.Value)
			assert.JSONEq(t, order, setting.GroupDisplayOrderJSONString())
		})
	}
	// A second save updates the existing option rather than creating a duplicate.
	order = `["default","vip"]`
	require.NoError(t, UpdateOptionsBulk(map[string]string{"GroupDisplayOrder": order}))
	var count int64
	require.NoError(t, db.Model(&Option{}).Where(Option{Key: "GroupDisplayOrder"}).Count(&count).Error)
	assert.EqualValues(t, 1, count)

	// Persist failures must not publish an order that was never saved.
	require.NoError(t, db.Migrator().DropTable(&Option{}))
	require.Error(t, UpdateOption("GroupDisplayOrder", `["vip","default"]`))
	assert.JSONEq(t, order, setting.GroupDisplayOrderJSONString())
	common.OptionMapRWMutex.RLock()
	savedOrder := common.OptionMap["GroupDisplayOrder"]
	common.OptionMapRWMutex.RUnlock()
	assert.JSONEq(t, order, savedOrder)
}
