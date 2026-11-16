package benchmark

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func RegisterRoutes(api *gin.RouterGroup) {
	users := api.Group("/extensions/benchmark", middleware.UserAuth(), middleware.DisableCache(), queryTimeout())
	users.GET("/snapshot", getSnapshot)
	users.GET("/runs/:id", getRun)
	users.GET("/artworks", getArtworks)
	admin := api.Group("/extensions/benchmark/admin", middleware.RootAuth(), middleware.DisableCache(), queryTimeout())
	admin.GET("/settings", adminSettings)
	admin.PUT("/settings", middleware.SessionCookieOriginGuard(), middleware.UserCriticalRateLimit("benchmark-admin"), updateSettings)
	actions := api.Group("/extensions/benchmark/admin", middleware.AdminAuth(), middleware.DisableCache(), queryTimeout())
	actions.POST("/runs/:id/regenerate", middleware.StrictSessionCookieOriginGuard(), middleware.UserCriticalRateLimit("benchmark-regenerate"), regenerateRun)
	actions.PUT("/runs/:id/quality", middleware.StrictSessionCookieOriginGuard(), middleware.UserCriticalRateLimit("benchmark-history"), reviewRun)
	actions.DELETE("/runs/:id", middleware.StrictSessionCookieOriginGuard(), middleware.UserCriticalRateLimit("benchmark-history"), deleteRun)
	actions.POST("/cleanup", middleware.StrictSessionCookieOriginGuard(), middleware.UserCriticalRateLimit("benchmark-history"), cleanupRuns)
}

var errRegenerationBusy = errors.New("A benchmark regeneration is already running or queued")
var errRegenerationDisabled = errors.New("Regeneration is unavailable for this benchmark result")

func regenerateRun(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.Status(http.StatusNotFound)
		return
	}
	db := model.DB.WithContext(c.Request.Context())
	s, _, err := getSettings(db)
	if err != nil {
		respond(c, nil, err)
		return
	}
	groups := []string{}
	for _, g := range visibleGroups(s, c.GetString("user_group")) {
		groups = append(groups, g.Group)
	}
	var source Run
	if err = db.Where("id = ? AND group_name IN ?", id, groups).Take(&source).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		c.Status(http.StatusNotFound)
		return
	}
	if err != nil {
		respond(c, nil, err)
		return
	}
	if source.Status == "running" || !regenerationEnabled(s, source) {
		respond(c, nil, errRegenerationDisabled)
		return
	}
	run, err := enqueueRegeneration(db, source, c.GetInt("id"))
	respond(c, run, err)
}

// The task and result are created atomically. The unique system-task active key
// limits manual traffic to one probe, including across multiple gateway nodes.
func enqueueRegeneration(db *gorm.DB, source Run, administrator int) (Run, error) {
	taskID, err := model.GenerateSystemTaskID()
	if err != nil {
		return Run{}, err
	}
	run := Run{GroupName: source.GroupName, Model: source.Model, Kind: source.Kind, PromptName: source.PromptName,
		Prompt: source.Prompt, Expected: source.Expected, Status: "running", Manual: true,
		SourceRunID: source.ID, RootRunID: source.seriesID(), RequestedBy: administrator, TaskID: taskID, CreatedAt: time.Now().Unix()}
	key := regenerationTaskType
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&model.SystemTask{TaskID: taskID, Type: key, ActiveKey: &key, Status: model.SystemTaskStatusPending}).Error; err != nil {
			return err
		}
		return tx.Create(&run).Error
	})
	if err == nil {
		return run, nil
	}
	var active model.SystemTask
	if activeErr := db.Where("active_key = ?", key).Take(&active).Error; activeErr != nil {
		return Run{}, err
	}
	var existing Run
	if err := db.Where("task_id = ?", active.TaskID).Take(&existing).Error; err != nil {
		return Run{}, err
	}
	if existing.SourceRunID == source.ID && existing.RequestedBy == administrator {
		return existing, nil
	}
	return Run{}, errRegenerationBusy
}

func queryTimeout() gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
		defer cancel()
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	}
}

func respond(c *gin.Context, data any, err error) {
	if err == nil {
		common.ApiSuccess(c, data)
		return
	}
	if errors.Is(err, errInvalid) || errors.Is(err, errConflict) || errors.Is(err, errRegenerationBusy) || errors.Is(err, errRegenerationDisabled) || errors.Is(err, errHistoryInvalid) {
		common.ApiError(c, err)
		return
	}
	common.SysError("benchmark: " + err.Error())
	common.ApiErrorT(c, "Unable to load benchmark data")
}

