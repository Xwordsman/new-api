package channelmonitor

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/extensions/grouppricing"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/groupdiscount"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

const monitorEpoch int64 = 1700000000

// External engines must use dedicated disposable databases. The log connection
// is separate to protect against accidental cross-database queries.
func monitorTestDB(t *testing.T, dialect, suffix string) *gorm.DB {
	t.Helper()
	var driver gorm.Dialector
	switch dialect {
	case "sqlite":
		driver = sqlite.Open(":memory:")
	case "mysql", "postgres":
		dsn := os.Getenv("CHANNEL_MONITOR_TEST_" + strings.ToUpper(dialect) + suffix + "_DSN")
		database := "channel_monitor_test"
		if suffix == "_LOG" {
			database = "channel_monitor_logs_test"
		}
		require.Contains(t, dsn, "/"+database+"?")
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
	if dialect == "sqlite" {
		connection.SetMaxOpenConns(1)
	}
	t.Cleanup(func() { require.NoError(t, connection.Close()) })
	var tables []any
	if suffix == "_LOG" {
		tables = []any{&model.Log{}}
	} else {
		tables = []any{&model.Option{}, &model.Ability{}, &ProbeRun{}}
	}
	for _, table := range tables {
		require.NoError(t, db.Migrator().DropTable(table))
	}
	require.NoError(t, db.AutoMigrate(tables...))
	if suffix == "" {
		for range 2 {
			require.NoError(t, Migrate(db))
		}
	}
	return db
}

func monitorTestSettings(t *testing.T) {
	t.Helper()
	groups, userRatios := ratio_setting.GroupRatio2JSONString(), ratio_setting.GroupGroupRatio2JSONString()
	usable := setting.UserUsableGroups2JSONString()
	special := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.MarshalJSONString()
	order, topup := setting.GroupDisplayOrderJSONString(), common.TopupGroupRatio2JSONString()
	auto, maxAuto, defaultAuto := setting.AutoGroups2JsonString(), setting.GetMaxTokenAutoGroups(), setting.DefaultUseAutoGroup
	common.OptionMapRWMutex.Lock()
	options := maps.Clone(common.OptionMap)
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()
	consume, errors := common.LogConsumeEnabled, constant.ErrorLogEnabled
	previousRuntime := groupdiscount.Default
	groupdiscount.Default = &groupdiscount.Runtime{}
	t.Cleanup(func() {
		groupdiscount.Default = previousRuntime
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(groups))
		require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(userRatios))
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(usable))
		require.NoError(t, ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.UnmarshalJSON([]byte(special)))
		require.NoError(t, setting.UpdateGroupDisplayOrder(order))
		require.NoError(t, common.UpdateTopupGroupRatioByJSONString(topup))
		require.NoError(t, setting.UpdateAutoGroupsByJsonString(auto))
		require.NoError(t, setting.UpdateMaxTokenAutoGroups(fmt.Sprint(maxAuto)))
		setting.DefaultUseAutoGroup = defaultAuto
		common.OptionMapRWMutex.Lock()
		common.OptionMap = options
		common.OptionMapRWMutex.Unlock()
		common.LogConsumeEnabled, constant.ErrorLogEnabled = consume, errors
		clear(statisticsCache.entries)
	})
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"public":0.3,"private":0.5,"idle":0.4,"disabled":0.8,"unpublished":1}`))
	require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(`{"member":{"public":0.24}}`))
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"public":"Public","idle":"Idle","disabled":"Disabled"}`))
	require.NoError(t, ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.UnmarshalJSON([]byte(`{}`)))
	require.NoError(t, setting.UpdateGroupDisplayOrder(`["public","idle","disabled"]`))
	require.NoError(t, common.UpdateTopupGroupRatioByJSONString(`{}`))
	require.NoError(t, setting.UpdateAutoGroupsByJsonString(`["public"]`))
	require.NoError(t, setting.UpdateMaxTokenAutoGroups("5"))
	setting.DefaultUseAutoGroup = false
	common.LogConsumeEnabled, constant.ErrorLogEnabled = true, true
	clear(statisticsCache.entries)
}

func monitorLogs(t *testing.T, db *gorm.DB) {
	t.Helper()
	logs := []model.Log{
		{Group: "public", ChannelId: 7, CreatedAt: monitorEpoch - 100, Type: model.LogTypeConsume, ModelName: "openai-test", IsStream: true, PromptTokens: 100, CompletionTokens: 90, UseTime: 4, Other: `{"frt":1000,"cache_tokens":25,"admin_info":{"secret":"private-diagnostics"}}`},
		{Group: "public", ChannelId: 7, CreatedAt: monitorEpoch - 200, Type: model.LogTypeConsume, ModelName: "claude-test", IsStream: true, PromptTokens: 40, CompletionTokens: 40, UseTime: 3, Other: `{"frt":1000,"cache_tokens":20,"cache_write_tokens":40,"usage_semantic":"anthropic","stream_status":{"status":"ok"}}`},
		{Group: "public", ChannelId: 7, CreatedAt: monitorEpoch - 300, Type: model.LogTypeConsume, ModelName: "openai-test", IsStream: true, Other: `{"stream_status":{"status":"error"}}`},
		{Group: "public", ChannelId: 7, CreatedAt: monitorEpoch - 400, Type: model.LogTypeError, ModelName: "openai-test", Other: `{"admin_info":{"request_policy":[{"channel_id":7,"error_source":"upstream"}]}}`},
		{Group: "public", ChannelId: 7, CreatedAt: monitorEpoch - 500, Type: model.LogTypeError, ModelName: "local-only", Other: `{"admin_info":{"request_policy":[{"channel_id":7,"error_source":"upstream"},{"channel_id":7,"error_source":"local"}]}}`},
		{Group: "public", ChannelId: 0, CreatedAt: monitorEpoch - 20, Type: model.LogTypeError, ModelName: "unrouted"},
		{Group: "public", ChannelId: 7, CreatedAt: monitorEpoch - 3601, Type: model.LogTypeConsume, ModelName: "old"},
		{Group: "public", ChannelId: 7, CreatedAt: monitorEpoch + 1, Type: model.LogTypeConsume, ModelName: "future"},
		{Group: "public", ChannelId: 7, CreatedAt: monitorEpoch - 20, Type: model.LogTypeTopup, ModelName: "non-relay"},
		{Group: "private", ChannelId: 8, CreatedAt: monitorEpoch - 20, Type: model.LogTypeConsume, ModelName: "private-model"},
	}
	for i := range logs {
		logs[i].Username = "private-username"
		logs[i].Ip = "192.0.2.123"
		logs[i].Content = "private-response-content"
		logs[i].RequestId = fmt.Sprintf("private-request-%d", i)
	}
	require.NoError(t, db.Create(&logs).Error)
}

func TestChannelMonitorDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			if dialect != "sqlite" && os.Getenv("CHANNEL_MONITOR_TEST_"+strings.ToUpper(dialect)+"_DSN") == "" {
				if os.Getenv("CHANNEL_MONITOR_TEST_REQUIRE_MATRIX") == "1" {
					t.Fatalf("missing required %s database", dialect)
				}
				t.Skip("external database not configured")
			}
			t.Run("public pricing migrates once and renames preserve offers independently of monitoring", func(t *testing.T) {
				for _, legacy := range []bool{false, true} {
					t.Run(fmt.Sprint("legacy=", legacy), func(t *testing.T) {
						monitorTestSettings(t)
						db := monitorTestDB(t, dialect, "")
						if dialect == "sqlite" {
							var version string
							require.NoError(t, db.Raw("SELECT sqlite_version()").Scan(&version).Error)
							t.Log("SQLite", version)
						}
						legacyRaw := `{"revision":7,"enabled":true,"groups":[{"group":"public","display_name":"GPT","description":"Preserve me","badge":"Offer","icon":"OpenAI","promotion":{"enabled":true,"factor":0.8,"daily_start":"18:00","daily_end":"22:00","timezone":"Asia/Shanghai"}},{"group":"idle","display_name":"Idle"}]}`
						legacyRaw = strings.Replace(legacyRaw, `"icon":"OpenAI"`, `"icon":"OpenAI","probe_models":["text-test"]`, 1)
						legacyRaw = strings.Replace(legacyRaw, `"revision":7`, `"revision":7,"probe":{"enabled":true,"interval_minutes":60,"only_when_idle":false,"daily_limit":100}`, 1)
						if legacy {
							require.NoError(t, db.Create(&model.Option{Key: settingsKey, Value: legacyRaw}).Error)
						}
						require.NoError(t, db.Create(&model.Option{Key: "unrelated", Value: "preserved"}).Error)
						for range 2 {
							require.NoError(t, grouppricing.Migrate(db))
						}
						initial, err := grouppricing.Read(db)
						require.NoError(t, err)
						if legacy {
							require.Len(t, initial.Promotions.Groups, 1)
							assert.Equal(t, "18:00", initial.Promotions.Groups[0].Promotion.DailyStart)
							var original model.Option
							require.NoError(t, db.Where(clause.Eq{Column: "key", Value: settingsKey}).Take(&original).Error)
							assert.Equal(t, legacyRaw, original.Value)
						} else {
							assert.Empty(t, initial.Promotions.Groups)
							_, err = saveSettings(db, Settings{Enabled: true, Groups: []GroupSettings{{Group: "public", DisplayName: "GPT", Description: "Preserve me", Badge: "Offer", Icon: "OpenAI"}, {Group: "idle"}}})
							require.NoError(t, err)
						}
						update := grouppricing.Update{Snapshot: initial, Baseline: maps.Clone(initial.Options), Renames: map[string]string{"public": "gpt"}}
						update.Options = maps.Clone(initial.Options)
						update.Options["GroupRatio"] = `{"gpt":0.3,"idle":0.4}`
						update.Options["GroupDisplayOrder"] = `["idle","gpt"]`
						update.Options["UserUsableGroups"] = `{"gpt":"Public","idle":"Idle"}`
						update.Options["AutoGroups"] = `["gpt"]`
						update.Options["GroupGroupRatio"] = `{"member":{"gpt":0.24}}`
						update.Promotions.Groups = []grouppricing.Group{{Group: "gpt", Promotion: &groupdiscount.Rule{Enabled: true, DailyPeriods: []groupdiscount.DailyPeriod{{Start: "18:00", End: "22:00", Ratio: 0.12}, {Start: "10:00", End: "11:00", Ratio: 0.03}}, Timezone: "Asia/Shanghai"}}}
						saved, err := grouppricing.Save(db, update)
						require.NoError(t, err)
						assert.Equal(t, initial.Promotions.Revision+1, saved.Promotions.Revision)
						assert.Equal(t, "10:00", saved.Promotions.Groups[0].Promotion.DailyPeriods[0].Start)
						for range 2 {
							require.NoError(t, grouppricing.Migrate(db))
						}
						reloaded, err := grouppricing.Read(db)
						require.NoError(t, err)
						assert.Equal(t, saved, reloaded)
						raw, err := common.Marshal(reloaded.Promotions)
						require.NoError(t, err)
						restarted := &groupdiscount.Runtime{}
						require.NoError(t, restarted.Load(string(raw)))
						assert.InDelta(t, 0.1, restarted.Capture(time.Date(2026, 11, 14, 2, 30, 0, 0, time.UTC))["gpt"], 1e-12)
						monitor, _, err := getSettings(db)
						require.NoError(t, err)
						require.Len(t, monitor.Groups, 2)
						assert.Equal(t, "idle", monitor.Groups[0].Group)
						assert.Equal(t, "gpt", monitor.Groups[1].Group)
						assert.Equal(t, "Preserve me", monitor.Groups[1].Description)
						assert.Equal(t, "OpenAI", monitor.Groups[1].Icon)
						if legacy {
							assert.Equal(t, []string{"text-test"}, monitor.Groups[1].ProbeModels)
							assert.Equal(t, &ProbeSettings{Enabled: true, IntervalMinutes: 60, DailyLimit: 100}, monitor.Probe)
						}
						assert.True(t, monitor.Enabled)
						at := time.Date(2026, 11, 14, 12, 0, 0, 0, time.UTC)
						assert.InDelta(t, 0.4, groupdiscount.Default.Capture(at)["gpt"], 1e-12)
						assert.Empty(t, groupdiscount.Default.Capture(at.Add(3*time.Hour)))
						_, err = grouppricing.Save(db, update)
						assert.ErrorIs(t, err, grouppricing.ErrConflict)
						invalid := grouppricing.Update{Snapshot: saved, Baseline: maps.Clone(saved.Options)}
						invalid.Options = maps.Clone(saved.Options)
						invalid.Options["GroupDisplayOrder"] = `["gpt","idle"]`
						invalid.Promotions = grouppricing.Promotions{Revision: saved.Promotions.Revision, Groups: []grouppricing.Group{{Group: "gpt", Promotion: &groupdiscount.Rule{DailyPeriods: []groupdiscount.DailyPeriod{{Start: "18:00", End: "22:00", Ratio: 0.12}, {Start: "21:00", End: "23:00", Ratio: 0.03}}}}}}
						_, err = grouppricing.Save(db, invalid)
						assert.ErrorIs(t, err, grouppricing.ErrInvalid)
						persisted, err := grouppricing.Read(db)
						require.NoError(t, err)
						assert.Equal(t, saved, persisted, "invalid schedule must roll back the pricing and order as well")
						_, err = saveSettings(db, Settings{Revision: monitor.Revision})
						require.NoError(t, err)
						persisted, err = grouppricing.Read(db)
						require.NoError(t, err)
						assert.Equal(t, saved.Promotions, persisted.Promotions, "removing monitoring must not delete pricing")
						remove := grouppricing.Update{Snapshot: saved, Baseline: maps.Clone(saved.Options)}
						remove.Promotions.Groups = []grouppricing.Group{}
						_, err = grouppricing.Save(db, remove)
						require.NoError(t, err)
						for range 2 {
							require.NoError(t, grouppricing.Migrate(db))
						}
						persisted, err = grouppricing.Read(db)
						require.NoError(t, err)
						assert.Empty(t, persisted.Promotions.Groups, "deleted legacy offers must never be resurrected")
						var unrelated model.Option
						require.NoError(t, db.Where(clause.Eq{Column: "key", Value: "unrelated"}).Take(&unrelated).Error)
						assert.Equal(t, "preserved", unrelated.Value)
					})
				}
			})
			t.Run("probes preserve legacy data and enforce idle scheduling, caps and traffic separation", func(t *testing.T) {
				monitorTestSettings(t)
				db := monitorTestDB(t, dialect, "")
				logs := monitorTestDB(t, dialect, "_LOG")
				// Upgrade a representative pre-probe installation, then restart twice.
				require.NoError(t, db.Migrator().DropTable(&ProbeRun{}))
				legacy := `{"revision":4,"enabled":true,"groups":[{"group":"public","display_name":"Preserved"}]}`
				require.NoError(t, db.Create(&model.Option{Key: settingsKey, Value: legacy}).Error)
				for range 2 {
					require.NoError(t, Migrate(db))
				}
				saved, raw, err := getSettings(db)
				require.NoError(t, err)
				assert.Equal(t, legacy, raw)
				assert.Equal(t, defaultProbeSettings(), saved.Probe)
				assert.True(t, db.Migrator().HasIndex(&ProbeRun{}, "idx_monitor_probe_target"))
				saved.Probe.Enabled = true
				saved.Groups[0].ProbeModels = []string{"text-test", "other-test", "removed"}
				saved, err = saveSettings(db, saved)
				require.NoError(t, err)
				for _, name := range []string{"text-test", "other-test"} {
					require.NoError(t, db.Create(&model.Ability{Group: "public", Model: name, ChannelId: 7, Enabled: true}).Error)
				}
				now := time.Unix(monitorEpoch, 0)
				clock := func() time.Time { return now }
				calls := []string{}
				handler := probeHandler{execute: func(ctx context.Context, group, name string) (ProbeResult, error) {
					calls = append(calls, group+"/"+name)
					return ProbeResult{ChannelID: 7, InputTokens: 8, OutputTokens: 1, TTFTMS: new(int64(200))}, nil
				}}
				task := &model.SystemTask{TaskID: "test-probe", Payload: `{}`}
				require.NoError(t, logs.Create(&model.Log{Group: "public", ModelName: "text-test", ChannelId: 7, Type: model.LogTypeError, CreatedAt: monitorEpoch - 10}).Error)
				for _, enabled := range []struct{ consume, errors bool }{{false, true}, {true, false}} {
					common.LogConsumeEnabled, constant.ErrorLogEnabled = enabled.consume, enabled.errors
					require.NoError(t, handler.run(context.Background(), db, logs, task, clock))
					assert.Empty(t, calls, "incomplete logging cannot establish idleness")
				}
				common.LogConsumeEnabled, constant.ErrorLogEnabled = true, true
				require.NoError(t, handler.run(context.Background(), db, logs, task, clock))
				assert.Equal(t, []string{"public/other-test"}, calls, "busy and removed routes must be skipped")
				require.NoError(t, handler.run(context.Background(), db, logs, task, clock))
				assert.Len(t, calls, 1, "already reserved targets must not run again")
				data, err := buildSnapshot(db, logs, "24h", 24*time.Hour, now.Unix())
				require.NoError(t, err)
				require.Len(t, data.Groups, 1)
				assert.Equal(t, "real", data.Groups[0].StatusSource)
				assert.Equal(t, "unhealthy", data.Groups[0].Status)
				assert.Equal(t, 1, data.Summary.Outcomes)
				require.NotNil(t, data.Groups[0].SuccessRate)
				assert.Zero(t, *data.Groups[0].SuccessRate, "successful probes never dilute real failures")
				require.NotNil(t, data.Groups[0].ProbeSummary)
				assert.Equal(t, 1, data.Groups[0].ProbeSummary.Samples)
				assert.Nil(t, data.Groups[0].TokensPerSecond)
				assert.Nil(t, data.Groups[0].CacheHitRate)
				// Without real traffic, a partial successful sample is explicitly unknown.
				require.NoError(t, logs.Where("1 = 1").Delete(&model.Log{}).Error)
				clear(statisticsCache.entries)
				data, err = buildSnapshot(db, logs, "24h", 24*time.Hour, now.Unix())
				require.NoError(t, err)
				assert.Equal(t, "probe", data.Groups[0].StatusSource)
				assert.Equal(t, "unknown", data.Groups[0].Status)
				assert.Zero(t, data.Summary.Outcomes)
				assert.Nil(t, data.Groups[0].SuccessRate)
				assert.Equal(t, new(0.2), data.Groups[0].ProbeSummary.TTFTSeconds)
				assert.Equal(t, "probe", data.Groups[0].Timeline[len(data.Groups[0].Timeline)-1].Source)
				// A manual request ignores idleness and the automatic switch, but not cooldown/cap.
				saved.Probe.Enabled = false
				saved, err = saveSettings(db, saved)
				require.NoError(t, err)
				require.NoError(t, handler.run(context.Background(), db, logs, task, clock))
				assert.Len(t, calls, 1, "disabling automatic probes stops scheduled work")
				task.Payload = `{"manual":true}`
				require.NoError(t, handler.run(context.Background(), db, logs, task, clock))
				assert.Equal(t, []string{"public/other-test", "public/text-test"}, calls)
				require.NoError(t, handler.run(context.Background(), db, logs, task, clock))
				assert.Len(t, calls, 2)
				now = now.Add(time.Minute)
				saved.Probe.DailyLimit = 2
				saved, err = saveSettings(db, saved)
				require.NoError(t, err)
				require.NoError(t, handler.run(context.Background(), db, logs, task, clock))
				assert.Len(t, calls, 2, "manual requests share the rolling cap")
				// Reservations survive restarts and count even when upstream completion is uncertain.
				require.NoError(t, db.Create(&ProbeRun{GroupName: "public", Model: "text-test", CreatedAt: now.Unix(), Status: "running", TaskID: "crashed"}).Error)
				require.NoError(t, handler.run(context.Background(), db, logs, task, clock))
				var interrupted ProbeRun
				require.NoError(t, db.Where("task_id = ?", "crashed").Take(&interrupted).Error)
				assert.Equal(t, "interrupted", interrupted.Status)
				for range 2 {
					require.NoError(t, Migrate(db))
				}
				var count int64
				require.NoError(t, db.Model(&ProbeRun{}).Count(&count).Error)
				assert.EqualValues(t, 3, count)
				// Cap expires after 24h; cancellation is recorded and stops subsequent targets.
				now = now.Add(24 * time.Hour)
				ctx, cancel := context.WithCancel(context.Background())
				handler.execute = func(ctx context.Context, _, _ string) (ProbeResult, error) {
					cancel()
					return ProbeResult{}, context.Canceled
				}
				assert.ErrorIs(t, handler.run(ctx, db, logs, task, clock), context.Canceled)
				require.NoError(t, db.Model(&ProbeRun{}).Where("status = ?", "interrupted").Count(&count).Error)
				assert.EqualValues(t, 2, count)
				data, err = buildSnapshot(db, logs, "24h", 24*time.Hour, now.Unix())
				require.NoError(t, err)
				assert.Equal(t, "idle", data.Groups[0].Status, "stale probes must not imply current availability")
			})
			t.Run("settings persist atomically and stale or invalid edits leave saved values intact", func(t *testing.T) {
				monitorTestSettings(t)
				db := monitorTestDB(t, dialect, "")
				initial, _, err := getSettings(db)
				require.NoError(t, err)
				assert.False(t, initial.Enabled)
				assert.Empty(t, initial.Groups)
				require.NoError(t, db.Create(&model.Option{Key: "unrelated", Value: "preserved"}).Error)
				legacy := `{"revision":0,"enabled":false,"groups":[{"group":"public","promotion":{"enabled":true,"factor":0.8}}]}`
				require.NoError(t, db.Create(&model.Option{Key: settingsKey, Value: legacy}).Error)
				require.NoError(t, grouppricing.Migrate(db))
				var promotion model.Option
				require.NoError(t, db.Where("value <> ?", legacy).Where(clause.Eq{Column: "key", Value: groupdiscount.OptionKey}).Take(&promotion).Error)
				require.NoError(t, groupdiscount.Default.Load(promotion.Value))
				settings := Settings{Enabled: true, Groups: []GroupSettings{{Group: "public", DisplayName: " Public ", Badge: " Discount ", Icon: " Claude.Color "}}}
				saved, err := saveSettings(db, settings)
				require.NoError(t, err)
				assert.EqualValues(t, 1, saved.Revision)
				assert.Equal(t, "Public", saved.Groups[0].DisplayName)
				assert.Equal(t, "Claude.Color", saved.Groups[0].Icon)
				_, err = saveSettings(db, settings)
				assert.ErrorIs(t, err, errConflict)
				for _, invalid := range []Settings{
					{Revision: -1}, {Revision: math.MaxInt64},
					{Groups: []GroupSettings{{Group: "public"}, {Group: "public"}}},
					{Groups: []GroupSettings{{Group: "unknown"}}}, {Groups: []GroupSettings{{Group: "auto"}}},
					{Groups: []GroupSettings{{Group: "public", Badge: strings.Repeat("x", 25)}}},
					{Groups: []GroupSettings{{Group: "public", Icon: strings.Repeat("x", 129)}}},
					{Groups: []GroupSettings{{Group: "public", Promotion: &groupdiscount.Rule{Factor: 0}}}},
					{Groups: make([]GroupSettings, 25)},
					{Probe: &ProbeSettings{IntervalMinutes: 1, DailyLimit: 1}},
					{Probe: &ProbeSettings{IntervalMinutes: 30, DailyLimit: 5001}},
					{Enabled: true, Probe: &ProbeSettings{Enabled: true, IntervalMinutes: 30, DailyLimit: 10}},
					{Groups: []GroupSettings{{Group: "public", ProbeModels: []string{"a", "a"}}}},
				} {
					_, err = saveSettings(db, invalid)
					assert.ErrorIs(t, err, errInvalid)
				}
				persisted, _, err := getSettings(db)
				require.NoError(t, err)
				assert.Equal(t, saved, persisted)
				var option model.Option
				require.NoError(t, db.Where("value = ?", "preserved").Take(&option).Error)
				assert.Equal(t, "unrelated", option.Key)
				assert.InDelta(t, 0.24, service.GetUserGroupRatio("other-member", "public"), 1e-12)
				assert.InDelta(t, 0.192, service.GetUserGroupRatio("member", "public"), 1e-12)
				assert.Error(t, model.UpdateOption(settingsKey, `{}`), "generic options must not bypass discount validation")
				// No new schema is required. Repeated startup loads preserve existing
				// options, the revision and the active pricing rule on all engines.
				for range 2 {
					require.NoError(t, db.AutoMigrate(&model.Option{}, &model.Ability{}))
					require.NoError(t, grouppricing.Migrate(db))
					persisted, _, err := getSettings(db)
					require.NoError(t, err)
					assert.Equal(t, saved, persisted)
					require.NoError(t, groupdiscount.Default.Load(promotion.Value))
				}
			})
			t.Run("real logs yield measured metrics and unknown unobserved buckets", func(t *testing.T) {
				logs := monitorTestDB(t, dialect, "_LOG")
				monitorLogs(t, logs)
				stats, err := collectStats(logs, "public", time.Hour, monitorEpoch, true)
				require.NoError(t, err)
				assert.Equal(t, 4, stats.Outcomes)
				assert.Equal(t, 2, stats.Successes)
				require.NotNil(t, stats.SuccessRate)
				assert.Equal(t, 50.0, *stats.SuccessRate)
				require.NotNil(t, stats.TTFTSeconds)
				assert.Equal(t, 1.0, *stats.TTFTSeconds)
				require.NotNil(t, stats.TokensPerSecond)
				assert.Equal(t, 26.0, *stats.TokensPerSecond)
				require.NotNil(t, stats.CacheHitRate)
				assert.Equal(t, 22.5, *stats.CacheHitRate)
				assert.Equal(t, 2, stats.CacheSamples)
				require.Len(t, stats.Models, 2)
				assert.Equal(t, "claude-test", stats.Models[0].Model)
				assert.Equal(t, 1, stats.Models[0].Outcomes)
				assert.Equal(t, "openai-test", stats.Models[1].Model)
				assert.Equal(t, 3, stats.Models[1].Outcomes)
				require.Len(t, stats.Timeline, 49)
				assert.Equal(t, "unknown", stats.Timeline[0].Status)
				assert.Nil(t, stats.Timeline[0].SuccessRate)
				total := 0
				for _, bucket := range stats.Timeline {
					total += bucket.Outcomes
				}
				assert.Equal(t, 4, total)
				unreliable, err := collectStats(logs, "public", time.Hour, monitorEpoch, false)
				require.NoError(t, err)
				assert.Nil(t, unreliable.SuccessRate)
				for _, bucket := range unreliable.Timeline {
					assert.Equal(t, "unknown", bucket.Status)
				}
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				_, err = collectStats(logs.WithContext(ctx), "public", time.Hour, monitorEpoch, true)
				assert.ErrorIs(t, err, context.Canceled)
			})
			t.Run("history uses fixed clock boundaries without losing the rolling window or live requests", func(t *testing.T) {
				logs := monitorTestDB(t, dialect, "_LOG")
				boundary := time.Date(2026, 11, 17, 4, 0, 0, 0, time.UTC).Unix()
				start := boundary - 24*3600 + 120
				for i, at := range []int64{start - 1, start, boundary - 1, boundary, boundary + 120, boundary + 121} {
					require.NoError(t, logs.Create(&model.Log{
						Group: "public", ChannelId: 7, Type: model.LogTypeConsume,
						ModelName: "test", CreatedAt: at, RequestId: fmt.Sprint(i),
					}).Error)
				}
				stats, err := collectStats(logs, "public", 24*time.Hour, boundary+120, true)
				require.NoError(t, err)
				assert.Equal(t, start, stats.ObservedFrom)
				assert.Equal(t, 4, stats.Outcomes, "exclude older and future logs from the unchanged rolling window")
				require.Len(t, stats.Timeline, 49)
				assert.Equal(t, 1, stats.Timeline[0].Outcomes)
				assert.Equal(t, 1, stats.Timeline[47].Outcomes)
				assert.Equal(t, 2, stats.Timeline[48].Outcomes)
				for _, bucket := range stats.Timeline {
					assert.Zero(t, bucket.Start%1800, "24-hour history starts at whole or half hours")
					assert.Equal(t, int64(1800), bucket.End-bucket.Start)
				}
				later, err := collectStats(logs, "public", 24*time.Hour, boundary+180, true)
				require.NoError(t, err)
				assert.Equal(t, stats.Timeline[48].Start, later.Timeline[48].Start, "refreshing does not move the clock boundaries")
				assert.Equal(t, 3, later.Timeline[48].Outcomes)
				exact, err := collectStats(logs, "public", 24*time.Hour, boundary, true)
				require.NoError(t, err)
				require.Len(t, exact.Timeline, 49)
				assert.Equal(t, boundary, exact.Timeline[48].Start)
				assert.Equal(t, 1, exact.Timeline[48].Outcomes, "a request at the boundary belongs to the new period")
			})
			t.Run("published private groups are visible without granting routing access or exposing request details", func(t *testing.T) {
				monitorTestSettings(t)
				db, logs := monitorTestDB(t, dialect, ""), monitorTestDB(t, dialect, "_LOG")
				monitorLogs(t, logs)
				require.NoError(t, db.Create(&[]model.Ability{{Group: "public", Model: "openai-test", ChannelId: 7, Enabled: true}, {Group: "public", Model: "no-traffic-model", ChannelId: 8, Enabled: true}, {Group: "idle", Model: "idle-model", ChannelId: 7, Enabled: true}, {Group: "private", Model: "private-model", ChannelId: 8, Enabled: true}}).Error)
				require.NoError(t, logs.Create(&model.Log{Group: "unpublished", ChannelId: 9, CreatedAt: monitorEpoch - 20, Type: model.LogTypeConsume, ModelName: "unpublished-model"}).Error)
				usableBefore := setting.UserUsableGroups2JSONString()
				assert.False(t, service.IsUserSelectableGroup("member", "private"))
				_, err := saveSettings(db, Settings{Enabled: true, Groups: []GroupSettings{{Group: "private"}, {Group: "public", Icon: "OpenAI"}, {Group: "idle"}, {Group: "disabled"}}})
				require.NoError(t, err)
				data, err := buildSnapshot(db, logs, "1h", time.Hour, monitorEpoch)
				require.NoError(t, err)
				require.Len(t, data.Groups, 4)
				assert.Equal(t, "public", data.Groups[0].Group)
				assert.Equal(t, "OpenAI", data.Groups[0].Icon)
				assert.Equal(t, 0.3, data.Groups[0].Ratio)
				assert.Equal(t, 0.3, data.Groups[0].BaseRatio)
				assert.Equal(t, "unhealthy", data.Groups[0].Status)
				assert.Equal(t, "idle", data.Groups[1].Status)
				assert.Equal(t, "disabled", data.Groups[2].Status)
				assert.Nil(t, data.Groups[1].SuccessRate)
				assert.Equal(t, "private", data.Groups[3].Group)
				assert.Equal(t, "healthy", data.Groups[3].Status)
				assert.Equal(t, 1, data.Groups[3].Outcomes)
				require.Len(t, data.Groups[3].Models, 1)
				assert.Equal(t, "private-model", data.Groups[3].Models[0].Model)
				assert.Equal(t, 5, data.Summary.Outcomes)
				require.NotNil(t, data.Summary.TokensPerSecond)
				assert.Equal(t, 26.0, *data.Summary.TokensPerSecond)
				require.Len(t, data.Groups[0].Models, 3)
				assert.False(t, data.Groups[0].Models[0].Enabled, "historical model no longer has an enabled route")
				assert.True(t, data.Groups[0].Models[1].Enabled)
				assert.Nil(t, data.Groups[0].Models[1].SuccessRate, "an enabled model without traffic is not measured healthy")
				encoded, err := common.Marshal(data)
				require.NoError(t, err)
				for _, secret := range []string{"unpublished", "private-username", "private-request", "private-response", "private-diagnostics", "192.0.2.123", "channel_id", "user_id", "token_id", "admin_info"} {
					assert.NotContains(t, string(encoded), secret)
				}
				assert.Equal(t, usableBefore, setting.UserUsableGroups2JSONString())
				assert.False(t, service.IsUserSelectableGroup("member", "private"))
				assert.Equal(t, []string{"public"}, service.GetUserAutoGroup("member"))
				other, err := buildSnapshot(db, logs, "1h", time.Hour, monitorEpoch+1)
				require.NoError(t, err)
				assert.Equal(t, 0.3, other.Groups[0].Ratio)
				require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(`{"member":{"public":0.18}}`))
				require.NoError(t, db.Model(&model.Ability{}).Where("enabled = ?", true).Update("enabled", false).Error)
				current, err := buildSnapshot(db, logs, "1h", time.Hour, monitorEpoch+2)
				require.NoError(t, err)
				assert.Equal(t, 0.3, current.Groups[0].Ratio)
				assert.Equal(t, "disabled", current.Groups[0].Status)
				require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"idle":"Idle"}`))
				current, err = buildSnapshot(db, logs, "1h", time.Hour, monitorEpoch+3)
				require.NoError(t, err)
				assert.Len(t, current.Groups, 4, "changing selectable groups must not change monitor publication")
				settings, _, err := getSettings(db)
				require.NoError(t, err)
				settings.Groups = []GroupSettings{{Group: "idle"}}
				_, err = saveSettings(db, settings)
				require.NoError(t, err)
				current, err = buildSnapshot(db, logs, "1h", time.Hour, monitorEpoch+4)
				require.NoError(t, err)
				require.Len(t, current.Groups, 1, "unpublishing a group takes effect even when its statistics are cached")
				assert.Equal(t, "idle", current.Groups[0].Group)
			})
			t.Run("persisted discount survives expiry through token settlement and refund", func(t *testing.T) {
				monitorTestSettings(t)
				db, logs := monitorTestDB(t, dialect, ""), monitorTestDB(t, dialect, "_LOG")
				for _, table := range []any{&model.Task{}, &model.User{}, &model.Token{}, &model.Channel{}} {
					require.NoError(t, db.Migrator().DropTable(table))
					require.NoError(t, db.AutoMigrate(table))
				}
				previousDB, previousLogs := model.DB, model.LOG_DB
				previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
				previousRedis, previousBatch := common.RedisEnabled, common.BatchUpdateEnabled
				previousRatios := ratio_setting.ModelRatio2JSONString()
				model.DB, model.LOG_DB, common.RedisEnabled, common.BatchUpdateEnabled = db, logs, false, false
				common.SetDatabaseTypes(common.DatabaseType(dialect), common.DatabaseType(dialect))
				t.Cleanup(func() {
					model.DB, model.LOG_DB = previousDB, previousLogs
					common.RedisEnabled, common.BatchUpdateEnabled = previousRedis, previousBatch
					common.SetDatabaseTypes(previousMain, previousLog)
					require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(previousRatios))
				})
				require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"monitor-billing":1}`))
				require.NoError(t, db.Create(&model.User{Id: 91, Username: "discount-billing", AffCode: "discount-billing", Group: "public", Quota: 940, UsedQuota: 60, RequestCount: 1}).Error)
				require.NoError(t, db.Create(&model.Token{Id: 91, UserId: 91, Key: "discount-token", RemainQuota: 940, UsedQuota: 60}).Error)
				require.NoError(t, db.Create(&model.Channel{Id: 91, Name: "discount-channel", Key: "unused", UsedQuota: 60}).Error)
				task := model.Task{TaskID: "discount-settlement", UserId: 91, ChannelId: 91, Group: "public", Quota: 60,
					Properties: model.Properties{OriginModelName: "monitor-billing"},
					PrivateData: model.TaskPrivateData{TokenId: 91, BillingSource: service.BillingSourceWallet,
						BillingContext: &model.TaskBillingContext{OriginModelName: "monitor-billing", GroupRatio: 0.24}}}
				require.NoError(t, db.Create(&task).Error)
				var restored model.Task
				require.NoError(t, db.First(&restored, task.ID).Error)
				// At completion the public discount is no longer active and the
				// configured base has changed; neither may rewrite this task's price.
				require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"public":2}`))
				require.True(t, service.RecalculateTaskQuotaByTokens(context.Background(), &restored, 100))
				assert.Equal(t, 24, restored.Quota)
				var user model.User
				var token model.Token
				var channel model.Channel
				require.NoError(t, db.First(&user, 91).Error)
				require.NoError(t, db.First(&token, 91).Error)
				require.NoError(t, db.First(&channel, 91).Error)
				assert.Equal(t, 976, user.Quota)
				assert.Equal(t, 24, user.UsedQuota)
				assert.Equal(t, 1, user.RequestCount)
				assert.Equal(t, 976, token.RemainQuota)
				assert.Equal(t, 24, token.UsedQuota)
				assert.Equal(t, int64(24), channel.UsedQuota)
				require.True(t, service.RecalculateTaskQuotaByTokens(context.Background(), &restored, 100))
				require.True(t, service.RefundTaskQuota(context.Background(), &restored, "upstream result discarded"))
				require.True(t, service.RefundTaskQuota(context.Background(), &restored, "repeat refund"))
				require.NoError(t, db.First(&user, 91).Error)
				require.NoError(t, db.First(&token, 91).Error)
				require.NoError(t, db.First(&channel, 91).Error)
				assert.Equal(t, 1000, user.Quota)
				assert.Zero(t, user.UsedQuota)
				assert.Equal(t, 1000, token.RemainQuota)
				assert.Zero(t, token.UsedQuota)
				assert.Zero(t, channel.UsedQuota)
			})
			t.Run("high traffic is capped and explicitly marked as a recent sample", func(t *testing.T) {
				logs := monitorTestDB(t, dialect, "_LOG")
				rows := make([]model.Log, sampleLimit+1)
				for i := range rows {
					rows[i] = model.Log{Group: "public", ChannelId: 7, ModelName: "sample-model", Type: model.LogTypeConsume, CreatedAt: monitorEpoch - 200, RequestId: fmt.Sprintf("sample-%05d", i)}
				}
				rows[0].CreatedAt, rows[0].Type = monitorEpoch-300, model.LogTypeError
				require.NoError(t, logs.CreateInBatches(rows, 100).Error)
				stats, err := collectStats(logs, "public", time.Hour, monitorEpoch, true)
				require.NoError(t, err)
				assert.True(t, stats.SampleLimited)
				assert.Equal(t, sampleLimit, stats.Outcomes)
				assert.Equal(t, monitorEpoch-200, stats.ObservedFrom)
				require.NotNil(t, stats.SuccessRate)
				assert.Equal(t, 100.0, *stats.SuccessRate)
			})
			t.Run("automatic routing failures count against the selected group", func(t *testing.T) {
				monitorTestSettings(t)
				db, logs := monitorTestDB(t, dialect, ""), monitorTestDB(t, dialect, "_LOG")
				require.NoError(t, db.Migrator().DropTable(&model.User{}))
				require.NoError(t, db.AutoMigrate(&model.User{}))
				require.NoError(t, db.Create(&model.User{Id: 7, Username: "monitor-log-owner", AffCode: "monitor-log-owner", Group: "member"}).Error)
				oldDB, oldLog, oldRedis := model.DB, model.LOG_DB, common.RedisEnabled
				oldMainType, oldLogType := common.MainDatabaseType(), common.LogDatabaseType()
				model.DB, model.LOG_DB, common.RedisEnabled = db, logs, false
				common.SetDatabaseTypes(common.DatabaseType(dialect), common.DatabaseType(dialect))
				t.Cleanup(func() {
					model.DB, model.LOG_DB, common.RedisEnabled = oldDB, oldLog, oldRedis
					common.SetDatabaseTypes(oldMainType, oldLogType)
				})
				for i, attempt := range []struct {
					relay        *relaycommon.RelayInfo
					contextGroup string
				}{
					{relay: &relaycommon.RelayInfo{UsingGroup: "public"}, contextGroup: "stale-group"},
					{contextGroup: "public"},
				} {
					c, _ := gin.CreateTestContext(httptest.NewRecorder())
					c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
					c.Set("id", 7)
					c.Set("username", "monitor-log-owner")
					c.Set("original_model", "auto-model")
					c.Set("group", "auto")
					c.Set(common.RequestIdKey, fmt.Sprintf("auto-monitor-%d", i))
					common.SetContextKey(c, constant.ContextKeyUsingGroup, attempt.contextGroup)
					apiErr := types.NewOpenAIError(errors.New("upstream failed"), types.ErrorCodeBadResponseStatusCode, http.StatusBadGateway)
					service.ProcessChannelError(c, types.ChannelError{ChannelId: 7}, apiErr, attempt.relay)
				}
				stats, err := collectStats(logs, "public", time.Hour, time.Now().Unix(), true)
				require.NoError(t, err)
				assert.Equal(t, 2, stats.Outcomes)
				require.NotNil(t, stats.SuccessRate)
				assert.Zero(t, *stats.SuccessRate)
			})
		})
	}
}

func TestPublicGroupDiscountSchedules(t *testing.T) {
	monitorTestSettings(t)
	location, err := time.LoadLocation("Asia/Shanghai")
	require.NoError(t, err)
	start := time.Date(2026, 11, 8, 0, 0, 0, 0, location).Unix()
	for _, tc := range []struct {
		name      string
		rule      groupdiscount.Rule
		at        int64
		active    bool
		next, end int64
	}{
		{"long term", groupdiscount.Rule{Enabled: true, Factor: 0.8}, start, true, 0, 0},
		{"disabled", groupdiscount.Rule{Factor: 0.8}, start, false, 0, 0},
		{"before absolute start", groupdiscount.Rule{Enabled: true, Factor: 0.8, StartsAt: start + 60, EndsAt: start + 120}, start, false, start + 60, start + 120},
		{"at start", groupdiscount.Rule{Enabled: true, Factor: 0.8, StartsAt: start, EndsAt: start + 120}, start, true, 0, start + 120},
		{"at expiry", groupdiscount.Rule{Enabled: true, Factor: 0.8, EndsAt: start}, start, false, 0, 0},
		{"before daily start", groupdiscount.Rule{Enabled: true, Factor: 0.8, DailyStart: "09:00", DailyEnd: "12:00"}, start + 8*3600, false, start + 9*3600, start + 12*3600},
		{"at daily start", groupdiscount.Rule{Enabled: true, Factor: 0.8, DailyStart: "09:00", DailyEnd: "12:00"}, start + 9*3600, true, 0, start + 12*3600},
		{"at daily end", groupdiscount.Rule{Enabled: true, Factor: 0.8, DailyStart: "09:00", DailyEnd: "12:00"}, start + 12*3600, false, start + 33*3600, start + 36*3600},
		{"overnight after midnight", groupdiscount.Rule{Enabled: true, Factor: 0.8, DailyStart: "22:00", DailyEnd: "02:00"}, start + 3600, true, 0, start + 2*3600},
		{"absolute bounds clip overnight window", groupdiscount.Rule{Enabled: true, Factor: 0.8, DailyStart: "22:00", DailyEnd: "02:00", StartsAt: start, EndsAt: start + 3600}, start, true, 0, start + 3600},
		{"future date inside daily window", groupdiscount.Rule{Enabled: true, Factor: 0.8, DailyStart: "09:00", DailyEnd: "12:00", StartsAt: start + 30*86400 + 10*3600}, start, false, start + 30*86400 + 10*3600, start + 30*86400 + 12*3600},
		{"daily window uses selected zone", groupdiscount.Rule{Enabled: true, Factor: 0.8, DailyStart: "00:00", DailyEnd: "02:00", Timezone: "UTC"}, start + 8*3600, true, 0, start + 10*3600},
	} {
		t.Run(tc.name, func(t *testing.T) {
			runtime := &groupdiscount.Runtime{}
			raw, err := common.Marshal(Settings{Revision: 1, Groups: []GroupSettings{{Group: "public", Promotion: &tc.rule}}})
			require.NoError(t, err)
			require.NoError(t, runtime.Load(string(raw)))
			offer := runtime.Offers(time.Unix(tc.at, 0))["public"]
			assert.Equal(t, tc.active, offer.Active)
			assert.Equal(t, tc.next, offer.NextStart)
			assert.Equal(t, tc.end, offer.EndsAt)
			factors := runtime.Capture(time.Unix(tc.at, 0))
			if tc.active {
				assert.Equal(t, 0.8, factors["public"])
			} else {
				assert.NotContains(t, factors, "public")
			}
		})
	}
	for _, rule := range []groupdiscount.Rule{
		{Factor: 0}, {Factor: -0.1}, {Factor: 1.1}, {Factor: math.NaN()}, {Factor: math.Inf(1)},
		{Factor: 0.8, StartsAt: 2, EndsAt: 1}, {Factor: 0.8, StartsAt: -1},
		{Factor: 0.8, Timezone: "Not/AZone"}, {Factor: 0.8, DailyStart: "9:00", DailyEnd: "10:00"},
		{Factor: 0.8, DailyStart: "24:00", DailyEnd: "10:00"}, {Factor: 0.8, DailyStart: "09:00"},
		{Factor: 0.8, DailyStart: "09:00", DailyEnd: "09:00"},
	} {
		_, err := groupdiscount.Normalize(rule)
		assert.Error(t, err)
	}
}

func TestPublicGroupDiscountPeriodPresentation(t *testing.T) {
	monitorTestSettings(t)
	location, err := time.LoadLocation("Asia/Shanghai")
	require.NoError(t, err)
	day := time.Date(2026, 11, 14, 0, 0, 0, 0, location).Unix()
	deadline := time.Date(2026, 11, 30, 23, 0, 0, 0, location).Unix()
	rule := groupdiscount.Rule{Enabled: true, Factor: 0.1, DailyStart: "21:00", DailyEnd: "22:00", EndsAt: deadline}
	for _, tc := range []struct {
		name            string
		rule            groupdiscount.Rule
		at, from, until int64
		nextFactor      float64
	}{
		{"discounted period ends today", rule, day + 21*3600 + 1800, day + 21*3600, day + 22*3600, 1},
		{"regular period ends tomorrow", rule, day + 22*3600 + 1800, day + 22*3600, day + 45*3600, 0.1},
		{"regular period before today's offer", rule, day + 20*3600, day - 2*3600, day + 21*3600, 0.1},
		{"deadline cuts short current discount", groupdiscount.Rule{Enabled: true, Factor: 0.1, DailyStart: "21:00", DailyEnd: "22:00", EndsAt: day + 21*3600 + 2700}, day + 21*3600 + 1800, day + 21*3600, day + 21*3600 + 2700, 1},
		{"no next offer after deadline", groupdiscount.Rule{Enabled: true, Factor: 0.1, DailyStart: "21:00", DailyEnd: "22:00", EndsAt: day + 23*3600}, day + 22*3600, day + 22*3600, 0, 1},
		{"no transition after expiry", rule, deadline, deadline, 0, 1},
		{"overnight current period", groupdiscount.Rule{Enabled: true, Factor: 0.1, DailyStart: "22:00", DailyEnd: "02:00"}, day + 3600, day - 2*3600, day + 2*3600, 1},
		{"future campaign clips next period start", groupdiscount.Rule{Enabled: true, Factor: 0.1, DailyStart: "21:00", DailyEnd: "22:00", StartsAt: day + 30*86400 + 21*3600 + 1800}, day, 0, day + 30*86400 + 21*3600 + 1800, 0.1},
		{"absolute offer has its own deadline", groupdiscount.Rule{Enabled: true, Factor: 0.1, StartsAt: day - 3600, EndsAt: deadline}, day, day - 3600, deadline, 1},
		{"UTC schedule does not use server timezone", groupdiscount.Rule{Enabled: true, Factor: 0.1, DailyStart: "21:00", DailyEnd: "22:00", Timezone: "UTC"}, day + 28*3600, day + 6*3600, day + 29*3600, 0.1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			runtime := &groupdiscount.Runtime{}
			raw, err := common.Marshal(Settings{Revision: 1, Groups: []GroupSettings{{Group: "public", Promotion: &tc.rule}}})
			require.NoError(t, err)
			require.NoError(t, runtime.Load(string(raw)))
			offer := runtime.Offers(time.Unix(tc.at, 0))["public"]
			require.NotNil(t, offer.Schedule)
			assert.Equal(t, tc.at, offer.Schedule.EvaluatedAt)
			assert.Equal(t, tc.rule.StartsAt, offer.Schedule.StartsAt)
			assert.Equal(t, tc.rule.EndsAt, offer.Schedule.EndsAt)
			assert.Equal(t, tc.rule.DailyStart, offer.Schedule.DailyStart)
			assert.Equal(t, tc.rule.DailyEnd, offer.Schedule.DailyEnd)
			assert.Equal(t, tc.from, offer.Schedule.PeriodStart)
			assert.Equal(t, tc.until, offer.Schedule.PeriodEnd)
			assert.Equal(t, tc.nextFactor, offer.Schedule.NextFactor)
		})
	}
}

func TestPublicDiscountPricingFreezesAllRetryGroups(t *testing.T) {
	monitorTestSettings(t)
	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error { saved[key] = value; return nil }))
	t.Cleanup(func() { require.NoError(t, config.GlobalConfig.LoadFromDB(saved)) })
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode": `{"discount-expr":"tiered_expr"}`,
		"billing_setting.billing_expr": `{"discount-expr":"p * 2"}`,
	}))
	prices := ratio_setting.ModelPrice2JSONString()
	ratios := ratio_setting.ModelRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(prices))
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(ratios))
	})
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"discount-call":0.01}`))
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"discount-token":1}`))
	require.NoError(t, groupdiscount.Default.Load(`{"revision":1,"enabled":false,"groups":[{"group":"public","promotion":{"enabled":true,"factor":0.8}},{"group":"private","promotion":{"enabled":true,"factor":0.5}}]}`))
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	info := &relaycommon.RelayInfo{UserGroup: "other", UsingGroup: "public"}
	assert.InDelta(t, 0.24, helper.HandleGroupRatio(c, info).GroupRatio, 1e-12)
	require.NoError(t, groupdiscount.Default.Load(`{"revision":2,"groups":[]}`))
	require.NoError(t, groupdiscount.Default.Load(`{"revision":1,"groups":[{"group":"public","promotion":{"enabled":true,"factor":0.1}}]}`))
	assert.Empty(t, groupdiscount.Default.Capture(time.Now()), "late options load cannot revive an older discount")
	assert.InDelta(t, 0.24, helper.HandleGroupRatio(c, info).GroupRatio, 1e-12)
	c.Set("auto_group", "private")
	assert.InDelta(t, 0.25, helper.HandleGroupRatio(c, info).GroupRatio, 1e-12)
	c.Set("auto_group", "public")
	assert.InDelta(t, 0.3, helper.HandleGroupRatio(c, &relaycommon.RelayInfo{UserGroup: "other"}).GroupRatio, 1e-12)
	for _, name := range []string{"discount-token", "discount-call", "discount-expr"} {
		request := &relaycommon.RelayInfo{UserGroup: "other", UsingGroup: "public", OriginModelName: name, GroupDiscounts: info.GroupDiscounts}
		price, err := helper.ModelPriceHelper(c, request, 1000, &types.TokenCountMeta{})
		require.NoError(t, err)
		assert.InDelta(t, 0.24, price.GroupRatioInfo.GroupRatio, 1e-12)
		if request.TieredBillingSnapshot != nil {
			assert.InDelta(t, 0.24, request.TieredBillingSnapshot.GroupRatio, 1e-12)
			ok, quota, _ := service.TryTieredSettle(request, billingexpr.TokenParams{P: 1000})
			require.True(t, ok)
			assert.Equal(t, 240, quota)
		}
	}
	info.OriginModelName = "discount-call"
	call, err := helper.ModelPriceHelperPerCall(c, info)
	require.NoError(t, err)
	assert.Equal(t, 1200, call.Quota)
}

func TestChannelMonitorMeasurementBounds(t *testing.T) {
	for _, tc := range []struct {
		name, other string
		prompt      int
		want        *float64
	}{
		{"normalized Anthropic total is not counted twice", `{"cache_tokens":20,"cache_write_tokens":40,"input_tokens_total":100,"usage_semantic":"anthropic"}`, 100, new(20.0)},
		{"legacy cache creation is not duplicated", `{"cache_tokens":20,"cache_write_tokens":40,"cache_creation_tokens":40,"usage_semantic":"anthropic"}`, 40, new(20.0)},
		{"missing cache measurement stays unknown", `{}`, 100, nil},
		{"impossible cache measurement stays unknown", `{"cache_tokens":101}`, 100, nil},
		{"negative cache measurement stays unknown", `{"cache_tokens":-1}`, 100, nil},
		{"oversized cache total stays unknown", `{"cache_tokens":1,"input_tokens_total":1e100}`, 100, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var metadata logMetadata
			require.NoError(t, common.UnmarshalJsonStr(tc.other, &metadata))
			var metrics Metrics
			metrics.observe(model.Log{PromptTokens: tc.prompt}, metadata, true)
			metrics.finish(true)
			assert.Equal(t, tc.want, metrics.CacheHitRate)
			assert.Nil(t, metrics.TTFTSeconds)
		})
	}
}

func TestChannelMonitorAPIAuthorization(t *testing.T) {
	monitorTestSettings(t)
	db := monitorTestDB(t, "sqlite", "")
	logs := monitorTestDB(t, "sqlite", "_LOG")
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.UserAccessToken{}))
	require.NoError(t, logs.AutoMigrate(&model.AuditLog{}))
	for _, user := range []model.User{
		{Id: 1, Username: "monitor-member", AffCode: "monitor-one", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "member", AuthVersion: 1},
		{Id: 2, Username: "monitor-root", AffCode: "monitor-two", Role: common.RoleRootUser, Status: common.UserStatusEnabled, Group: "member", AuthVersion: 1},
	} {
		require.NoError(t, db.Create(&user).Error)
	}
	oldDB, oldLog, oldSecret, oldSecure := model.DB, model.LOG_DB, common.SessionSecret, common.SessionCookieSecure
	oldRedis, oldType := common.RedisEnabled, common.MainDatabaseType()
	model.DB, model.LOG_DB, common.SessionSecret, common.SessionCookieSecure = db, logs, "monitor-session-test-secret", true
	common.RedisEnabled = false
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		model.DB, model.LOG_DB, common.SessionSecret, common.SessionCookieSecure = oldDB, oldLog, oldSecret, oldSecure
		common.RedisEnabled = oldRedis
		common.SetMainDatabaseType(oldType)
	})
	member, err := service.CreateLoginSession(1, "password", "192.0.2.1", "monitor-test")
	require.NoError(t, err)
	root, err := service.CreateLoginSession(2, "password", "192.0.2.2", "monitor-test")
	require.NoError(t, err)
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterRoutes(router.Group("/api"))
	request := func(method, path, body, token, origin string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "https://panel.example.com/api/extensions/channel-monitor"+path, strings.NewReader(body))
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
	assert.Equal(t, http.StatusUnauthorized, request("GET", "/snapshot", "", "", "").Code)
	assert.Equal(t, http.StatusForbidden, request("GET", "/admin/settings", "", member.AccessToken, "").Code)
	assert.Equal(t, http.StatusUnauthorized, request("POST", "/admin/probe", "", "", "").Code)
	assert.Equal(t, http.StatusForbidden, request("POST", "/admin/probe", "", member.AccessToken, "").Code)
	assert.Equal(t, http.StatusForbidden, request("POST", "/admin/probe", "", root.AccessToken, "https://evil.example.com").Code)
	body := `{"revision":0,"enabled":true,"groups":[{"group":"public","display_name":"Public"},{"group":"private"}]}`
	assert.Equal(t, http.StatusForbidden, request("PUT", "/admin/settings", body, root.AccessToken, "https://evil.example.com").Code)
	assert.Contains(t, request("PUT", "/admin/settings", body, root.AccessToken, "https://panel.example.com").Body.String(), `"success":true`)
	assert.Contains(t, request("PUT", "/admin/settings", body, root.AccessToken, "https://panel.example.com").Body.String(), "Reload before saving")
	assert.Contains(t, request("GET", "/snapshot?window=invalid", "", member.AccessToken, "").Body.String(), `"success":false`)
	result := request("GET", "/snapshot?window=24h", "", member.AccessToken, "")
	assert.Contains(t, result.Body.String(), `"enabled":true`)
	assert.Contains(t, result.Body.String(), `"ratio":0.3`)
	assert.Contains(t, result.Body.String(), `"success_rate":null`)
	assert.NotContains(t, result.Body.String(), "monitor-root")
	var response struct {
		Data snapshot `json:"data"`
	}
	require.NoError(t, common.Unmarshal(result.Body.Bytes(), &response))
	require.Len(t, response.Data.Groups, 2)
	assert.Equal(t, "private", response.Data.Groups[1].Group)
	assert.False(t, service.IsUserSelectableGroup("member", "private"))
	legacy := "monitor-legacy-token"
	require.NoError(t, db.Model(&model.User{}).Where("id = ?", 2).Update("access_token", legacy).Error)
	oldDeadline := model.LegacyAccessTokenRetireAt()
	require.NoError(t, model.EnsureLegacyAccessTokenRetireAt(time.Now().Unix()))
	if oldDeadline > 0 {
		t.Cleanup(func() {
			require.NoError(t, db.Model(&model.Option{}).Where(clause.Eq{Column: "key", Value: "LegacyAccessTokenRetireAt"}).Update("value", fmt.Sprint(oldDeadline)).Error)
			require.NoError(t, model.EnsureLegacyAccessTokenRetireAt(time.Now().Unix()))
		})
	}
	raw := model.AccessTokenPrefix + strings.Repeat("m", 43)
	scoped := &model.UserAccessToken{Name: "monitor-scoped", TokenHash: model.AccessTokenFingerprint(raw), TokenHint: model.AccessTokenHint(raw)}
	require.NoError(t, scoped.SetScopes([]string{"profile:read", "option:read", "option:write"}))
	require.NoError(t, model.CreateUserAccessToken(2, scoped, service.AccessTokenMaxPerUser))
	for _, token := range []string{legacy, raw} {
		for _, endpoint := range []struct{ method, path string }{{"GET", "/snapshot"}, {"GET", "/admin/settings"}, {"PUT", "/admin/settings"}, {"POST", "/admin/probe"}} {
			response := request(endpoint.method, endpoint.path, body, token, "https://panel.example.com")
			assert.Equal(t, http.StatusForbidden, response.Code, response.Body.String())
			assert.Contains(t, response.Body.String(), "AUTH_SESSION_REQUIRED")
		}
	}
	revoked, err := model.RevokeUserSession(1, member.Session.SID, "monitor-test")
	require.NoError(t, err)
	require.True(t, revoked)
	assert.Equal(t, http.StatusUnauthorized, request("GET", "/snapshot", "", member.AccessToken, "").Code)
	require.NoError(t, db.Model(&model.UserSession{}).Where("sid = ?", root.Session.SID).Update("expires_at", time.Now().Unix()-1).Error)
	assert.Equal(t, http.StatusUnauthorized, request("GET", "/admin/settings", "", root.AccessToken, "").Code)
}

func TestFinalPublicMultiplier(t *testing.T) {
	monitorTestSettings(t)
	runtime := &groupdiscount.Runtime{}
	require.NoError(t, runtime.Load(`{"revision":1,"groups":[{"group":"public","promotion":{"enabled":true,"ratio":0.12}}]}`))
	assert.InDelta(t, 0.4, runtime.Capture(time.Unix(monitorEpoch, 0))["public"], 1e-12)
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"public":0.1}`))
	assert.Equal(t, 1.0, runtime.Capture(time.Unix(monitorEpoch, 0))["public"], "a falling base price must never turn a discount into a surcharge")
}

