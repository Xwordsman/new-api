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
	admin.POST("/run", middleware.SessionCookieOriginGuard(), middleware.UserCriticalRateLimit("benchmark-run"), manualRun)
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
	if errors.Is(err, errInvalid) || errors.Is(err, errConflict) {
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

func manualRun(c *gin.Context) {
	var payload taskPayload
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	if common.DecodeJson(c.Request.Body, &payload) != nil || payload.Group == "" {
		respond(c, nil, errInvalid)
		return
	}
	s, _, err := getSettings(model.DB.WithContext(c.Request.Context()))
	if err != nil {
		respond(c, nil, err)
		return
	}
	if !s.Enabled || !slices.ContainsFunc(s.Groups, func(g GroupSettings) bool { return g.Group == payload.Group && g.Enabled }) {
		respond(c, nil, errInvalid)
		return
	}
	_, created, err := service.EnqueueSystemTask(taskType, payload)
	if err != nil {
		respond(c, nil, err)
		return
	}
	if !created {
		common.ApiErrorT(c, "A benchmark batch is already running. Try again after it finishes.")
		return
	}
	respond(c, gin.H{"queued": true}, nil)
}

type totals struct {
	CandyTotal  int64 `json:"candy_total"`
	CandyPassed int64 `json:"candy_passed"`
	SVGTotal    int64 `json:"svg_total"`
	SVGPassed   int64 `json:"svg_passed"`
	Anomalies   int64 `json:"anomalies"`
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
	data := snapshot{Enabled: s.Enabled, UpdatedAt: now, RefreshSeconds: 15, Groups: []publicGroup{}}
	for _, config := range visibleGroups(s, userGroup) {
		g := publicGroup{GroupSettings: config, IntervalSeconds: config.interval(s), Runs: []RunSummary{}}
		var latest GroupState
		err := db.Where("group_name = ?", config.Group).Take(&latest).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return data, err
		}
		if s.Enabled && config.Enabled {
			g.NextAt = max(now, latest.LastAutoAt+g.IntervalSeconds)
		}
		var runs []Run
		err = db.Select("id", "kind", "status", "created_at", "latency_ms", "prompt_name").Where("group_name = ? AND created_at >= ?", config.Group, now-86400).Order("id DESC").Limit(600).Find(&runs).Error
		if err != nil {
			return data, err
		}
		for _, r := range runs {
			g.Runs = append(g.Runs, r.summary())
		}
		// Totals cover every completed result, including when the timeline's
		// bounded metadata sample is smaller than an unusually busy history.
		var counts []struct {
			Kind, Status string
			Count        int64
		}
		if err := db.Model(&Run{}).Select("kind, status, COUNT(*) AS count").Where("group_name = ? AND created_at >= ? AND status <> ?", config.Group, now-86400, "running").Group("kind, status").Scan(&counts).Error; err != nil {
			return data, err
		}
		for _, count := range counts {
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
				}
			}
			if count.Status != "passed" {
				g.Totals.Anomalies += count.Count
			}
		}
		data.Summary.CandyTotal += g.Totals.CandyTotal
		data.Summary.CandyPassed += g.Totals.CandyPassed
		data.Summary.SVGTotal += g.Totals.SVGTotal
		data.Summary.SVGPassed += g.Totals.SVGPassed
		data.Summary.Anomalies += g.Totals.Anomalies
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
	respond(c, run, err)
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
	query := db.Model(&Run{}).Where("group_name IN ? AND kind = ? AND status = ?", groups, "svg", "passed")
	var total int64
	if err = query.Count(&total).Error; err != nil {
		respond(c, nil, err)
		return
	}
	// Artwork HTML is fetched only when opened. Listing stays bounded even
	// when a model produces hundreds of kilobytes of animation code.
	items := []Run{}
	err = query.Select("id", "group_name", "model", "kind", "prompt_name", "status", "created_at", "latency_ms").Order("id DESC").Offset((page - 1) * 15).Limit(15).Find(&items).Error
	respond(c, gin.H{"items": items, "total": total, "page": page, "page_size": 15}, err)
}