func adminSettings(c *gin.Context) {
	db := model.DB.WithContext(c.Request.Context())
	s, _, err := getSettings(db)
	if err != nil {
		respond(c, nil, err)
		return
	}
	type availableGroup struct {
		Group  string   `json:"group"`
		Models []string `json:"models"`
	}
	groups := make([]availableGroup, 0)
	for group := range ratio_setting.GetGroupRatioCopy() {
		if group == "" || group == "auto" {
			continue
		}
		models := []string{}
		if err := db.Model(&model.Ability{}).Where(map[string]any{"group": group, "enabled": true}).Distinct("model").Order("model").Pluck("model", &models).Error; err != nil {
			respond(c, nil, err)
			return
		}
		groups = append(groups, availableGroup{Group: group, Models: models})
	}
	slices.SortFunc(groups, func(a, b availableGroup) int { return strings.Compare(a.Group, b.Group) })
	respond(c, gin.H{"settings": s, "available_groups": groups}, nil)
}

func updateSettings(c *gin.Context) {
	var s Settings
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
	if common.DecodeJson(c.Request.Body, &s) != nil {
		respond(c, nil, errInvalid)
		return
	}
	saved, err := saveSettings(model.DB.WithContext(c.Request.Context()), s)
	respond(c, saved, err)
}

type totals struct {
	CandyTotal     int64 `json:"candy_total"`
	CandyPassed    int64 `json:"candy_passed"`
	SVGTotal       int64 `json:"svg_total"`
	SVGPassed      int64 `json:"svg_passed"`
	Anomalies      int64 `json:"anomalies"`
	AwaitingReview int64 `json:"awaiting_review"`
	ManualTotal    int64 `json:"manual_total"`
}

type publicGroup struct {
	GroupSettings
	IntervalSeconds int64        `json:"interval_seconds"`
	NextAt          int64        `json:"next_at"`
	Runs            []RunSummary `json:"runs"`
	Totals          totals       `json:"totals"`
}

type snapshot struct {
	Enabled        bool          `json:"enabled"`
	UpdatedAt      int64         `json:"updated_at"`
	RefreshSeconds int           `json:"refresh_seconds"`
	HistoryHours   int           `json:"history_hours"`
	Groups         []publicGroup `json:"groups"`
	Summary        totals        `json:"summary"`
}

func visibleGroups(s Settings, userGroup string) []GroupSettings {
	groups := make([]GroupSettings, 0)
	for _, g := range s.Groups {
		if service.IsUserSelectableGroup(userGroup, g.Group) {
			groups = append(groups, g)
		}
	}
	return groups
}

func getSnapshot(c *gin.Context) {
	db := model.DB.WithContext(c.Request.Context())
	s, _, err := getSettings(db)
	if err != nil {
		respond(c, nil, err)
		return
	}
	now := time.Now().Unix()
	data, err := buildSnapshot(db, s, c.GetString("user_group"), now)
	respond(c, data, err)
}

