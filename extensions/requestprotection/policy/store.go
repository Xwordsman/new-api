package policy

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Event struct {
	ID          int64  `gorm:"primaryKey" json:"id"`
	RequestHash string `gorm:"size:64;uniqueIndex" json:"-"`
	RequestID   string `gorm:"size:100" json:"request_id"`
	UserID      int    `gorm:"index:idx_rp_user_time,priority:1" json:"user_id"`
	TokenID     int    `gorm:"index" json:"token_id"`
	CreatedAt   int64  `gorm:"index:idx_rp_user_time,priority:2;index" json:"created_at"`
	Revision    int64  `json:"revision"`
	GroupName   string `gorm:"size:191" json:"group"`
	Model       string `gorm:"size:191" json:"model"`
	Protocol    string `gorm:"size:40" json:"protocol"`
	Decision    string `gorm:"size:24;index" json:"decision"`
	Hits        string `gorm:"type:text" json:"-"`
	Digest      string `gorm:"size:64;index" json:"digest"`
	Counted     bool   `json:"counted"`
	Review      string `gorm:"size:24;index" json:"review"`
	Uninspected string `gorm:"size:40" json:"uninspected"`
	Upstream    string `gorm:"size:24" json:"upstream"`
}

func (Event) TableName() string { return "extension_request_events" }

// Subject state is separate from host users/tokens; expiry or release cannot
// reactivate a credential disabled by its owner or administrator.
type Subject struct {
	ID            string `gorm:"primaryKey;size:64" json:"id"`
	UserID        int    `gorm:"index" json:"user_id"`
	TokenID       int    `json:"token_id"`
	Version       int64  `json:"version"`
	Until         int64  `gorm:"column:expires_at;index" json:"until"`
	StartedAt     int64  `json:"started_at"`
	Watermark     int64  `json:"watermark"`
	CauseEventID  int64  `json:"cause_event_id"`
	Threshold     int    `json:"threshold"`
	WindowMinutes int    `json:"window_minutes"`
}

func (Subject) TableName() string { return "extension_request_subjects" }

type Audit struct {
	ID        int64  `gorm:"primaryKey" json:"id"`
	ActorID   int    `json:"actor_id"`
	CreatedAt int64  `gorm:"index" json:"created_at"`
	Action    string `gorm:"size:24" json:"action"`
	EventID   int64  `json:"event_id"`
	SubjectID string `gorm:"size:64" json:"subject_id"`
	Note      string `gorm:"size:500" json:"note"`
	Revision  int64  `json:"revision"`
}

func (Audit) TableName() string { return "extension_request_audits" }

type Alert struct {
	ID            int64  `gorm:"primaryKey" json:"id"`
	Bucket        string `gorm:"size:64;uniqueIndex" json:"bucket"`
	WindowStart   int64  `json:"window_start"`
	WindowEnd     int64  `json:"window_end"`
	Minutes       int    `json:"minutes"`
	CreatedAt     int64  `gorm:"index" json:"created_at"`
	Count         int64  `json:"count"`
	DeliveredAt   int64  `json:"delivered_at"`
	LeaseUntil    int64  `json:"lease_until"`
	NextAttemptAt int64  `json:"next_attempt_at"`
	Attempts      int    `json:"attempts"`
}

func (Alert) TableName() string { return "extension_request_alerts" }

type Result struct {
	Verdict
	EventID         int64 `json:"event_id"`
	RestrictedUntil int64 `json:"restricted_until"`
}

func Migrate(db *gorm.DB) error { return db.AutoMigrate(&Event{}, &Subject{}, &Audit{}, &Alert{}) }

func ActiveRestriction(db *gorm.DB, userID, tokenID int, now int64) (int64, error) {
	var subjects []Subject
	err := db.Where("user_id = ? AND id IN ? AND expires_at > ?", userID, []string{fmt.Sprintf("user:%d", userID), fmt.Sprintf("key:%d", tokenID)}, now).Find(&subjects).Error
	until := int64(0)
	for _, s := range subjects {
		until = max(until, s.Until)
	}
	return until, err
}

// An UPDATE before reading serializes hit processing for this account on all
// three databases. SQLite takes its writer lock here, MySQL/PostgreSQL the row
// lock. Never read first and then upgrade a SQLite deferred transaction.
func LockAccount(tx *gorm.DB, userID int) error {
	s := Subject{ID: fmt.Sprintf("user:%d", userID), UserID: userID}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&s).Error; err != nil {
		return err
	}
	return tx.Model(&Subject{}).Where("id = ?", s.ID).Update("version", gorm.Expr("version + 1")).Error
}

