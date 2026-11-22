package channelmonitor

import (
	"context"
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const probeTaskType = "extension_channel_monitor_probe"
const ProbePrompt = "Reply OK only."
const ProbeMaxTokens = 32

// ProbeRun is reserved before calling upstream. Interrupted attempts still count
// toward the rolling daily cap, so a restart never replays uncertain requests.
type ProbeRun struct {
	ID           int64  `gorm:"primaryKey" json:"-"`
	GroupName    string `gorm:"size:191;index:idx_monitor_probe_target,priority:1" json:"-"`
	Model        string `gorm:"size:200;index:idx_monitor_probe_target,priority:2" json:"model"`
	CreatedAt    int64  `gorm:"index:idx_monitor_probe_target,priority:3;index:idx_monitor_probe_created" json:"created_at"`
	FinishedAt   int64  `json:"-"`
	Status       string `gorm:"size:24" json:"status"`
	ChannelID    int    `json:"-"`
	TaskID       string `gorm:"size:64" json:"-"`
	LatencyMS    int64  `json:"latency_ms"`
	TTFTMS       *int64 `gorm:"column:ttft_ms" json:"ttft_ms"`
	InputTokens  int    `json:"input_tokens"`
	OutputTokens int    `json:"output_tokens"`
	Manual       bool   `json:"manual"`
}

func (ProbeRun) TableName() string { return "extension_channel_monitor_probes" }

func Migrate(db *gorm.DB) error { return db.AutoMigrate(&ProbeRun{}) }

type ProbeResult struct {
	ChannelID    int
	InputTokens  int
	OutputTokens int
	TTFTMS       *int64
}

type ProbeSummary struct {
	Samples       int      `json:"samples"`
	EnabledModels int      `json:"enabled_models"`
	SuccessRate   float64  `json:"success_rate"`
	TTFTSeconds   *float64 `json:"ttft_seconds"`
}

type ProbeExecutor func(context.Context, string, string) (ProbeResult, error)
type probeHandler struct {
	execute ProbeExecutor
	spacing time.Duration
}
type probePayload struct {
	Manual bool `json:"manual"`
}

func RegisterTasks(execute ProbeExecutor) {
	service.RegisterSystemTaskHandler(probeHandler{execute: execute, spacing: time.Second})
}

func (probeHandler) Type() string { return probeTaskType }
func (probeHandler) Interval() time.Duration {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	s, _, err := getSettings(model.DB.WithContext(ctx))
	if err != nil {
		return 30 * time.Minute
	}
	return time.Duration(max(5, min(1440, s.Probe.IntervalMinutes))) * time.Minute
}
func (probeHandler) NewPayload() any { return probePayload{} }
func (probeHandler) Enabled() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	s, _, err := getSettings(model.DB.WithContext(ctx))
	return err == nil && s.Enabled && s.Probe.Enabled
}

func (h probeHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	err := h.run(ctx, model.DB, model.LOG_DB, task, time.Now)
	status, message := model.SystemTaskStatusSucceeded, ""
	if err != nil {
		status, message = model.SystemTaskStatusFailed, "Channel monitor probe task failed"
		common.SysError("channel monitor probe task: " + err.Error())
	}
	if err := model.FinishSystemTask(task.TaskID, runnerID, status, nil, message); err != nil {
		common.SysError("channel monitor probe finish: " + err.Error())
	}
}