func TestMultipleDailyPublicMultipliers(t *testing.T) {
	monitorTestSettings(t)
	location, err := time.LoadLocation("Asia/Shanghai")
	require.NoError(t, err)
	day := time.Date(2026, 11, 17, 0, 0, 0, 0, location).Unix()
	periods := []groupdiscount.DailyPeriod{{Start: "17:00", End: "18:00", Ratio: 0.03}, {Start: "21:00", End: "22:00", Ratio: 0.01}}
	for _, tc := range []struct {
		name                  string
		periods               []groupdiscount.DailyPeriod
		at, start, end        int64
		factor                float64
		transition, nextOffer int64
		nextFactor            float64
	}{
		{"before first", periods, 16 * 3600, 0, 0, 1, 17 * 3600, 17 * 3600, 0.1},
		{"first start included", periods, 17 * 3600, 0, 0, 0.1, 18 * 3600, 21 * 3600, 1},
		{"first end excluded", periods, 18 * 3600, 0, 0, 1, 21 * 3600, 21 * 3600, 1.0 / 30},
		{"second start included", periods, 21 * 3600, 0, 0, 1.0 / 30, 22 * 3600, 41 * 3600, 1},
		{"tomorrow first period", periods, 22 * 3600, 0, 0, 1, 41 * 3600, 41 * 3600, 0.1},
		{"clip campaign start", periods, 16 * 3600, 17*3600 + 1800, 0, 1, 17*3600 + 1800, 17*3600 + 1800, 0.1},
		{"clip campaign end", periods, 17 * 3600, 0, 17*3600 + 1800, 0.1, 17*3600 + 1800, 0, 1},
		{"expired", periods, 18 * 3600, 0, 18 * 3600, 1, 0, 0, 1},
		{"future campaign", periods, 0, 30*86400 + 21*3600 + 1800, 0, 1, 30*86400 + 21*3600 + 1800, 30*86400 + 21*3600 + 1800, 1.0 / 30},
		{"adjacent transitions", []groupdiscount.DailyPeriod{{Start: "17:00", End: "18:00", Ratio: 0.03}, {Start: "18:00", End: "19:00", Ratio: 0.01}}, 17 * 3600, 0, 0, 0.1, 18 * 3600, 18 * 3600, 1.0 / 30},
		{"overnight after midnight", []groupdiscount.DailyPeriod{{Start: "22:00", End: "02:00", Ratio: 0.03}, {Start: "02:00", End: "03:00", Ratio: 0.01}}, 3600, 0, 0, 0.1, 2 * 3600, 2 * 3600, 1.0 / 30},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rule := groupdiscount.Rule{Enabled: true, DailyPeriods: tc.periods, Timezone: "Asia/Shanghai"}
			if tc.start > 0 {
				rule.StartsAt = day + tc.start
			}
			if tc.end > 0 {
				rule.EndsAt = day + tc.end
			}
			raw, err := common.Marshal(grouppricing.Promotions{Revision: 1, Groups: []grouppricing.Group{{Group: "public", Promotion: &rule}}})
			require.NoError(t, err)
			runtime := &groupdiscount.Runtime{}
			require.NoError(t, runtime.Load(string(raw)))
			offer := runtime.Offers(time.Unix(day+tc.at, 0))["public"]
			assert.InDelta(t, tc.factor, offer.Factor, 1e-12)
			transition := int64(0)
			if tc.transition > 0 {
				transition = day + tc.transition
			}
			assert.Equal(t, transition, offer.Schedule.PeriodEnd)
			assert.InDelta(t, tc.nextFactor, offer.Schedule.NextFactor, 1e-12)
			if tc.nextOffer == 0 {
				assert.Nil(t, offer.Schedule.NextOffer)
			} else {
				require.NotNil(t, offer.Schedule.NextOffer)
				assert.Equal(t, day+tc.nextOffer, offer.Schedule.NextOffer.StartsAt)
			}
		})
	}

	t.Run("captured billing survives a different period and a new revision", func(t *testing.T) {
		runtime := &groupdiscount.Runtime{}
		raw, err := common.Marshal(grouppricing.Promotions{Revision: 1, Groups: []grouppricing.Group{{Group: "public", Promotion: &groupdiscount.Rule{Enabled: true, DailyPeriods: periods}}}})
		require.NoError(t, err)
		require.NoError(t, runtime.Load(string(raw)))
		captured := runtime.Capture(time.Unix(day+17*3600, 0))
		assert.InDelta(t, 1.0/30, runtime.Capture(time.Unix(day+21*3600, 0))["public"], 1e-12)
		require.NoError(t, runtime.Load(`{"revision":2,"groups":[]}`))
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		info := &relaycommon.RelayInfo{UserGroup: "other", UsingGroup: "public", GroupDiscounts: captured}
		assert.InDelta(t, 0.03, helper.HandleGroupRatio(c, info).GroupRatio, 1e-12)
	})

	t.Run("lower and free base prices never increase", func(t *testing.T) {
		runtime := &groupdiscount.Runtime{}
		require.NoError(t, runtime.Load(`{"revision":1,"groups":[{"group":"public","promotion":{"enabled":true,"daily_periods":[{"start":"17:00","end":"18:00","ratio":0.03}]}}]}`))
		for _, base := range []string{`{"public":0.01}`, `{"public":0}`} {
			require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(base))
			assert.Equal(t, 1.0, runtime.Capture(time.Unix(day+17*3600, 0))["public"])
		}
	})
}

