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
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
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
	for _, table := range []any{&Run{}, &GroupState{}, &HistoryAudit{}, &model.Option{}, &model.SystemTask{}} {
		require.NoError(t, db.Migrator().DropTable(table))
	}
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.SystemTask{}))
	require.NoError(t, Migrate(db))
	require.NoError(t, Migrate(db))
	return db
}

func TestBenchmarkHistoryMatrix(t *testing.T) {
	dialects := []string{"sqlite"}
	if os.Getenv("BENCHMARK_TEST_EXTERNAL") == "1" {
		dialects = append(dialects, "mysql", "postgres")
	}
	for _, dialect := range dialects {
		t.Run(dialect, func(t *testing.T) {
			db := benchmarkTestDB(t, dialect)
			var version string
			versionSQL := "SELECT VERSION()"
			if dialect == "sqlite" {
				versionSQL = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(versionSQL).Scan(&version).Error)
			t.Logf("Verified database: %s %s", dialect, version)
			s := benchmarkTestSettings(t)
			_, err := saveSettings(db, s)
			require.NoError(t, err)
			now := time.Now().Unix()
			state := GroupState{GroupName: "public", LastAutoAt: now - 10, SVGSequence: 7}
			require.NoError(t, db.Create(&state).Error)
			// Upgrade the released schema with a two-generation manual chain.
			added := []string{"RootRunID", "Quality", "QualityReason", "ReviewedBy", "ReviewedAt"}
			for _, field := range added {
				require.NoError(t, db.Migrator().DropColumn(&Run{}, field))
			}
			require.NoError(t, db.Migrator().DropTable(&HistoryAudit{}))
			original := Run{GroupName: "public", Kind: "svg", Status: "passed", Output: "<svg><circle/></svg>", CreatedAt: now - 100}
			require.NoError(t, db.Omit(added...).Create(&original).Error)
			first := Run{GroupName: "public", Kind: "svg", Status: "passed", Manual: true, SourceRunID: original.ID, CreatedAt: now - 90}
			require.NoError(t, db.Omit(added...).Create(&first).Error)
			second := first
			second.ID, second.SourceRunID, second.CreatedAt = 0, first.ID, now-80
			require.NoError(t, db.Omit(added...).Create(&second).Error)
			require.NoError(t, Migrate(db))
			require.NoError(t, Migrate(db))
			var saved Run
			require.NoError(t, db.First(&saved, original.ID).Error)
			assert.Equal(t, original, saved)
			saved = Run{}
			require.NoError(t, db.First(&saved, second.ID).Error)
			assert.Equal(t, original.ID, saved.RootRunID)
			assert.Equal(t, first.ID, saved.SourceRunID)
			assert.True(t, db.Migrator().HasIndex(&Run{}, "idx_benchmark_root"))
			assert.True(t, db.Migrator().HasIndex(&Run{}, "idx_benchmark_source"))
			previousDB := model.DB
			model.DB = db
			t.Cleanup(func() { model.DB = previousDB })
			router := gin.New()
			router.Use(func(c *gin.Context) { c.Set("id", 42); c.Set("user_group", "member") })
			router.GET("/runs/:id", getRun)
			router.GET("/artworks", getArtworks)
			router.PUT("/runs/:id/quality", reviewRun)
			router.DELETE("/runs/:id", deleteRun)
			router.POST("/cleanup", cleanupRuns)
			request := func(method, path string, body any) *httptest.ResponseRecorder {
				encoded, err := common.Marshal(body)
				require.NoError(t, err)
				recorder := httptest.NewRecorder()
				router.ServeHTTP(recorder, httptest.NewRequest(method, path, strings.NewReader(string(encoded))))
				return recorder
			}
			path := "/runs/" + strconv.FormatInt(original.ID, 10)
			response := request(http.MethodGet, path+"?latest=true", nil)
			var detail struct {
				Data struct {
					Run
					Versions []RunSummary `json:"versions"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &detail))
			assert.Equal(t, second.ID, detail.Data.ID)
			assert.Len(t, detail.Data.Versions, 3)
			response = request(http.MethodGet, "/artworks", nil)
			assert.Contains(t, response.Body.String(), `"total":1`)
			before, err := buildSnapshot(db, s, "member", now)
			require.NoError(t, err)
			assert.Equal(t, totals{SVGTotal: 1, SVGPassed: 1, AwaitingReview: 1, ManualTotal: 2}, before.Summary)
			assert.Len(t, before.Groups[0].Runs, 1)
			assert.Contains(t, request(http.MethodPut, path+"/quality", gin.H{"quality": "abnormal"}).Body.String(), `"success":false`)
			response = request(http.MethodPut, path+"/quality", gin.H{"quality": "abnormal", "reason": "Detached wheels", "reviewed_at": 0})
			assert.Contains(t, response.Body.String(), `"success":true`)
			assert.Contains(t, request(http.MethodPut, path+"/quality", gin.H{"quality": "normal", "reviewed_at": 0}).Body.String(), `"success":false`, "stale reviewer must not overwrite a newer decision")
			after, err := buildSnapshot(db, s, "member", now)
			require.NoError(t, err)
			assert.Equal(t, int64(1), after.Summary.Anomalies)
			assert.Zero(t, after.Summary.AwaitingReview)
			assert.Equal(t, before.Groups[0].NextAt, after.Groups[0].NextAt)
			// Auditing is atomic: losing the audit store must preserve the result.
			require.NoError(t, db.Migrator().DropTable(&HistoryAudit{}))
			_, err = deleteHistory(db, []int64{first.ID}, 42)
			require.Error(t, err)
			var count int64
			require.NoError(t, db.Model(&Run{}).Where("id = ?", first.ID).Count(&count).Error)
			assert.Equal(t, int64(1), count)
			require.NoError(t, Migrate(db))
			response = request(http.MethodDelete, path, nil)
			assert.Contains(t, response.Body.String(), `"deleted_count":1`)
			assert.Contains(t, response.Body.String(), `"next_run_id":`+strconv.FormatInt(second.ID, 10))
			response = request(http.MethodGet, "/runs/"+strconv.FormatInt(second.ID, 10), nil)
			assert.NotContains(t, response.Body.String(), `"output":"<svg><circle/></svg>"`)
			assert.Contains(t, response.Body.String(), `"root_run_id":`+strconv.FormatInt(original.ID, 10))
			private := Run{GroupName: "private", Kind: "svg", Status: "passed", CreatedAt: now - 50}
			running := Run{GroupName: "public", Kind: "svg", Status: "running", CreatedAt: now - 50}
			require.NoError(t, db.Create(&private).Error)
			require.NoError(t, db.Create(&running).Error)
			assert.Equal(t, http.StatusNotFound, request(http.MethodDelete, "/runs/"+strconv.FormatInt(private.ID, 10), nil).Code)
			assert.Contains(t, request(http.MethodDelete, "/runs/"+strconv.FormatInt(running.ID, 10), nil).Body.String(), `"success":false`)
			criteria := gin.H{"group": "public", "after": now - 200, "before": now, "preview": true}
			response = request(http.MethodPost, "/cleanup", criteria)
			var preview struct {
				Data struct {
					IDs   []int64 `json:"ids"`
					Count int     `json:"count"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &preview))
			assert.Equal(t, []int64{first.ID, second.ID}, preview.Data.IDs)
			criteria["preview"], criteria["ids"] = false, append([]int64{private.ID}, preview.Data.IDs...)
			assert.Contains(t, request(http.MethodPost, "/cleanup", criteria).Body.String(), `"success":false`)
			criteria["ids"] = preview.Data.IDs
			assert.Contains(t, request(http.MethodPost, "/cleanup", criteria).Body.String(), `"deleted_count":2`)
			require.NoError(t, db.Model(&HistoryAudit{}).Count(&count).Error)
			assert.Equal(t, int64(3), count)
			var cursor GroupState
			require.NoError(t, db.First(&cursor).Error)
			assert.Equal(t, state, cursor)
			require.NoError(t, Migrate(db))
			require.NoError(t, Migrate(db))
		})
	}
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

func TestBenchmarkHasNoManualDetectionEndpoint(t *testing.T) {
	router := gin.New()
	RegisterRoutes(router.Group("/api"))
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/extensions/benchmark/admin/run", strings.NewReader(`{"group":"public"}`))
	router.ServeHTTP(response, request)
	assert.Equal(t, http.StatusNotFound, response.Code)
}

func TestBenchmarkAutomaticScheduleFollowsWallClock(t *testing.T) {
	cases := []struct {
		name, now, last, next string
		minutes               int64
	}{
		{"hourly before boundary", "2026-11-16 12:59:59", "2026-11-16 12:00:17", "2026-11-16 13:00:00", 60},
		{"hourly at boundary", "2026-11-16 13:00:00", "2026-11-16 12:00:17", "2026-11-16 13:00:00", 60},
		{"polling delay", "2026-11-16 13:00:59", "2026-11-16 12:00:17", "2026-11-16 13:00:00", 60},
		{"no duplicate after delayed start", "2026-11-16 13:00:59", "2026-11-16 13:00:42", "2026-11-16 14:00:00", 60},
		{"legacy off-grid run", "2026-11-16 13:00:05", "2026-11-16 12:47:00", "2026-11-16 13:00:00", 60},
		{"new group waits for boundary", "2026-11-16 12:17:00", "", "2026-11-16 13:00:00", 60},
		{"new group at boundary", "2026-11-16 13:00:05", "", "2026-11-16 13:00:00", 60},
		{"missed slot is not replayed", "2026-11-16 13:01:00", "2026-11-16 10:00:00", "2026-11-16 14:00:00", 60},
		{"restart skips older slots", "2026-11-16 13:00:10", "2026-11-15 10:00:00", "2026-11-16 13:00:00", 60},
		{"half-hour before boundary", "2026-11-16 12:29:59", "2026-11-16 12:00:10", "2026-11-16 12:30:00", 30},
		{"half-hour at boundary", "2026-11-16 12:30:00", "2026-11-16 12:00:10", "2026-11-16 12:30:00", 30},
		{"half-hour crosses hour", "2026-11-16 13:00:05", "2026-11-16 12:30:10", "2026-11-16 13:00:00", 30},
		{"half-hour crosses day", "2026-11-16 23:59:59", "2026-11-16 23:30:10", "2026-11-17 00:00:00", 30},
		{"interval changed to half-hour", "2026-11-16 12:30:05", "2026-11-16 12:00:10", "2026-11-16 12:30:00", 30},
		{"interval changed to hourly", "2026-11-16 12:45:00", "2026-11-16 12:30:10", "2026-11-16 13:00:00", 60},
		{"two-hour override", "2026-11-16 13:59:59", "2026-11-16 12:00:10", "2026-11-16 14:00:00", 120},
		{"daily checks use local midnight", "2026-11-16 23:59:59", "2026-11-16 00:00:10", "2026-11-17 00:00:00", 1440},
	}
	for _, zone := range []string{"UTC", "Asia/Shanghai", "Asia/Kathmandu"} {
		t.Run(zone, func(t *testing.T) {
			location, err := time.LoadLocation(zone)
			require.NoError(t, err)
			previousLocation := time.Local
			time.Local = location
			t.Cleanup(func() { time.Local = previousLocation })
			for _, tc := range cases {
				t.Run(tc.name, func(t *testing.T) {
					now, err := time.ParseInLocation(time.DateTime, tc.now, location)
					require.NoError(t, err)
					next, err := time.ParseInLocation(time.DateTime, tc.next, location)
					require.NoError(t, err)
					var last int64
					if tc.last != "" {
						previous, err := time.ParseInLocation(time.DateTime, tc.last, location)
						require.NoError(t, err)
						last = previous.Unix()
					}
					assert.Equal(t, next.Unix(), nextAutomaticAt(last, tc.minutes*60, now.Unix()))
				})
			}
		})
	}
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

			now := time.Date(2026, time.November, 16, 12, 0, 15, 0, time.Local).Unix()
			states := []GroupState{{GroupName: "public", LastAutoAt: now - 3660}, {GroupName: "fast", LastAutoAt: now - 10}}
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
			require.NoError(t, h.run(context.Background(), db, &model.SystemTask{TaskID: "manual", Payload: `{"group":"public"}`}, now))
			var state GroupState
			require.NoError(t, db.Where("group_name = ?", "public").Take(&state).Error)
			assert.Equal(t, now-3660, state.LastAutoAt, "manual checks must not postpone automatic checks")
			assert.Equal(t, int64(1), state.SVGSequence)
			require.NoError(t, h.run(context.Background(), db, &model.SystemTask{TaskID: "automatic"}, now))
			require.NoError(t, h.run(context.Background(), db, &model.SystemTask{TaskID: "not-due"}, now+15))
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

			data, err := buildSnapshot(db, s, "member", now)
			require.NoError(t, err)
			require.Len(t, data.Groups, 2)
			assert.Equal(t, now-15+3600, data.Groups[0].NextAt, "global hourly interval follows the clock")
			assert.Equal(t, now-15+7200, data.Groups[1].NextAt, "group override follows its own clock interval")
			nextStart := now - 15 + 3600 + 42
			data, err = buildSnapshot(db, s, "member", nextStart)
			require.NoError(t, err)
			assert.Equal(t, nextStart-42, data.Groups[0].NextAt, "due snapshot and task must identify the same clock slot")
			require.NoError(t, h.run(context.Background(), db, &model.SystemTask{TaskID: "next-hour"}, nextStart))
			require.NoError(t, h.run(context.Background(), db, &model.SystemTask{TaskID: "same-slot"}, nextStart+10))
			require.NoError(t, db.Where("group_name = ?", "public").Take(&state).Error)
			assert.Equal(t, nextStart, state.LastAutoAt)
			data, err = buildSnapshot(db, s, "member", nextStart+10)
			require.NoError(t, err)
			assert.Equal(t, now-15+7200, data.Groups[0].NextAt, "late dispatch must not shift the following hour")
			var automatic []Run
			require.NoError(t, db.Where("task_id = ?", "next-hour").Find(&automatic).Error)
			require.Len(t, automatic, 2)
			for _, run := range automatic {
				assert.Equal(t, nextStart, run.CreatedAt, "history must retain the real start time")
			}
			var duplicates int64
			require.NoError(t, db.Model(&Run{}).Where("task_id = ?", "same-slot").Count(&duplicates).Error)
			assert.Zero(t, duplicates)

			old := Run{GroupName: "public", Kind: "candy", Status: "passed", CreatedAt: now - 31*86400}
			require.NoError(t, db.Create(&old).Error)
			s.Enabled = false
			_, err = saveSettings(db, s)
			require.NoError(t, err)
			previousDB := model.DB
			model.DB = db
			assert.True(t, h.Enabled(), "disabled checks must still clean expired history")
			model.DB = previousDB
			require.NoError(t, h.run(context.Background(), db, &model.SystemTask{TaskID: "retention"}, now))
			var count int64
			require.NoError(t, db.Model(&Run{}).Where("id = ?", old.ID).Count(&count).Error)
			assert.Zero(t, count)
			require.NoError(t, db.Where("group_name = ?", "public").Take(&state).Error)
			assert.Equal(t, int64(3), state.SVGSequence, "retention must not reset rotation")
			data, err = buildSnapshot(db, s, "member", now)
			require.NoError(t, err)
			for _, group := range data.Groups {
				assert.Zero(t, group.NextAt, "disabled checks have no next detection time")
			}
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
		{"unsupported history range", func(s *Settings) { s.HistoryHours = 36 }},
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
			require.Error(t, h.run(ctx, db, &model.SystemTask{TaskID: "failed-batch", Payload: `{"group":"public"}`}, time.Now().Unix()))
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
	s.HistoryHours = 24
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

func TestBenchmarkHistoryRangeDoesNotChangeScheduleOrDailyTotals(t *testing.T) {
	dialects := []string{"sqlite"}
	if os.Getenv("BENCHMARK_TEST_EXTERNAL") == "1" {
		dialects = append(dialects, "mysql", "postgres")
	}
	for _, dialect := range dialects {
		t.Run(dialect, func(t *testing.T) {
			db := benchmarkTestDB(t, dialect)
			s := benchmarkTestSettings(t)
			encoded, err := common.Marshal(s)
			require.NoError(t, err)
			var legacy map[string]any
			require.NoError(t, common.Unmarshal(encoded, &legacy))
			delete(legacy, "history_hours")
			encoded, err = common.Marshal(legacy)
			require.NoError(t, err)
			require.NoError(t, db.Create(&model.Option{Key: settingsKey, Value: string(encoded)}).Error)
			s, _, err = getSettings(db)
			require.NoError(t, err)
			assert.Equal(t, 48, s.HistoryHours, "old saved settings inherit the display default")
			now := time.Date(2026, time.November, 16, 12, 30, 0, 0, time.Local).Unix()
			state := GroupState{GroupName: "public", LastAutoAt: now - 1800}
			require.NoError(t, db.Create(&state).Error)
			runs := []Run{
				{GroupName: "public", Kind: "candy", Status: "passed", CreatedAt: now},
				{GroupName: "public", Kind: "candy", Status: "wrong_answer", CreatedAt: now - 25*3600},
				{GroupName: "public", Kind: "svg", Status: "passed", CreatedAt: now - 49*3600},
				{GroupName: "public", Kind: "svg", Status: "passed", CreatedAt: now - 73*3600},
			}
			require.NoError(t, db.Create(&runs).Error)
			for i, hours := range []int{24, 48, 72} {
				s.HistoryHours = hours
				s, err = saveSettings(db, s)
				require.NoError(t, err)
				stored, _, err := getSettings(db)
				require.NoError(t, err)
				assert.Equal(t, hours, stored.HistoryHours)
				assert.Equal(t, 60, stored.IntervalMinutes)
				assert.Equal(t, 120, stored.Groups[1].IntervalMinutes)
				data, err := buildSnapshot(db, stored, "member", now)
				require.NoError(t, err)
				assert.Equal(t, hours, data.HistoryHours)
				require.Len(t, data.Groups, 2)
				assert.Len(t, data.Groups[0].Runs, i+1)
				assert.Equal(t, now+1800, data.Groups[0].NextAt)
				assert.Equal(t, totals{CandyTotal: 1, CandyPassed: 1}, data.Summary)
				due, err := scheduledGroups(db, stored, now, "")
				require.NoError(t, err)
				assert.Empty(t, due)
				var savedState GroupState
				require.NoError(t, db.Where("group_name = ?", "public").Take(&savedState).Error)
				assert.Equal(t, state, savedState)
			}
			// Older clients omit the field; accepting them must not disable history.
			s.HistoryHours = 0
			s, err = saveSettings(db, s)
			require.NoError(t, err)
			assert.Equal(t, 48, s.HistoryHours)
		})
	}
}

func TestBenchmarkRegenerationMatrix(t *testing.T) {
	dialects := []string{"sqlite"}
	if os.Getenv("BENCHMARK_TEST_EXTERNAL") == "1" {
		dialects = append(dialects, "mysql", "postgres")
	}
	for _, dialect := range dialects {
		t.Run(dialect, func(t *testing.T) {
			db := benchmarkTestDB(t, dialect)
			s := benchmarkTestSettings(t)
			s, err := saveSettings(db, s)
			require.NoError(t, err)
			now := time.Date(2026, time.November, 16, 12, 17, 0, 0, time.Local).Unix()
			state := GroupState{GroupName: "public", LastAutoAt: now - 1020, SVGSequence: 7}
			require.NoError(t, db.Create(&state).Error)
			// Reproduce the released schema before the two audit columns were added.
			require.NoError(t, db.Migrator().DropColumn(&Run{}, "SourceRunID"))
			require.NoError(t, db.Migrator().DropColumn(&Run{}, "RequestedBy"))
			original := Run{GroupName: "public", Model: "saved-model", Kind: "candy", PromptName: "saved question", Prompt: "saved prompt", Expected: "21", Output: "27", Status: "wrong_answer", CreatedAt: now - 60}
			require.NoError(t, db.Omit("SourceRunID", "RequestedBy").Create(&original).Error)
			require.NoError(t, Migrate(db))
			require.NoError(t, Migrate(db))
			var saved Run
			saved = Run{}
			require.NoError(t, db.First(&saved, original.ID).Error)
			assert.Equal(t, original, saved)
			assert.True(t, db.Migrator().HasIndex(&Run{}, "idx_benchmark_source"))
			assert.True(t, db.Migrator().HasIndex(&Run{}, "idx_benchmark_group_time"))
			assert.Error(t, db.Create(&GroupState{GroupName: "public"}).Error)
			before, err := buildSnapshot(db, s, "member", now)
			require.NoError(t, err)
			for _, kind := range []string{"candy", "svg", "request_failed"} {
				t.Run(kind, func(t *testing.T) {
					source := original
					if kind != "candy" {
						source.ID = 0
						source.Kind = "svg"
						source.PromptName = "saved artwork"
						source.Output = "<svg><circle/></svg>"
						source.Status = "passed"
						if kind == "request_failed" {
							source.Status = "request_failed"
							source.Output = ""
						}
						require.NoError(t, db.Create(&source).Error)
					}
					regenerated, err := enqueueRegeneration(db, source, 42)
					require.NoError(t, err)
					duplicate, err := enqueueRegeneration(db, source, 42)
					require.NoError(t, err)
					assert.Equal(t, regenerated.ID, duplicate.ID)
					_, err = enqueueRegeneration(db, source, 43)
					require.ErrorIs(t, err, errRegenerationBusy)
					assert.True(t, regenerated.Manual)
					assert.Equal(t, source.ID, regenerated.SourceRunID)
					assert.Equal(t, 42, regenerated.RequestedBy)
					assert.Equal(t, source.Model, regenerated.Model)
					assert.Equal(t, source.Prompt, regenerated.Prompt)
					assert.Equal(t, source.Expected, regenerated.Expected)
					assert.Equal(t, source.PromptName, regenerated.PromptName)
					var task model.SystemTask
					require.NoError(t, db.Where("task_id = ?", regenerated.TaskID).Take(&task).Error)
					assert.Equal(t, regenerationTaskType, task.Type)
					// Automatic housekeeping must not mark a queued manual probe interrupted.
					require.NoError(t, (taskHandler{}).run(context.Background(), db, &model.SystemTask{TaskID: "not-due"}, now))
					saved = Run{}
					require.NoError(t, db.First(&saved, regenerated.ID).Error)
					assert.Equal(t, "running", saved.Status)
					calls := 0
					h := regenerationHandler{execute: func(_ context.Context, group, model, prompt string, limit int) (ProbeResult, error) {
						calls++
						assert.Equal(t, source.GroupName, group)
						assert.Equal(t, source.Model, model)
						assert.Equal(t, source.Prompt, prompt)
						if source.Kind == "candy" {
							assert.Equal(t, s.CandyMaxTokens, limit)
							return ProbeResult{Output: "21"}, nil
						}
						assert.Equal(t, s.SVGMaxTokens, limit)
						return ProbeResult{Output: "<svg><circle/></svg>"}, nil
					}}
					require.NoError(t, h.run(context.Background(), db, &task))
					assert.Equal(t, 1, calls)
					saved = Run{}
					require.NoError(t, db.First(&saved, regenerated.ID).Error)
					assert.Equal(t, "passed", saved.Status)
					encoded, err := common.Marshal(saved)
					require.NoError(t, err)
					assert.NotContains(t, string(encoded), "requested_by")
					assert.NotContains(t, string(encoded), regenerated.TaskID)
					var unchanged Run
					require.NoError(t, db.First(&unchanged, source.ID).Error)
					assert.Equal(t, source, unchanged)
					var cursor GroupState
					require.NoError(t, db.First(&cursor).Error)
					assert.Equal(t, state, cursor, "regeneration must not advance the automatic schedule or SVG rotation")
					after, err := buildSnapshot(db, s, "member", now)
					require.NoError(t, err)
					assert.Equal(t, before.Groups[0].NextAt, after.Groups[0].NextAt)
					require.NoError(t, db.Model(&task).Updates(map[string]any{"status": model.SystemTaskStatusSucceeded, "active_key": nil}).Error)
				})
			}
			require.NoError(t, Migrate(db))
			require.NoError(t, Migrate(db))
			saved = Run{}
			require.NoError(t, db.First(&saved, original.ID).Error)
			assert.Equal(t, original, saved)
		})
	}
}

func TestBenchmarkRegenerationInterruptedOrDisabled(t *testing.T) {
	for _, failure := range []string{"cancel", "panic", "disabled"} {
		t.Run(failure, func(t *testing.T) {
			db := benchmarkTestDB(t, "sqlite")
			s := benchmarkTestSettings(t)
			s, err := saveSettings(db, s)
			require.NoError(t, err)
			source := Run{GroupName: "public", Kind: "candy", Model: "gpt-4o", Prompt: "saved", Expected: "21", Status: "request_failed"}
			require.NoError(t, db.Create(&source).Error)
			run, err := enqueueRegeneration(db, source, 42)
			require.NoError(t, err)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if failure == "disabled" {
				s.Enabled = false
				_, err = saveSettings(db, s)
				require.NoError(t, err)
			}
			calls := 0
			handler := regenerationHandler{execute: func(ctx context.Context, _, _, _ string, _ int) (ProbeResult, error) {
				calls++
				if failure == "panic" {
					panic("provider credentials must never leak")
				}
				cancel()
				<-ctx.Done()
				return ProbeResult{}, ctx.Err()
			}}
			err = handler.run(ctx, db, &model.SystemTask{TaskID: run.TaskID})
			if failure == "disabled" {
				require.NoError(t, err)
				assert.Zero(t, calls)
			} else {
				require.Error(t, err)
			}
			require.NoError(t, db.First(&run, run.ID).Error)
			assert.Equal(t, "interrupted", run.Status)
			assert.Empty(t, run.Output)
			assert.Equal(t, "interrupted", run.ErrorCode)
		})
	}
}

func TestBenchmarkRegenerationAdminAuthorization(t *testing.T) {
	require.NoError(t, i18n.Init())
	db := benchmarkTestDB(t, "sqlite")
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}))
	s := benchmarkTestSettings(t)
	s, err := saveSettings(db, s)
	require.NoError(t, err)
	source := Run{GroupName: "public", Kind: "candy", Model: "gpt-4o", Prompt: "saved", Expected: "21", Status: "wrong_answer"}
	require.NoError(t, db.Create(&source).Error)
	previousDB, previousLogs := model.DB, model.LOG_DB
	previousRedis, previousRate, previousSecret := common.RedisEnabled, common.CriticalRateLimitEnable, common.SessionSecret
	previousTrusted := common.SessionCookieTrustedURLs
	model.DB, model.LOG_DB, common.RedisEnabled, common.CriticalRateLimitEnable = db, db, false, false
	common.SessionSecret, common.SessionCookieTrustedURLs = "benchmark-regeneration-test-signing-key", nil
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogs
		common.RedisEnabled, common.CriticalRateLimitEnable, common.SessionSecret = previousRedis, previousRate, previousSecret
		common.SessionCookieTrustedURLs = previousTrusted
	})
	credentials := map[int]string{}
	sessions := map[int]model.UserSession{}
	for _, role := range []int{common.RoleCommonUser, common.RoleAdminUser, common.RoleRootUser} {
		name := "benchmark-" + strconv.Itoa(role)
		user := model.User{Username: name, AffCode: name, Role: role, Status: common.UserStatusEnabled, Group: "member", AuthVersion: 1}
		require.NoError(t, db.Create(&user).Error)
		session := model.UserSession{SID: name, UserID: user.Id, Version: 1, UserAuthVersion: 1, Status: model.UserSessionStatusActive, RefreshHash: "unusable", LoginMethod: "test", LastActiveAt: time.Now().Unix(), ExpiresAt: time.Now().Unix() + 3600}
		require.NoError(t, model.CreateUserSession(&session))
		sessions[role] = session
		credentials[role], _, err = service.IssueAccessToken(service.AuthIdentity{UserID: user.Id, SessionID: session.SID, UserAuthVersion: 1, SessionVersion: 1})
		require.NoError(t, err)
	}
	router := gin.New()
	RegisterRoutes(router.Group("/api"))
	requestOperation := func(role int, origin, method, path string, body any) *httptest.ResponseRecorder {
		encoded, err := common.Marshal(body)
		require.NoError(t, err)
		req := httptest.NewRequest(method, "http://benchmark.example/api/extensions/benchmark/admin"+path, strings.NewReader(string(encoded)))
		if credentials[role] != "" {
			req.Header.Set("Authorization", "Bearer "+credentials[role])
		}
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		return response
	}
	request := func(role int, origin string, id int64) *httptest.ResponseRecorder {
		return requestOperation(role, origin, http.MethodPost, "/runs/"+strconv.FormatInt(id, 10)+"/regenerate", nil)
	}
	for _, role := range []int{0, common.RoleCommonUser} {
		assert.Contains(t, []int{http.StatusUnauthorized, http.StatusForbidden}, request(role, "http://benchmark.example", source.ID).Code)
	}
	for _, origin := range []string{"", "https://untrusted.example"} {
		assert.Equal(t, http.StatusForbidden, request(common.RoleAdminUser, origin, source.ID).Code)
	}
	private := source
	private.ID = 0
	private.GroupName = "private"
	require.NoError(t, db.Create(&private).Error)
	assert.Equal(t, http.StatusNotFound, request(common.RoleAdminUser, "http://benchmark.example", private.ID).Code)
	for _, role := range []int{common.RoleAdminUser, common.RoleRootUser} {
		response := request(role, "http://benchmark.example", source.ID)
		require.Equal(t, http.StatusOK, response.Code)
		assert.Contains(t, response.Body.String(), `"success":true`)
		assert.NotContains(t, response.Body.String(), "requested_by")
		assert.NotContains(t, response.Body.String(), credentials[role])
		require.NoError(t, db.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&model.SystemTask{}).Error)
	}
	for _, edit := range []string{"running", "plugin", "group", "kind"} {
		t.Run(edit, func(t *testing.T) {
			modified := s
			modified.Groups = append([]GroupSettings(nil), s.Groups...)
			if edit == "running" {
				require.NoError(t, db.Model(&source).Update("status", "running").Error)
			}
			if edit == "plugin" {
				modified.Enabled = false
			}
			if edit == "group" {
				modified.Groups[0].Enabled = false
			}
			if edit == "kind" {
				modified.Groups[0].CandyEnabled = false
			}
			_, err = saveSettings(db, modified)
			require.NoError(t, err)
			response := request(common.RoleAdminUser, "http://benchmark.example", source.ID)
			assert.Contains(t, response.Body.String(), `"success":false`)
			current, _, err := getSettings(db)
			require.NoError(t, err)
			s.Revision = current.Revision
			s, err = saveSettings(db, s)
			require.NoError(t, err)
			require.NoError(t, db.Model(&source).Update("status", "wrong_answer").Error)
		})
	}
	for _, operation := range []struct{ method, path string }{
		{http.MethodPut, "/runs/" + strconv.FormatInt(source.ID, 10) + "/quality"},
		{http.MethodDelete, "/runs/" + strconv.FormatInt(source.ID, 10)},
		{http.MethodPost, "/cleanup"},
	} {
		for _, role := range []int{0, common.RoleCommonUser} {
			assert.Contains(t, []int{http.StatusUnauthorized, http.StatusForbidden}, requestOperation(role, "http://benchmark.example", operation.method, operation.path, nil).Code)
		}
		for _, origin := range []string{"", "https://untrusted.example"} {
			assert.Equal(t, http.StatusForbidden, requestOperation(common.RoleAdminUser, origin, operation.method, operation.path, nil).Code)
		}
	}
	for _, role := range []int{common.RoleAdminUser, common.RoleRootUser} {
		public := Run{GroupName: "public", Kind: "svg", Status: "passed", CreatedAt: time.Now().Unix() - 300}
		require.NoError(t, db.Create(&public).Error)
		path := "/runs/" + strconv.FormatInt(public.ID, 10)
		assert.Contains(t, requestOperation(role, "http://benchmark.example", http.MethodPut, path+"/quality", gin.H{"quality": "normal", "reviewed_at": 0}).Body.String(), `"success":true`)
		assert.Contains(t, requestOperation(role, "http://benchmark.example", http.MethodPost, "/cleanup", gin.H{"group": "public", "after": public.CreatedAt - 1, "before": public.CreatedAt + 1, "preview": true}).Body.String(), `"success":true`)
		assert.Contains(t, requestOperation(role, "http://benchmark.example", http.MethodDelete, path, nil).Body.String(), `"success":true`)
	}
	privatePath := "/runs/" + strconv.FormatInt(private.ID, 10)
	assert.Equal(t, http.StatusNotFound, requestOperation(common.RoleAdminUser, "http://benchmark.example", http.MethodPut, privatePath+"/quality", gin.H{"quality": "normal"}).Code)
	assert.Equal(t, http.StatusNotFound, requestOperation(common.RoleAdminUser, "http://benchmark.example", http.MethodDelete, privatePath, nil).Code)
	response := requestOperation(common.RoleAdminUser, "http://benchmark.example", http.MethodPost, "/cleanup", gin.H{"group": "private", "after": time.Now().Unix() - 600, "before": time.Now().Unix(), "preview": false, "ids": []int64{private.ID}})
	assert.Contains(t, response.Body.String(), `"success":false`)
	session := sessions[common.RoleAdminUser]
	require.NoError(t, db.Model(&session).Update("status", "revoked").Error)
	assert.Equal(t, http.StatusUnauthorized, request(common.RoleAdminUser, "http://benchmark.example", source.ID).Code)
	for _, operation := range []struct{ method, path string }{
		{http.MethodPut, privatePath + "/quality"},
		{http.MethodDelete, privatePath},
		{http.MethodPost, "/cleanup"},
	} {
		assert.Equal(t, http.StatusUnauthorized, requestOperation(common.RoleAdminUser, "http://benchmark.example", operation.method, operation.path, nil).Code)
	}
}