func buildSnapshot(db *gorm.DB, s Settings, userGroup string, now int64) (snapshot, error) {
	data := snapshot{Enabled: s.Enabled, UpdatedAt: now, RefreshSeconds: 15, HistoryHours: s.HistoryHours, Groups: []publicGroup{}}
	for _, config := range visibleGroups(s, userGroup) {
		g := publicGroup{GroupSettings: config, IntervalSeconds: config.interval(s), Runs: []RunSummary{}}
		var latest GroupState
		err := db.Where("group_name = ?", config.Group).Take(&latest).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return data, err
		}
		if s.Enabled && config.Enabled {
			g.NextAt = nextAutomaticAt(latest.LastAutoAt, g.IntervalSeconds, now)
		}
		var runs []Run
		err = db.Select(summaryColumns).Where("group_name = ? AND created_at >= ? AND (manual = ? OR manual IS NULL)", config.Group, now-int64(s.HistoryHours)*3600, false).Order("id DESC").Limit(600 * s.HistoryHours / 24).Find(&runs).Error
		if err != nil {
			return data, err
		}
		for _, r := range runs {
			g.Runs = append(g.Runs, r.summary())
		}
		// Automatic checks remain the statistical baseline. A manual version
		// cannot replace a failure in the scheduled timeline or inflate its rate.
		var counts []struct {
			Kind, Status, Quality string
			Manual                bool
			Count                 int64
		}
		if err := db.Model(&Run{}).Select("kind, status, quality, manual, COUNT(*) AS count").Where("group_name = ? AND created_at >= ? AND status <> ?", config.Group, now-86400, "running").Group("kind, status, quality, manual").Scan(&counts).Error; err != nil {
			return data, err
		}
		for _, count := range counts {
			if count.Manual {
				g.Totals.ManualTotal += count.Count
				continue
			}
			if count.Kind == "candy" {
				g.Totals.CandyTotal += count.Count
				if count.Status == "passed" {
					g.Totals.CandyPassed += count.Count
				}
			}
			if count.Kind == "svg" {
				g.Totals.SVGTotal += count.Count
				if count.Status == "passed" {
					g.Totals.SVGPassed += count.Count
					if count.Quality == "" {
						g.Totals.AwaitingReview += count.Count
					}
				}
			}
			if count.Status != "passed" || (count.Kind == "svg" && (count.Quality == "suspected" || count.Quality == "abnormal")) {
				g.Totals.Anomalies += count.Count
			}
		}
		data.Summary.CandyTotal += g.Totals.CandyTotal
		data.Summary.CandyPassed += g.Totals.CandyPassed
		data.Summary.SVGTotal += g.Totals.SVGTotal
		data.Summary.SVGPassed += g.Totals.SVGPassed
		data.Summary.Anomalies += g.Totals.Anomalies
		data.Summary.AwaitingReview += g.Totals.AwaitingReview
		data.Summary.ManualTotal += g.Totals.ManualTotal
		data.Groups = append(data.Groups, g)
	}
	return data, nil
}

func getRun(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.Status(http.StatusNotFound)
		return
	}
	db := model.DB.WithContext(c.Request.Context())
	s, _, err := getSettings(db)
	if err != nil {
		respond(c, nil, err)
		return
	}
	groups := []string{}
	for _, g := range visibleGroups(s, c.GetString("user_group")) {
		groups = append(groups, g.Group)
	}
	var run Run
	err = db.Where("id = ? AND group_name IN ?", id, groups).Take(&run).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.Status(http.StatusNotFound)
		return
	}
	if err != nil {
		respond(c, nil, err)
		return
	}
	var versions []RunSummary
	if err = db.Model(&Run{}).Select(summaryColumns).Where("group_name = ? AND (id = ? OR root_run_id = ?)", run.GroupName, run.seriesID(), run.seriesID()).Order("id DESC").Find(&versions).Error; err != nil {
		respond(c, nil, err)
		return
	}
	if c.Query("latest") == "true" && len(versions) > 0 && versions[0].ID != run.ID {
		group := run.GroupName
		run = Run{}
		if err = db.Where("id = ? AND group_name = ?", versions[0].ID, group).Take(&run).Error; err != nil {
			respond(c, nil, err)
			return
		}
	}
	respond(c, struct {
		Run
		Versions []RunSummary `json:"versions"`
	}{run, versions}, nil)
}

func getArtworks(c *gin.Context) {
	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	if err != nil || page < 1 || page > 100000 {
		respond(c, nil, errInvalid)
		return
	}
	db := model.DB.WithContext(c.Request.Context())
	s, _, err := getSettings(db)
	if err != nil {
		respond(c, nil, err)
		return
	}
	groups := []string{}
	filter := c.Query("group")
	for _, g := range visibleGroups(s, c.GetString("user_group")) {
		if filter == "" || filter == g.Group {
			groups = append(groups, g.Group)
		}
	}
	// Select a completed version before filtering for success: a failed retest
	// must not quietly resurrect an earlier successful image in the gallery.
	latest := db.Model(&Run{}).Select("MAX(id)").Where("group_name IN ? AND kind = ? AND status <> ?", groups, "svg", "running").Group("CASE WHEN root_run_id > 0 THEN root_run_id ELSE id END")
	query := db.Model(&Run{}).Where("id IN (?) AND status = ?", latest, "passed")
	var total int64
	if err = query.Count(&total).Error; err != nil {
		respond(c, nil, err)
		return
	}
	// Artwork HTML is fetched only when opened. Listing stays bounded even
	// when a model produces hundreds of kilobytes of animation code.
	items := []Run{}
	err = query.Select(summaryColumns + ", group_name, model").Order("id DESC").Offset((page - 1) * 15).Limit(15).Find(&items).Error
	respond(c, gin.H{"items": items, "total": total, "page": page, "page_size": 15}, err)
}
