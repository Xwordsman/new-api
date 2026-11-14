package channelmonitor

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/groupdiscount"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type cacheKey struct {
	Group    string
	Window   time.Duration
	Complete bool
}

type cachedStats struct {
	Stats GroupStats
	At    int64
}

var statisticsCache = struct {
	sync.Mutex
	entries map[cacheKey]cachedStats
}{entries: make(map[cacheKey]cachedStats)}

type publicGroup struct {
	GroupSettings
	Ratio     float64             `json:"ratio"`
	BaseRatio float64             `json:"base_ratio"`
	Offer     groupdiscount.Offer `json:"offer"`
	Status    string              `json:"status"`
	GroupStats
}

type snapshot struct {
	Enabled             bool          `json:"enabled"`
	Window              string        `json:"window"`
	UpdatedAt           int64         `json:"updated_at"`
	RefreshSeconds      int           `json:"refresh_seconds"`
	ConsumeLogsEnabled  bool          `json:"consume_logs_enabled"`
	ErrorLogsEnabled    bool          `json:"error_logs_enabled"`
	SampleLimitPerGroup int           `json:"sample_limit_per_group"`
	Groups              []publicGroup `json:"groups"`
	Summary             Metrics       `json:"summary"`
}

func RegisterRoutes(apiRouter *gin.RouterGroup) {
	users := apiRouter.Group("/extensions/channel-monitor", middleware.UserAuth(), middleware.DisableCache())
	users.GET("/snapshot", getSnapshot)
	admin := apiRouter.Group("/extensions/channel-monitor/admin", middleware.RootAuth(), middleware.DisableCache())
	admin.GET("/settings", adminSettings)
	admin.PUT("/settings", middleware.SessionCookieOriginGuard(), middleware.UserCriticalRateLimit("channel-monitor-admin"), updateSettings)
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
	common.SysError("channel monitor: " + err.Error())
	common.ApiErrorT(c, "Unable to load channel monitor data")
}

func adminSettings(c *gin.Context) {
	settings, _, err := getSettings(model.DB.WithContext(c.Request.Context()))
	if err != nil {
		respond(c, nil, err)
		return
	}
	type availableGroup struct {
		Group string  `json:"group"`
		Ratio float64 `json:"ratio"`
	}
	groups := make([]availableGroup, 0)
	ratios := ratio_setting.GetGroupRatioCopy()
	names := make([]string, 0, len(ratios))
	for group := range ratios {
		names = append(names, group)
	}
	for _, group := range setting.OrderGroupNames(names) {
		ratio := ratios[group]
		if group != "auto" && group != "" {
			groups = append(groups, availableGroup{Group: group, Ratio: ratio})
		}
	}
	respond(c, gin.H{"settings": settings, "available_groups": groups}, nil)
}

func updateSettings(c *gin.Context) {
	var settings Settings
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
	if common.DecodeJson(c.Request.Body, &settings) != nil {
		respond(c, nil, errInvalid)
		return
	}
	saved, err := saveSettings(model.DB.WithContext(c.Request.Context()), settings)
	respond(c, saved, err)
}

func getSnapshot(c *gin.Context) {
	windowName := c.DefaultQuery("window", "24h")
	window, ok := map[string]time.Duration{"24h": 24 * time.Hour, "7d": 7 * 24 * time.Hour, "30d": 30 * 24 * time.Hour}[windowName]
	if !ok {
		common.ApiErrorT(c, "Invalid channel monitor time range")
		return
	}
	// Dashboard authentication supplies the server-verified current user group.
	userGroup := c.GetString("user_group")
	// A query timeout also bounds work on external log databases. Errors never
	// replace a failed query with an apparently healthy/empty result.
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	data, err := buildSnapshot(model.DB.WithContext(ctx), model.LOG_DB.WithContext(ctx), userGroup, windowName, window, time.Now().Unix())
	respond(c, data, err)
}

