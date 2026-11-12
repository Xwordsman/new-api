package registrationrisk

import (
	"bytes"
	"context"
	"fmt"
	"html"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/extensions/registrationrisk/guard"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const taskType = "extension-registration-risk"

type taskHandler struct{}
type taskPayload struct {
	Force bool `json:"force"`
}

func RegisterTasks()                        { service.RegisterSystemTaskHandler(taskHandler{}) }
func (taskHandler) Type() string            { return taskType }
func (taskHandler) Interval() time.Duration { return time.Minute }
func (taskHandler) NewPayload() any         { return taskPayload{} }
func (taskHandler) Enabled() bool           { return true }
func (taskHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	var payload taskPayload
	err := task.DecodePayload(&payload)
	if err == nil {
		err = maintain(model.DB.WithContext(ctx), time.Now(), payload.Force)
	}
	status, message := model.SystemTaskStatusSucceeded, ""
	if err != nil {
		status, message = model.SystemTaskStatusFailed, "Registration protection is temporarily unavailable"
		common.SysError("registration risk maintenance: " + err.Error())
	}
	if err := model.FinishSystemTask(task.TaskID, runnerID, status, nil, message); err != nil {
		common.SysError("registration risk task finish: " + err.Error())
	}
}
func checkAlerts(c *gin.Context) {
	_, _, err := service.EnqueueSystemTask(taskType, taskPayload{Force: true})
	respond(c, nil, err)
}

// Shared counters deduplicate alerts across nodes. Delivery receipts distinguish
// the email and webhook legs so a failed webhook does not resend successful mail.
func maintain(db *gorm.DB, now time.Time, force bool) error {
	s, err := guard.GetSettings(db)
	if err != nil {
		return err
	}
	start := now.Unix() / int64(s.AlertMinutes*60) * int64(s.AlertMinutes*60)
	var runs int64
	if err := db.Transaction(func(tx *gorm.DB) error {
		var err error
		runs, err = guard.Increment(tx, fmt.Sprintf("maintenance:%d", start), start+int64(s.AlertMinutes*60), 1)
		return err
	}); err != nil {
		return err
	}
	if runs == 1 || force {
		cutoff := now.Unix() - int64(s.RetentionDays)*86400
		for _, table := range []any{&guard.Event{}, &guard.Audit{}} {
			if err := db.Where("created_at < ?", cutoff).Delete(table).Error; err != nil {
				return err
			}
		}
		if err := db.Where("expires_at < ?", now.Unix()).Delete(&guard.Counter{}).Error; err != nil {
			return err
		}
		if err := db.Where("expires_at < ? AND failure_reset_at < ? AND resend_at < ?", cutoff, cutoff, cutoff).Delete(&guard.Challenge{}).Error; err != nil {
			return err
		}
		if err := db.Where("created_at < ? AND state <> ?", cutoff, "reserved").Delete(&guard.Reservation{}).Error; err != nil {
			return err
		}
		if err := db.Where("created_at < ? AND delivered_at > 0", cutoff).Delete(&guard.Alert{}).Error; err != nil {
			return err
		}
		if s.AlertEnabled {
			since := now.Unix() - int64(s.AlertWindowMinutes)*60
			var risks, mails, completed int64
			if err := db.Model(&guard.Event{}).Where("created_at >= ? AND action IN ?", since, []string{"review", "deny"}).Count(&risks).Error; err != nil {
				return err
			}
			if err := db.Model(&guard.Event{}).Where("created_at >= ? AND stage = ?", since, "email").Count(&mails).Error; err != nil {
				return err
			}
			if err := db.Model(&guard.Event{}).Where("created_at >= ? AND stage = ? AND user_id > 0", since, "register").Count(&completed).Error; err != nil {
				return err
			}
			var issued int64
			day := now.UTC().Unix() / 86400 * 86400
			if err := db.Model(&guard.Grant{}).Select("COALESCE(SUM(total),0)").Where("created_at >= ?", day).Scan(&issued).Error; err != nil {
				return err
			}
			conditions := []struct {
				kind    string
				trigger bool
				message *common.Message
			}{
				{"risk-volume", risks >= int64(s.AlertRiskCount), common.NewMessage("{{count}} risky attempts in {{minutes}} minutes", map[string]any{"count": risks, "minutes": s.AlertWindowMinutes})},
				{"email-conversion", mails >= int64(s.AlertEmailCount) && float64(completed)/float64(max(mails, 1))*100 < float64(s.AlertCompletionPercent), common.NewMessage("{{emails}} verification attempts; {{registrations}} registrations in {{minutes}} minutes", map[string]any{"emails": mails, "registrations": completed, "minutes": s.AlertWindowMinutes})},
				{"bonus-budget", s.BonusDailyQuota > 0 && float64(issued)/float64(s.BonusDailyQuota)*100 >= float64(s.AlertBudgetPercent), common.NewMessage("{{issued}} / {{budget}} promotional quota issued today (UTC)", map[string]any{"issued": issued, "budget": s.BonusDailyQuota})},
			}
			for _, condition := range conditions {
				if !condition.trigger {
					continue
				}
				bucket := now.Unix() / int64(s.AlertDedupMinutes*60)
				if err := db.Transaction(func(tx *gorm.DB) error {
					count, err := guard.Increment(tx, fmt.Sprintf("alert:%s:%d", condition.kind, bucket), now.Unix()+int64(s.AlertDedupMinutes*60), 1)
					if err != nil || count != 1 {
						return err
					}
					return tx.Create(&guard.Alert{CreatedAt: now.Unix(), Kind: condition.kind, Summary: condition.message.Error(), SummaryKey: condition.message.Key, SummaryParams: condition.message.Params, NextAttemptAt: now.Unix()}).Error
				}); err != nil {
					return err
				}
			}
		}
	}
	if !s.AlertEnabled {
		return nil
	}
	var rows []guard.Alert
	if err := db.Where("delivered_at = 0 AND next_attempt_at <= ? AND lease_until <= ?", now.Unix(), now.Unix()).Order("id").Limit(10).Find(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		claim := db.Model(&guard.Alert{}).Where("id = ? AND lease_until <= ? AND delivered_at = 0", row.ID, now.Unix()).Update("lease_until", now.Unix()+600)
		if claim.Error != nil {
			return claim.Error
		}
		if claim.RowsAffected != 1 {
			continue
		}
		message := ""
		if !row.EmailDone && len(s.AlertEmails) > 0 {
			// Recipients receive the same operational summary, without user addresses,
			// IPs, credentials or verification codes.
			summary := row.Summary
			if row.SummaryKey != "" {
				summary = i18n.Translate("", row.SummaryKey, row.SummaryParams)
			}
			err := common.SendEmailWithTemplate(i18n.Translate("", "registration_risk.alert_subject"), strings.Join(s.AlertEmails, ";"), "<p>"+html.EscapeString(summary)+"</p>", common.EmailTemplateData{Type: common.EmailTemplateRiskAlert})
			if err == nil {
				row.EmailDone = true
			} else {
				message = "Email delivery failed"
			}
		}
		if !row.WebhookDone && s.AlertWebhook != "" {
			body, err := common.Marshal(map[string]any{"event": "registration-risk", "id": row.ID, "kind": row.Kind, "summary": row.Summary, "created_at": row.CreatedAt})
			if err != nil {
				return err
			}
			req, err := http.NewRequestWithContext(db.Statement.Context, http.MethodPost, s.AlertWebhook, bytes.NewReader(body))
			if err == nil {
				req.Header.Set("Content-Type", "application/json")
				client := http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
				response, e := client.Do(req)
				err = e
				if err == nil {
					_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
					response.Body.Close()
					if response.StatusCode < 200 || response.StatusCode >= 300 {
						err = fmt.Errorf("webhook status")
					}
				}
			}
			if err == nil {
				row.WebhookDone = true
			} else {
				message = "Webhook delivery failed"
			}
		}
		delivered := int64(0)
		if (row.EmailDone || len(s.AlertEmails) == 0) && (row.WebhookDone || s.AlertWebhook == "") && (len(s.AlertEmails) > 0 || s.AlertWebhook != "") {
			delivered = now.Unix()
		}
		if len(s.AlertEmails) == 0 && s.AlertWebhook == "" {
			message = "No alert destination configured"
		}
		if err := db.Model(&guard.Alert{}).Where("id = ?", row.ID).Updates(map[string]any{"email_done": row.EmailDone, "webhook_done": row.WebhookDone, "delivered_at": delivered, "attempts": row.Attempts + 1, "next_attempt_at": now.Unix() + min(int64(3600), int64(60)*(1<<min(row.Attempts, 6))), "lease_until": 0, "last_error": message}).Error; err != nil {
			return err
		}
	}
	return nil
}
