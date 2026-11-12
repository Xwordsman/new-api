package benchmark

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func benchmarkTestDB(t *testing.T, dialect string) *gorm.DB {
	t.Helper()
	var driver gorm.Dialector
	switch dialect {
	case "sqlite":
		driver = sqlite.Open(":memory:")
	case "mysql", "postgres":
		dsn := os.Getenv("BENCHMARK_TEST_" + strings.ToUpper(dialect) + "_DSN")
		require.Contains(t, dsn, "/benchmark_extension_test?")
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
	for _, table := range []any{&Run{}, &GroupState{}, &model.Option{}} {
		require.NoError(t, db.Migrator().DropTable(table))
	}
	require.NoError(t, db.AutoMigrate(&model.Option{}))
	require.NoError(t, Migrate(db))
	require.NoError(t, Migrate(db))
	return db
}

func benchmarkTestSettings(t *testing.T) Settings {
	t.Helper()
	groups := ratio_setting.GroupRatio2JSONString()
	usable := setting.UserUsableGroups2JSONString()
	special := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.MarshalJSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(groups))
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(usable))
		require.NoError(t, ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.UnmarshalJSON([]byte(special)))
	})
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"public":1,"fast":1,"private":1}`))
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"public":"Public","fast":"Fast"}`))
	require.NoError(t, ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.UnmarshalJSON([]byte(`{}`)))
	s := defaultSettings()
	s.Enabled = true
	s.Groups = []GroupSettings{
		{Group: "public", Model: "gpt-4o", Enabled: true, CandyEnabled: true, SVGEnabled: true},
		{Group: "fast", Model: "gpt-5", Enabled: true, CandyEnabled: true, IntervalMinutes: 120},
		{Group: "private", Model: "gpt-5", CandyEnabled: true},
	}
	s.SVGPrompts = []SVGPrompt{
		{Name: "First", Prompt: "Draw first", Enabled: true},
		{Name: "Disabled", Prompt: "Do not draw"},
		{Name: "Second", Prompt: "Draw second", Enabled: true},
	}
	return s
}