func Record(db *gorm.DB, s Settings, in Input, v Verdict, secret string, now int64) (Result, error) {
	result := Result{Verdict: v}
	if len(v.Hits) == 0 && v.Decision == "allow" {
		return result, nil
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := LockAccount(tx, in.UserID); err != nil {
			return err
		}
		hash := Digest(secret, "request-id", fmt.Sprintf("%d:%d:%s", in.UserID, in.TokenID, in.RequestID))
		var old Event
		err := tx.Where("request_hash = ?", hash).Take(&old).Error
		if err == nil {
			result.EventID = old.ID
			// A later resolved model/group may strengthen an earlier observation.
			// Never let idempotency turn a current block into an allow.
			if v.Decision != "block" || old.Decision == "block" {
				return nil
			}
		}
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		counted := v.Eligible && s.Mode == "enforce" && v.Decision == "block"
		if counted {
			var n int64
			if err = tx.Model(&Event{}).Where("user_id = ? AND digest = ? AND counted = ? AND created_at > ?", in.UserID, v.Digest, true, now-int64(s.DuplicateSeconds)).Count(&n).Error; err != nil {
				return err
			}
			counted = n == 0
		}
		hits, err := common.Marshal(v.Hits)
		if err != nil {
			return err
		}
		e := Event{RequestHash: hash, RequestID: bounded(in.RequestID, 100), UserID: in.UserID, TokenID: in.TokenID, CreatedAt: now, Revision: s.Revision,
			GroupName: bounded(in.Group, 191), Model: bounded(in.Model, 191), Protocol: bounded(in.Protocol, 40), Decision: v.Decision, Hits: string(hits), Digest: v.Digest, Counted: counted, Review: "pending", Uninspected: v.Uninspected, Upstream: "not_sent"}
		if old.ID > 0 {
			e.ID = old.ID
			if err = tx.Model(&Event{}).Where("id = ?", old.ID).Updates(map[string]any{"decision": e.Decision, "hits": e.Hits, "counted": e.Counted, "review": "pending", "group_name": e.GroupName, "model": e.Model, "digest": e.Digest, "revision": e.Revision, "uninspected": e.Uninspected}).Error; err != nil {
				return err
			}
		} else {
			if err = tx.Create(&e).Error; err != nil {
				return err
			}
		}
		result.EventID = e.ID
		if !counted {
			return nil
		}
		for _, scope := range []struct {
			id                          string
			tokenID, threshold, minutes int
		}{
			{fmt.Sprintf("key:%d", in.TokenID), in.TokenID, s.KeyThreshold, s.KeySuspendMinutes},
			{fmt.Sprintf("user:%d", in.UserID), 0, s.UserThreshold, s.UserSuspendMinutes},
		} {
			if scope.threshold == 0 || (scope.tokenID <= 0 && strings.HasPrefix(scope.id, "key:")) {
				continue
			}
			state := Subject{ID: scope.id, UserID: in.UserID, TokenID: scope.tokenID}
			if err = tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&state).Error; err != nil {
				return err
			}
			if err = tx.Where("id = ? AND user_id = ?", scope.id, in.UserID).Take(&state).Error; err != nil {
				return err
			}
			if state.Until > 0 && state.Until <= now {
				// Requests already in flight may have added evidence while this
				// restriction was active. Start a fresh score after expiry rather
				// than immediately suspending again on that historical evidence.
				var previous int64
				if err = tx.Model(&Event{}).Where("user_id = ? AND id <> ?", in.UserID, e.ID).Select("COALESCE(MAX(id),0)").Scan(&previous).Error; err != nil {
					return err
				}
				state.Watermark = max(state.Watermark, state.CauseEventID, previous)
				if err = tx.Model(&Subject{}).Where("id = ?", state.ID).Updates(map[string]any{"watermark": state.Watermark, "expires_at": 0}).Error; err != nil {
					return err
				}
			}
			q := tx.Model(&Event{}).Where("user_id = ? AND counted = ? AND review <> ? AND created_at > ? AND id > ?", in.UserID, true, "false_positive", now-int64(s.WindowMinutes)*60, state.Watermark)
			if scope.tokenID > 0 {
				q = q.Where("token_id = ?", scope.tokenID)
			}
			var n int64
			if err = q.Count(&n).Error; err != nil {
				return err
			}
			if n < int64(scope.threshold) || state.Until > now {
				continue
			}
			until := now + int64(scope.minutes)*60
			if err = tx.Model(&Subject{}).Where("id = ?", scope.id).Updates(map[string]any{"expires_at": until, "started_at": now, "cause_event_id": e.ID, "threshold": scope.threshold, "window_minutes": s.WindowMinutes}).Error; err != nil {
				return err
			}
			result.RestrictedUntil = max(result.RestrictedUntil, until)
			if err = tx.Create(&Audit{CreatedAt: now, Action: "auto_suspend", EventID: e.ID, SubjectID: scope.id, Revision: s.Revision}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	return result, err
}

func bounded(value string, n int) string {
	if len(value) <= n {
		return value
	}
	for n > 0 && value[n]&0xc0 == 0x80 {
		n--
	}
	return value[:n]
}

// Release clears only extension state and resets its score watermark. It does
// not modify, reload or re-enable the host token/user record.
func Release(db *gorm.DB, id string, actor int, note string, now int64) error {
	if len(note) > 500 || strings.TrimSpace(note) == "" {
		return ErrInvalid
	}
	var initial Subject
	if err := db.Where("id = ?", id).Take(&initial).Error; err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := LockAccount(tx, initial.UserID); err != nil {
			return err
		}
		var watermark int64
		if err := tx.Model(&Event{}).Where("user_id = ?", initial.UserID).Select("COALESCE(MAX(id),0)").Scan(&watermark).Error; err != nil {
			return err
		}
		if err := tx.Model(&Subject{}).Where("id = ? AND user_id = ?", id, initial.UserID).Updates(map[string]any{"expires_at": 0, "watermark": watermark, "cause_event_id": 0}).Error; err != nil {
			return err
		}
		return tx.Create(&Audit{ActorID: actor, CreatedAt: now, Action: "release", SubjectID: id, Note: note}).Error
	})
}