func buildSnapshot(db, logDB *gorm.DB, userGroup, windowName string, window time.Duration, now int64) (snapshot, error) {
	settings, _, err := getSettings(db)
	data := snapshot{Enabled: settings.Enabled, Window: windowName, UpdatedAt: now, RefreshSeconds: 30,
		ConsumeLogsEnabled: common.LogConsumeEnabled, ErrorLogsEnabled: constant.ErrorLogEnabled, SampleLimitPerGroup: sampleLimit, Groups: []publicGroup{}}
	if err != nil || !settings.Enabled {
		return data, err
	}
	offers := groupdiscount.Default.Offers(time.Unix(now, 0))
	for _, config := range settings.Groups {
		if !ratio_setting.ContainsGroupRatio(config.Group) {
			continue
		}
		// Publishing a group does not expand the caller's routing permissions.
		if !service.IsUserSelectableGroup(userGroup, config.Group) {
			continue
		}
		var enabledModels []string
		err = db.Model(&model.Ability{}).Where(clause.Eq{Column: "group", Value: config.Group}).
			Where("enabled = ?", true).Distinct("model").Pluck("model", &enabledModels).Error
		if err != nil {
			return data, err
		}
		key := cacheKey{Group: config.Group, Window: window, Complete: data.ConsumeLogsEnabled && data.ErrorLogsEnabled}
		statisticsCache.Lock()
		cached, found := statisticsCache.entries[key]
		if !found || now-cached.At >= 30 || now < cached.At {
			// Evict old entries, including groups removed by an administrator.
			for oldKey, old := range statisticsCache.entries {
				if now-old.At >= 30 || now < old.At {
					delete(statisticsCache.entries, oldKey)
				}
			}
			cached.Stats, err = collectStats(logDB, config.Group, window, now, key.Complete)
			cached.At = now
			if err == nil {
				statisticsCache.entries[key] = cached
			}
		}
		statisticsCache.Unlock()
		if err != nil {
			return data, err
		}
		// Copy the model slice before overlaying live route availability on cached
		// statistics. User-specific prices never enter this shared cache.
		stats := cached.Stats
		stats.Models = slices.Clone(stats.Models)
		seen := make(map[string]bool)
		for i := range stats.Models {
			stats.Models[i].Enabled = slices.Contains(enabledModels, stats.Models[i].Model)
			seen[stats.Models[i].Model] = true
		}
		for _, name := range enabledModels {
			if !seen[name] {
				stats.Models = append(stats.Models, ModelStats{Model: name, Enabled: true})
			}
		}
		slices.SortFunc(stats.Models, func(a, b ModelStats) int { return strings.Compare(a.Model, b.Model) })
		status := healthStatus(stats.Outcomes, stats.SuccessRate)
		if len(enabledModels) == 0 {
			status = "disabled"
		}
		base := ratio_setting.GetGroupRatio(config.Group)
		offer, exists := offers[config.Group]
		if !exists {
			offer.Factor = 1
		}
		data.Groups = append(data.Groups, publicGroup{GroupSettings: config, Ratio: base * offer.Factor,
			BaseRatio: base, Offer: offer, Status: status, GroupStats: stats})
		data.UpdatedAt = min(data.UpdatedAt, cached.At)
		m := &data.Summary
		m.Outcomes += stats.Outcomes
		m.Successes += stats.Successes
		m.TTFTSamples += stats.TTFTSamples
		m.SpeedSamples += stats.SpeedSamples
		m.CacheSamples += stats.CacheSamples
		m.LatencySamples += stats.LatencySamples
		m.latencySeconds += stats.latencySeconds
		if stats.FastestTTFT != nil && (m.FastestTTFT == nil || *stats.FastestTTFT < *m.FastestTTFT) {
			m.FastestTTFT = stats.FastestTTFT
		}
		if stats.MaxTokensPerSecond != nil && (m.MaxTokensPerSecond == nil || *stats.MaxTokensPerSecond > *m.MaxTokensPerSecond) {
			m.MaxTokensPerSecond = stats.MaxTokensPerSecond
		}
		m.frtMS += stats.frtMS
		m.generationMS += stats.generationMS
		m.outputTokens += stats.outputTokens
		m.inputTokens += stats.inputTokens
		m.cacheTokens += stats.cacheTokens
	}
	data.Summary.finish(data.ConsumeLogsEnabled && data.ErrorLogsEnabled)
	return data, nil
}