func TestDailyPublicMultiplierValidation(t *testing.T) {
	for _, periods := range [][]groupdiscount.DailyPeriod{
		{{Start: "21:00", End: "22:00", Ratio: 0.01}, {Start: "21:30", End: "23:00", Ratio: 0.03}},
		{{Start: "22:00", End: "02:00", Ratio: 0.01}, {Start: "01:00", End: "03:00", Ratio: 0.03}},
		{{Start: "21:00", End: "21:00", Ratio: 0.01}},
		{{Start: "25:00", End: "22:00", Ratio: 0.01}},
		{{Start: "1:00", End: "22:00", Ratio: 0.01}},
		{{Start: "21:00", End: "22:00", Ratio: 0}},
		{{Start: "21:00", End: "22:00", Ratio: -1}},
		{{Start: "21:00", End: "22:00", Ratio: math.NaN()}},
		{{Start: "21:00", End: "22:00", Ratio: math.Inf(1)}},
		make([]groupdiscount.DailyPeriod, 49),
	} {
		_, err := groupdiscount.Normalize(groupdiscount.Rule{DailyPeriods: periods})
		assert.Error(t, err)
	}
	_, err := groupdiscount.Normalize(groupdiscount.Rule{DailyStart: "21:00", DailyEnd: "22:00", DailyPeriods: []groupdiscount.DailyPeriod{{Start: "17:00", End: "18:00", Ratio: 0.01}}})
	assert.Error(t, err, "ambiguous legacy and multiple-period schedules must not be accepted together")
}