func TestBenchmarkSettingsAndScheduleMatrix(t *testing.T) {
	dialects := []string{"sqlite"}
	if os.Getenv("BENCHMARK_TEST_EXTERNAL") == "1" {
		dialects = append(dialects, "mysql", "postgres")
	}
	for _, dialect := range dialects {
		t.Run(dialect, func(t *testing.T) {
			db := benchmarkTestDB(t, dialect)
			s := benchmarkTestSettings(t)
			initial, _, err := getSettings(db)
			require.NoError(t, err)
			assert.False(t, initial.Enabled)
			assert.Equal(t, 60, initial.IntervalMinutes)
			s, err = saveSettings(db, s)
			require.NoError(t, err)
			stale := s
			stale.Revision--
			_, err = saveSettings(db, stale)
			require.ErrorIs(t, err, errConflict)
			stored, _, err := getSettings(db)
			require.NoError(t, err)
			assert.Equal(t, s, stored)

			now := time.Now().Unix()
			states := []GroupState{{GroupName: "public", LastAutoAt: now - 3660}, {GroupName: "fast", LastAutoAt: now - 7140}}
			require.NoError(t, db.Create(&states).Error)
			due, err := scheduledGroups(db, s, now, "")
			require.NoError(t, err)
			require.Len(t, due, 1)
			assert.Equal(t, "public", due[0].Group)
			due, err = scheduledGroups(db, s, now, "fast")
			require.NoError(t, err)
			require.Len(t, due, 1)
			assert.Equal(t, "fast", due[0].Group)

			// Longer than MySQL TEXT's 64 KiB limit; no artwork truncation at rest.
			artwork := "<svg><text>" + strings.Repeat("绘", 30000) + "</text></svg>"
			h := taskHandler{execute: func(_ context.Context, group, name, prompt string, limit int) (ProbeResult, error) {
				assert.Equal(t, "public", group)
				assert.Equal(t, "gpt-4o", name)
				if prompt == s.CandyPrompt {
					assert.Equal(t, 4096, limit)
					return ProbeResult{Output: "21", ChannelID: 99, InputTokens: 50, OutputTokens: 1}, nil
				}
				assert.Equal(t, 16384, limit)
				return ProbeResult{Output: artwork, ChannelID: 99}, nil
			}}
			require.NoError(t, h.run(context.Background(), db, &model.SystemTask{TaskID: "manual", Payload: `{"group":"public"}`}))
			var state GroupState
			require.NoError(t, db.Where("group_name = ?", "public").Take(&state).Error)
			assert.Equal(t, now-3660, state.LastAutoAt, "manual checks must not postpone automatic checks")
			assert.Equal(t, int64(1), state.SVGSequence)
			require.NoError(t, h.run(context.Background(), db, &model.SystemTask{TaskID: "automatic"}))
			require.NoError(t, h.run(context.Background(), db, &model.SystemTask{TaskID: "not-due"}))
			var runs []Run
			require.NoError(t, db.Order("id").Find(&runs).Error)
			require.Len(t, runs, 4)
			assert.True(t, runs[0].Manual)
			assert.False(t, runs[2].Manual)
			assert.Equal(t, "First", runs[1].PromptName)
			assert.Equal(t, "Second", runs[3].PromptName)
			assert.Equal(t, artwork, string(runs[3].Output))
			for _, r := range runs {
				assert.Equal(t, "passed", r.Status)
			}
			encoded, err := common.Marshal(runs[0])
			require.NoError(t, err)
			assert.NotContains(t, string(encoded), "channel_id")
			assert.NotContains(t, string(encoded), "task_id")
			assert.True(t, db.Migrator().HasIndex(&Run{}, "idx_benchmark_group_time"))
			assert.Error(t, db.Create(&GroupState{GroupName: "public"}).Error, "group schedule must be unique")

			// Settings and stored output survive repeated migration unchanged.
			require.NoError(t, Migrate(db))
			require.NoError(t, Migrate(db))
			var saved Run
			require.NoError(t, db.First(&saved, runs[3].ID).Error)
			assert.Equal(t, runs[3], saved)
			stored, _, err = getSettings(db)
			require.NoError(t, err)
			assert.Equal(t, s, stored)

			old := Run{GroupName: "public", Kind: "candy", Status: "passed", CreatedAt: now - 31*86400}
			require.NoError(t, db.Create(&old).Error)
			s.Enabled = false
			_, err = saveSettings(db, s)
			require.NoError(t, err)
			previousDB := model.DB
			model.DB = db
			assert.True(t, h.Enabled(), "disabled checks must still clean expired history")
			model.DB = previousDB
			require.NoError(t, h.run(context.Background(), db, &model.SystemTask{TaskID: "retention"}))
			var count int64
			require.NoError(t, db.Model(&Run{}).Where("id = ?", old.ID).Count(&count).Error)
			assert.Zero(t, count)
			require.NoError(t, db.Where("group_name = ?", "public").Take(&state).Error)
			assert.Equal(t, int64(2), state.SVGSequence, "retention must not reset rotation")
		})
	}
}

func TestBenchmarkRejectsInvalidConfiguration(t *testing.T) {
	db := benchmarkTestDB(t, "sqlite")
	base := benchmarkTestSettings(t)
	cases := []struct {
		name string
		edit func(*Settings)
	}{
		{"too frequent", func(s *Settings) { s.IntervalMinutes = 1 }},
		{"unbounded timeout", func(s *Settings) { s.TimeoutSeconds = 601 }},
		{"unbounded output", func(s *Settings) { s.SVGMaxTokens = 32769 }},
		{"empty answer", func(s *Settings) { s.CandyAnswer = " " }},
		{"oversized prompt", func(s *Settings) { s.CandyPrompt = strings.Repeat("题", 10667) }},
		{"unknown group", func(s *Settings) { s.Groups[0].Group = "missing" }},
		{"duplicate group", func(s *Settings) { s.Groups[1].Group = "public" }},
		{"no check enabled", func(s *Settings) { s.Groups[0].CandyEnabled, s.Groups[0].SVGEnabled = false, false }},
		{"no active SVG prompt", func(s *Settings) { s.SVGPrompts = nil }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := base
			s.Groups = append([]GroupSettings(nil), base.Groups...)
			s.SVGPrompts = append([]SVGPrompt(nil), base.SVGPrompts...)
			tc.edit(&s)
			_, err := saveSettings(db, s)
			require.ErrorIs(t, err, errInvalid)
		})
	}
}

