package benchmark

import (
	"context"
	"errors"
	"io"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"golang.org/x/net/html"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const taskType = "extension_benchmark"
const maxOutputBytes = 512 << 10

// ProbeExecutor is supplied by the gateway so probes share the existing
// provider adapters, model mapping and channel parameter overrides.
type ProbeExecutor func(context.Context, string, string, string, int) (ProbeResult, error)

type ProbeResult struct {
	Output       string
	Truncated    bool
	ChannelID    int
	InputTokens  int
	OutputTokens int
}

type taskHandler struct{ execute ProbeExecutor }
type taskPayload struct {
	Group string `json:"group"`
}

func RegisterTasks(execute ProbeExecutor) {
	service.RegisterSystemTaskHandler(taskHandler{execute: execute})
}
func (taskHandler) Type() string { return taskType }
func (taskHandler) Enabled() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	db := model.DB.WithContext(ctx)
	s, _, err := getSettings(db)
	if err != nil {
		common.SysError("benchmark scheduler: " + err.Error())
		return false
	}
	groups, err := scheduledGroups(db, s, time.Now().Unix(), "")
	if err != nil {
		common.SysError("benchmark scheduler: " + err.Error())
		return false
	}
	if len(groups) > 0 {
		return true
	}
	// Housekeeping must also run when checks are disabled or all groups are
	// waiting for their next interval. It never sends an upstream request.
	var pending int64
	err = db.Model(&Run{}).Where("created_at < ? OR status = ?", time.Now().Unix()-int64(s.RetentionDays)*86400, "running").Count(&pending).Error
	if err != nil {
		common.SysError("benchmark scheduler: " + err.Error())
	}
	return err == nil && pending > 0
}
func (taskHandler) Interval() time.Duration { return 15 * time.Second }
func (taskHandler) NewPayload() any         { return taskPayload{} }

// scheduledGroups respects each group's interval independently. Manual checks
// neither postpone nor accelerate the automatic schedule.
func scheduledGroups(db *gorm.DB, s Settings, now int64, manualGroup string) ([]GroupSettings, error) {
	groups := make([]GroupSettings, 0)
	if !s.Enabled {
		return groups, nil
	}
	for _, g := range s.Groups {
		if g.Enabled && (manualGroup == "" || manualGroup == g.Group) {
			groups = append(groups, g)
		}
	}
	if manualGroup != "" || len(groups) == 0 {
		return groups, nil
	}
	var latest []GroupState
	if err := db.Find(&latest).Error; err != nil {
		return nil, err
	}
	lastRun := make(map[string]int64, len(latest))
	for _, r := range latest {
		lastRun[r.GroupName] = r.LastAutoAt
	}
	due := make([]GroupSettings, 0, len(groups))
	for _, g := range groups {
		if lastRun[g.Group] == 0 || now >= lastRun[g.Group]+g.interval(s) {
			due = append(due, g)
		}
	}
	return due, nil
}

func (h taskHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	err := h.run(ctx, model.DB, task)
	status := model.SystemTaskStatusSucceeded
	message := ""
	if err != nil {
		status = model.SystemTaskStatusFailed
		message = "Benchmark task could not complete"
		common.SysError("benchmark task: " + err.Error())
	}
	if err := model.FinishSystemTask(task.TaskID, runnerID, status, nil, message); err != nil {
		common.SysError("benchmark task finish: " + err.Error())
	}
}

func (h taskHandler) run(ctx context.Context, db *gorm.DB, task *model.SystemTask) error {
	// The system task lease serializes all benchmark batches. Any running rows
	// left by a previous lease/process are interrupted, never silently passed.
	now := time.Now().Unix()
	if err := db.WithContext(ctx).Model(&Run{}).Where("status = ?", "running").Updates(map[string]any{
		"status": "interrupted", "error_code": "interrupted", "finished_at": now,
	}).Error; err != nil {
		return err
	}
	s, _, err := getSettings(db.WithContext(ctx))
	if err != nil {
		return err
	}
	if err := db.WithContext(ctx).Where("created_at < ? AND status <> ?", now-int64(s.RetentionDays)*86400, "running").Delete(&Run{}).Error; err != nil {
		return err
	}
	if !s.Enabled {
		return nil
	}
	var payload taskPayload
	if task.Payload != "" && common.UnmarshalJsonStr(task.Payload, &payload) != nil {
		return errInvalid
	}
	groups, err := scheduledGroups(db.WithContext(ctx), s, now, payload.Group)
	if err != nil {
		return err
	}
	jobs := make([]Run, 0)
	for _, g := range groups {
		var batch []Run
		var state GroupState
		if err := db.WithContext(ctx).Where("group_name = ?", g.Group).Take(&state).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		state.GroupName = g.Group
		base := Run{GroupName: g.Group, Model: g.Model, Status: "running", CreatedAt: now, TaskID: task.TaskID, Manual: payload.Group != ""}
		if g.CandyEnabled {
			r := base
			r.Kind, r.Prompt, r.Expected = "candy", s.CandyPrompt, s.CandyAnswer
			batch = append(batch, r)
		}
		prompts := make([]SVGPrompt, 0)
		for _, p := range s.SVGPrompts {
			if p.Enabled {
				prompts = append(prompts, p)
			}
		}
		if g.SVGEnabled && len(prompts) > 0 {
			p := prompts[state.SVGSequence%int64(len(prompts))]
			state.SVGSequence++
			r := base
			r.Kind, r.PromptName, r.Prompt = "svg", p.Name, p.Prompt
			batch = append(batch, r)
		}
		if len(batch) == 0 {
			continue
		}
		if payload.Group == "" {
			state.LastAutoAt = now
		}
		if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := tx.Create(&batch).Error; err != nil {
				return err
			}
			return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "group_name"}}, DoUpdates: clause.AssignmentColumns([]string{"last_auto_at", "svg_sequence"})}).Create(&state).Error
		}); err != nil {
			return err
		}
		jobs = append(jobs, batch...)
	}
	// Four bounded workers avoid head-of-line blocking across groups while
	// keeping platform probe traffic predictable (no retries on a bad answer).
	queue := make(chan Run, len(jobs))
	for _, job := range jobs {
		queue <- job
	}
	close(queue)
	var wg sync.WaitGroup
	var workerErr error
	var errMu sync.Mutex
	for range min(4, len(jobs)) {
		wg.Go(func() {
			defer func() {
				if recover() != nil {
					errMu.Lock()
					workerErr = errors.Join(workerErr, errors.New("benchmark worker interrupted"))
					errMu.Unlock()
				}
			}()
			for job := range queue {
				if ctx.Err() != nil {
					return
				}
				if err := h.probe(ctx, db, s, job); err != nil {
					errMu.Lock()
					workerErr = errors.Join(workerErr, err)
					errMu.Unlock()
				}
			}
		})
	}
	wg.Wait()
	writeCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cleanupErr := db.WithContext(writeCtx).Model(&Run{}).Where("task_id = ? AND status = ?", task.TaskID, "running").Updates(map[string]any{
		"status": "interrupted", "error_code": "interrupted", "finished_at": time.Now().Unix(),
	}).Error
	return errors.Join(workerErr, ctx.Err(), cleanupErr)
}