func (h probeHandler) run(ctx context.Context, db, logDB *gorm.DB, task *model.SystemTask, clock func() time.Time) error {
	var payload probePayload
	if task.Payload != "" && common.UnmarshalJsonStr(task.Payload, &payload) != nil {
		return errInvalid
	}
	// The system-task lease serializes manual and scheduled runs across nodes.
	if err := db.WithContext(ctx).Model(&ProbeRun{}).Where("status = ?", "running").Updates(map[string]any{"status": "interrupted", "finished_at": clock().Unix()}).Error; err != nil {
		return err
	}
	if err := db.WithContext(ctx).Where("created_at < ?", clock().Unix()-31*86400).Delete(&ProbeRun{}).Error; err != nil {
		return err
	}
	s, _, err := getSettings(db.WithContext(ctx))
	if err != nil || !s.Enabled || !payload.Manual && !s.Probe.Enabled {
		return err
	}
	for _, group := range s.Groups {
		for _, name := range group.ProbeModels {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			// Reload switches/targets before each request: saving disables queued work.
			current, _, err := getSettings(db.WithContext(ctx))
			if err != nil || !current.Enabled || !payload.Manual && !current.Probe.Enabled {
				return err
			}
			if !probeTargetSelected(current, group.Group, name) {
				continue
			}
			now := clock().Unix()
			var count int64
			if err := db.WithContext(ctx).Model(&ProbeRun{}).Where("created_at > ?", now-86400).Count(&count).Error; err != nil {
				return err
			}
			if count >= int64(current.Probe.DailyLimit) {
				return nil
			}
			interval := int64(current.Probe.IntervalMinutes) * 60
			if payload.Manual {
				interval = 60
			}
			if err := db.WithContext(ctx).Model(&ProbeRun{}).Where("group_name = ? AND model = ? AND created_at > ?", group.Group, name, now-interval).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				continue
			}
			if !ratio_setting.ContainsGroupRatio(group.Group) {
				continue
			}
			if err := db.WithContext(ctx).Model(&model.Ability{}).Where(clause.Eq{Column: "group", Value: group.Group}).Where("model = ? AND enabled = ?", name, true).Count(&count).Error; err != nil {
				return err
			}
			if count == 0 {
				continue
			}
			if !payload.Manual && current.Probe.OnlyWhenIdle {
				// Missing logs cannot establish idleness. Fail closed on query errors.
				if !common.LogConsumeEnabled || !constant.ErrorLogEnabled {
					continue
				}
				if err := logDB.WithContext(ctx).Model(&model.Log{}).Where(clause.Eq{Column: "group", Value: group.Group}).
					Where("model_name = ? AND created_at >= ? AND type IN ? AND channel_id > 0", name, now-int64(current.Probe.IntervalMinutes)*60, []int{model.LogTypeConsume, model.LogTypeError}).Count(&count).Error; err != nil {
					return err
				}
				if count > 0 {
					continue
				}
			}
			run := ProbeRun{GroupName: group.Group, Model: name, CreatedAt: now, Status: "running", TaskID: task.TaskID, Manual: payload.Manual}
			if err := db.WithContext(ctx).Create(&run).Error; err != nil {
				return err
			}
			if err := h.probe(ctx, db, run); err != nil {
				return err
			}
			if h.spacing > 0 {
				timer := time.NewTimer(h.spacing)
				select {
				case <-timer.C:
				case <-ctx.Done():
					timer.Stop()
					return ctx.Err()
				}
			}
		}
	}
	return nil
}

func probeTargetSelected(s Settings, group, name string) bool {
	for _, g := range s.Groups {
		if g.Group != group {
			continue
		}
		for _, m := range g.ProbeModels {
			if m == name {
				return true
			}
		}
	}
	return false
}

func (h probeHandler) probe(ctx context.Context, db *gorm.DB, run ProbeRun) error {
	probeCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	start := time.Now()
	result, err := h.execute(probeCtx, run.GroupName, run.Model)
	status := "passed"
	if err != nil {
		status = "failed"
	}
	if errors.Is(probeCtx.Err(), context.DeadlineExceeded) {
		status = "timeout"
	}
	if ctx.Err() != nil {
		status = "interrupted"
	}
	// No raw provider output/errors or credentials enter public probe history.
	writeCtx, writeCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer writeCancel()
	return db.WithContext(writeCtx).Model(&ProbeRun{}).Where("id = ? AND task_id = ? AND status = ?", run.ID, run.TaskID, "running").Updates(map[string]any{
		"status": status, "channel_id": result.ChannelID, "input_tokens": max(0, result.InputTokens), "output_tokens": max(0, result.OutputTokens),
		"ttft_ms": result.TTFTMS, "latency_ms": time.Since(start).Milliseconds(), "finished_at": time.Now().Unix(),
	}).Error
}