func TestBenchmarkEvaluationSeparatesIncorrectIncompleteAndFailedChecks(t *testing.T) {
	cases := []struct {
		name, kind, output, expected, status, code string
		truncated                                  bool
		err                                        error
	}{
		{name: "correct candy", kind: "candy", output: " 21\n", expected: "21", status: "passed"},
		{name: "explanation is not a scalar answer", kind: "candy", output: "21 because...", expected: "21", status: "wrong_answer", code: "wrong_answer"},
		{name: "reasoning budget exhausted", kind: "candy", output: "21", expected: "21", truncated: true, status: "truncated", code: "truncated"},
		{name: "network failure", kind: "candy", err: errors.New("secret provider URL"), status: "request_failed", code: "request_failed"},
		{name: "inline HTML animation", kind: "svg", output: `<html><style>svg{width:100%}</style><body><svg><g><circle r="5"/></g></svg><script>const x = "<svg>";</script></body></html>`, status: "passed"},
		{name: "missing SVG", kind: "svg", output: "Here is an SVG", status: "invalid", code: "invalid_svg"},
		{name: "empty SVG", kind: "svg", output: "<svg></svg>", status: "invalid", code: "invalid_svg"},
		{name: "mismatched close", kind: "svg", output: "<svg><g><path/></svg>", status: "invalid", code: "invalid_svg"},
		{name: "unclosed SVG", kind: "svg", output: "<svg><path/>", status: "invalid", code: "invalid_svg"},
		{name: "self closing nested SVG", kind: "svg", output: "<svg><svg/><circle/></svg>", status: "passed"},
		{name: "oversized output", kind: "svg", output: strings.Repeat("x", maxOutputBytes+1), status: "invalid", code: "output_too_large"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status, code := evaluate(Run{Kind: tc.kind, Expected: tc.expected}, ProbeResult{Output: tc.output, Truncated: tc.truncated}, tc.err)
			assert.Equal(t, tc.status, status)
			assert.Equal(t, tc.code, code)
		})
	}
}

func TestBenchmarkCancellationAndWorkerFailurePersistInterruption(t *testing.T) {
	for _, fail := range []string{"cancel", "panic"} {
		t.Run(fail, func(t *testing.T) {
			db := benchmarkTestDB(t, "sqlite")
			s := benchmarkTestSettings(t)
			_, err := saveSettings(db, s)
			require.NoError(t, err)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var once sync.Once
			h := taskHandler{execute: func(ctx context.Context, _, _, _ string, _ int) (ProbeResult, error) {
				if fail == "panic" {
					panic("provider panic")
				}
				once.Do(cancel)
				<-ctx.Done()
				return ProbeResult{}, ctx.Err()
			}}
			require.Error(t, h.run(ctx, db, &model.SystemTask{TaskID: "failed-batch", Payload: `{"group":"public"}`}))
			var runs []Run
			require.NoError(t, db.Find(&runs).Error)
			require.Len(t, runs, 2)
			for _, r := range runs {
				assert.Equal(t, "interrupted", r.Status)
				assert.NotZero(t, r.FinishedAt)
				assert.Empty(t, r.Output)
			}
		})
	}
}

func TestBenchmarkSnapshotAndDetailRespectVisibilityAndKeepFullTotals(t *testing.T) {
	db := benchmarkTestDB(t, "sqlite")
	s := benchmarkTestSettings(t)
	_, err := saveSettings(db, s)
	require.NoError(t, err)
	now := time.Now().Unix()
	runs := make([]Run, 602)
	for i := range runs {
		runs[i] = Run{GroupName: "public", Kind: "candy", Status: "passed", CreatedAt: now, ChannelID: 7, TaskID: "hidden"}
	}
	runs[0].Status = "wrong_answer"
	require.NoError(t, db.CreateInBatches(&runs, 20).Error)
	private := Run{GroupName: "private", Kind: "svg", Status: "passed", Output: "<svg><circle/></svg>", CreatedAt: now}
	require.NoError(t, db.Create(&private).Error)
	data, err := buildSnapshot(db, s, "member", now)
	require.NoError(t, err)
	require.Len(t, data.Groups, 2)
	assert.Len(t, data.Groups[0].Runs, 600)
	assert.Equal(t, int64(602), data.Summary.CandyTotal)
	assert.Equal(t, int64(601), data.Summary.CandyPassed)
	assert.Equal(t, int64(1), data.Summary.Anomalies)
	assert.Zero(t, data.Summary.SVGTotal)
	previousDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previousDB })
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("user_group", "member")
	c.Request = httptest.NewRequest(http.MethodGet, "/runs/private", nil)
	c.Params = gin.Params{{Key: "id", Value: strconv.FormatInt(private.ID, 10)}}
	getRun(c)
	c.Writer.WriteHeaderNow()
	assert.Equal(t, http.StatusNotFound, recorder.Code)

	recorder = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(recorder)
	c.Set("user_group", "member")
	c.Request = httptest.NewRequest(http.MethodGet, "/artworks?group=private", nil)
	getArtworks(c)
	assert.Contains(t, recorder.Body.String(), `"items":[]`)
	assert.Contains(t, recorder.Body.String(), `"total":0`)
}