func (h taskHandler) probe(ctx context.Context, db *gorm.DB, s Settings, run Run) error {
	maxTokens := s.CandyMaxTokens
	if run.Kind == "svg" {
		maxTokens = s.SVGMaxTokens
	}
	probeCtx, cancel := context.WithTimeout(ctx, time.Duration(s.TimeoutSeconds)*time.Second)
	defer cancel()
	start := time.Now()
	result, err := h.execute(probeCtx, run.GroupName, run.Model, run.Prompt, maxTokens)
	status, code := evaluate(run, result, err)
	if errors.Is(probeCtx.Err(), context.DeadlineExceeded) {
		status, code = "timeout", "timeout"
	}
	if ctx.Err() != nil {
		status, code = "interrupted", "interrupted"
	}
	if len(result.Output) > maxOutputBytes {
		result.Output = ""
	}
	// A canceled lease must still persist the interruption. Never retain raw
	// network errors: provider URLs/credentials can occur in their messages.
	writeCtx, writeCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer writeCancel()
	return db.WithContext(writeCtx).Model(&Run{}).Where("id = ? AND status = ? AND task_id = ?", run.ID, "running", run.TaskID).Updates(map[string]any{
		"status": status, "error_code": code, "output": result.Output, "channel_id": result.ChannelID,
		"input_tokens": result.InputTokens, "output_tokens": result.OutputTokens,
		"latency_ms": time.Since(start).Milliseconds(), "finished_at": time.Now().Unix(),
	}).Error
}

func evaluate(run Run, result ProbeResult, err error) (string, string) {
	if err != nil {
		return "request_failed", "request_failed"
	}
	if len(result.Output) > maxOutputBytes {
		return "invalid", "output_too_large"
	}
	if result.Truncated {
		return "truncated", "truncated"
	}
	if run.Kind == "candy" {
		if strings.TrimSpace(result.Output) == strings.TrimSpace(run.Expected) {
			return "passed", ""
		}
		return "wrong_answer", "wrong_answer"
	}
	// Validate a complete SVG subtree, not a substring in explanatory text.
	// Scripts are executed only inside the browser's isolated preview sandbox.
	tokenizer := html.NewTokenizer(strings.NewReader(result.Output))
	var stack []string
	elements, completed := 0, false
	for {
		token := tokenizer.Next()
		if token == html.ErrorToken {
			if tokenizer.Err() != io.EOF {
				return "invalid", "invalid_svg"
			}
			break
		}
		if token != html.StartTagToken && token != html.EndTagToken && token != html.SelfClosingTagToken {
			continue
		}
		name, _ := tokenizer.TagName()
		tag := string(name)
		if len(stack) == 0 {
			if tag != "svg" {
				continue
			}
			if token != html.StartTagToken {
				return "invalid", "invalid_svg"
			}
			stack = append(stack, tag)
			elements = 0
			continue
		}
		switch token {
		case html.StartTagToken:
			stack = append(stack, tag)
			elements++
		case html.SelfClosingTagToken:
			elements++
		case html.EndTagToken:
			if tag != stack[len(stack)-1] {
				return "invalid", "invalid_svg"
			}
			stack = stack[:len(stack)-1]
			if len(stack) == 0 {
				if elements == 0 {
					return "invalid", "invalid_svg"
				}
				completed = true
			}
		}
	}
	if !completed || len(stack) != 0 {
		return "invalid", "invalid_svg"
	}
	return "passed", ""
}