func startProbe(c *gin.Context) {
	s, _, err := getSettings(model.DB.WithContext(c.Request.Context()))
	if err != nil {
		respond(c, nil, err)
		return
	}
	targets := 0
	for _, group := range s.Groups {
		targets += len(group.ProbeModels)
	}
	if !s.Enabled || targets == 0 {
		respond(c, nil, errInvalid)
		return
	}
	task, created, err := service.EnqueueSystemTask(probeTaskType, probePayload{Manual: true})
	if err != nil {
		respond(c, nil, err)
		return
	}
	respond(c, gin.H{"task_id": task.TaskID, "created": created}, nil)
}

// overlayProbes keeps all real traffic metrics intact. Probes color empty
// timeline periods only; their counts and rates remain separately labelled.
func overlayProbes(db *gorm.DB, stats *GroupStats, group string, window time.Duration, now int64, freshness int64) error {
	var runs []ProbeRun
	if err := db.Where("group_name = ? AND created_at >= ? AND created_at <= ? AND status IN ?", group, now-int64(window.Seconds()), now, []string{"passed", "failed", "timeout"}).Order("created_at DESC").Order("id DESC").Limit(sampleLimit).Find(&runs).Error; err != nil {
		return err
	}
	latest := make(map[string]bool)
	for _, run := range runs {
		for i := range stats.Timeline {
			bucket := &stats.Timeline[i]
			if run.CreatedAt < bucket.Start || run.CreatedAt >= bucket.End {
				continue
			}
			bucket.Probes++
			if run.Status == "passed" {
				bucket.ProbeSuccesses++
			}
		}
		if latest[run.Model] || run.CreatedAt < now-freshness {
			continue
		}
		latest[run.Model] = true
		for i := range stats.Models {
			if stats.Models[i].Model == run.Model && stats.Models[i].Enabled {
				copy := run
				stats.Models[i].Probe = &copy
			}
		}
	}
	for i := range stats.Timeline {
		b := &stats.Timeline[i]
		if b.Outcomes == 0 && b.Probes > 0 {
			rate := float64(b.ProbeSuccesses) / float64(b.Probes) * 100
			b.Status = healthStatus(b.Probes, &rate)
			b.Source = "probe"
		}
	}
	var summary ProbeSummary
	var successes, ttftSamples int
	var ttftTotal int64
	for _, model := range stats.Models {
		if !model.Enabled {
			continue
		}
		summary.EnabledModels++
		if model.Probe == nil {
			continue
		}
		summary.Samples++
		if model.Probe.Status == "passed" {
			successes++
			if model.Probe.TTFTMS != nil && *model.Probe.TTFTMS >= 0 {
				ttftTotal += *model.Probe.TTFTMS
				ttftSamples++
			}
		}
	}
	if summary.Samples > 0 {
		summary.SuccessRate = float64(successes) / float64(summary.Samples) * 100
		if ttftSamples > 0 {
			seconds := float64(ttftTotal) / float64(ttftSamples) / 1000
			summary.TTFTSeconds = &seconds
		}
		stats.ProbeSummary = &summary
	}
	return nil
}

// Probe health is a fallback only when the entire group lacks real outcomes.
// A partial set of successful sampled models never proves the whole group healthy.
func probeHealth(stats GroupStats) string {
	outcomes, successes, enabled := 0, 0, 0
	for _, model := range stats.Models {
		if !model.Enabled {
			continue
		}
		enabled++
		if model.Probe == nil {
			continue
		}
		outcomes++
		if model.Probe.Status == "passed" {
			successes++
		}
	}
	if outcomes == 0 {
		return "idle"
	}
	if successes == outcomes && outcomes < enabled {
		return "unknown"
	}
	rate := float64(successes) / float64(outcomes) * 100
	return healthStatus(outcomes, &rate)
}
