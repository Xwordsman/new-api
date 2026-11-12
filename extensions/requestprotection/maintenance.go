package requestprotection

import (
	"context"
	"errors"
	"fmt"
	"html"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/extensions/requestprotection/policy"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const taskType = "extension-request-protection"

type taskHandler struct{}

func RegisterTasks()                        { service.RegisterSystemTaskHandler(taskHandler{}) }
func (taskHandler) Type() string            { return taskType }
func (taskHandler) Interval() time.Duration { return time.Minute }
func (taskHandler) NewPayload() any         { return struct{}{} }
func (taskHandler) Enabled() bool           { return true }
func (taskHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	err := Maintain(model.DB.WithContext(ctx), time.Now().Unix())
	status, message := model.SystemTaskStatusSucceeded, ""
	if err != nil {
		status, message = model.SystemTaskStatusFailed, "Request protection is temporarily unavailable"
		common.SysError("request protection maintenance: " + err.Error())
	}
	if err := model.FinishSystemTask(task.TaskID, runnerID, status, nil, message); err != nil {
		common.SysError("request protection task finish: " + err.Error())
	}
}

func Maintain(db *gorm.DB, now int64) error {
	s, err := policy.GetSettings(db)
	if err != nil {
		return err
	}
	cutoff := now - int64(s.RetentionDays)*86400
	// Keep evidence needed to review every live restriction, even when its
	// configured lifetime exceeds retention. Expired records purge normally.
	var active []policy.Subject
	if err = db.Where("expires_at > ?", now).Find(&active).Error; err != nil {
		return err
	}
	for _, state := range active {
		cutoff = min(cutoff, state.StartedAt-int64(state.WindowMinutes)*60)
	}
	for _, table := range []any{&policy.Event{}, &policy.Audit{}, &policy.Alert{}} {
		if err = db.Where("created_at < ?", cutoff).Delete(table).Error; err != nil {
			return err
		}
	}
	// Watermarks must survive retention, so historical scores cannot reappear.
	if !s.Enabled || !s.AlertEnabled {
		return nil
	}
	interval := int64(s.AlertMinutes) * 60
	end := now / interval * interval
	start := end - interval
	var previous policy.Alert
	err = db.Where("minutes = ?", s.AlertMinutes).Order("window_end DESC").Take(&previous).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if err == nil {
		start = max(previous.WindowEnd, end-86400)
	}
	// Catch up at most one day after downtime; persist empty windows too so
	// multiple nodes do not repeatedly rescan every quiet interval.
	for ; start < end; start += interval {
		var count int64
		if err = db.Model(&policy.Event{}).Where("created_at >= ? AND created_at < ? AND decision = ? AND review <> ?", start, start+interval, "block", "false_positive").Count(&count).Error; err != nil {
			return err
		}
		alert := policy.Alert{Bucket: fmt.Sprintf("%d:%d", interval, start), WindowStart: start, WindowEnd: start + interval, Minutes: s.AlertMinutes, CreatedAt: now, Count: count}
		if count < int64(s.AlertThreshold) {
			alert.DeliveredAt = now
		}
		if err = db.Clauses(clause.OnConflict{DoNothing: true}).Create(&alert).Error; err != nil {
			return err
		}
	}
	var alerts []policy.Alert
	if err = db.Where("delivered_at = 0 AND lease_until <= ? AND next_attempt_at <= ?", now, now).Order("id").Limit(5).Find(&alerts).Error; err != nil {
		return err
	}
	for _, alert := range alerts {
		r := db.Model(&policy.Alert{}).Where("id = ? AND delivered_at = 0 AND lease_until <= ?", alert.ID, now).Update("lease_until", now+600)
		if r.Error != nil {
			return r.Error
		}
		if r.RowsAffected != 1 {
			continue
		}
		message := i18n.Translate("", "request_protection.alert", map[string]any{"count": alert.Count, "minutes": alert.Minutes})
		err = common.SendEmailWithTemplate(i18n.Translate("", "request_protection.subject"), strings.Join(s.AlertEmails, ";"), "<p>"+html.EscapeString(message)+"</p>", common.EmailTemplateData{Type: common.EmailTemplateRiskAlert})
		delivered := int64(0)
		if err == nil {
			delivered = now
		} else {
			common.SysError(fmt.Sprintf("request protection alert %d delivery failed", alert.ID))
		}
		if err = db.Model(&policy.Alert{}).Where("id = ?", alert.ID).Updates(map[string]any{"delivered_at": delivered, "lease_until": 0, "attempts": alert.Attempts + 1, "next_attempt_at": now + min(int64(3600), int64(60)*(1<<min(alert.Attempts, 6)))}).Error; err != nil {
			return err
		}
	}
	return nil
}