func Review(db *gorm.DB, id int64, actor int, verdict, note string, now int64) error {
	if (verdict != "confirmed" && verdict != "false_positive") || strings.TrimSpace(note) == "" || len(note) > 500 {
		return ErrInvalid
	}
	var initial Event
	if err := db.Where("id = ?", id).Take(&initial).Error; err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := LockAccount(tx, initial.UserID); err != nil {
			return err
		}
		var event Event
		if err := tx.Where("id = ?", id).Take(&event).Error; err != nil {
			return err
		}
		if event.Review != "pending" {
			return ErrConflict
		}
		updates := map[string]any{"review": verdict}
		if verdict == "false_positive" {
			updates["counted"] = false
		}
		if err := tx.Model(&Event{}).Where("id = ?", id).Updates(updates).Error; err != nil {
			return err
		}
		// Recalculate active restrictions after a false positive; do not clear
		// restrictions which still have enough independent evidence.
		if verdict == "false_positive" && event.Counted {
			var states []Subject
			if err := tx.Where("user_id = ? AND expires_at > ?", event.UserID, now).Find(&states).Error; err != nil {
				return err
			}
			for _, state := range states {
				var cause Event
				if err := tx.Where("id = ?", state.CauseEventID).Take(&cause).Error; errors.Is(err, gorm.ErrRecordNotFound) {
					continue
				} else if err != nil {
					return err
				}
				q := tx.Model(&Event{}).Where("user_id = ? AND counted = ? AND created_at > ? AND created_at <= ? AND id > ? AND id <= ?", event.UserID, true, cause.CreatedAt-int64(state.WindowMinutes)*60, cause.CreatedAt, state.Watermark, cause.ID)
				if state.TokenID > 0 {
					q = q.Where("token_id = ?", state.TokenID)
				}
				var count int64
				if err := q.Count(&count).Error; err != nil {
					return err
				}
				if state.Threshold == 0 || count < int64(state.Threshold) {
					if err := tx.Model(&Subject{}).Where("id = ?", state.ID).Updates(map[string]any{"expires_at": 0, "cause_event_id": 0}).Error; err != nil {
						return err
					}
					if err := tx.Create(&Audit{ActorID: actor, CreatedAt: now, Action: "false_positive_release", EventID: id, SubjectID: state.ID}).Error; err != nil {
						return err
					}
				}
			}
		}
		return tx.Create(&Audit{ActorID: actor, CreatedAt: now, Action: verdict, EventID: id, Note: note}).Error
	})
}
