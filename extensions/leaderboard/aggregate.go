package leaderboard

import (
	"context"
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/extensions/leaderboard/record"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const taskType = "extension_leaderboard"

var beijing = time.FixedZone("Asia/Shanghai", 8*60*60)

type Snapshot struct {
	ID        int `gorm:"primaryKey;autoIncrement:false"`
	Revision  int64
	UpdatedAt int64
	DayStart  int64
	Payload   string `gorm:"type:text"`
}

func (Snapshot) TableName() string { return "extension_leaderboard_snapshots" }

type rank struct {
	UserID int   `json:"user_id"`
	Value  int64 `json:"value"`
}

type boardPeriods map[string][]rank
type rankings map[string]boardPeriods

func Migrate(db *gorm.DB) error {
	if err := record.Migrate(db); err != nil {
		return err
	}
	return db.AutoMigrate(&Snapshot{})
}

func dayStart(now time.Time) int64 {
	now = now.In(beijing)
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, beijing).Unix()
}

// aggregate only runs under the host's leased system task. Every board and
// period is published as one atomic snapshot; requests never scan usage logs.
func aggregate(ctx context.Context, db *gorm.DB, now time.Time) error {
	db = db.WithContext(ctx)
	s, _, err := getSettings(db)
	if err != nil {
		return err
	}
	record.Configure(db, s.policy())
	if err := db.Where("created_at < ?", now.Unix()-int64(s.WarningRetention)*86400).Delete(&record.Warning{}).Error; err != nil {
		return err
	}
	all := rankings{}
	start := dayStart(now)
	if s.Enabled {
		for board, enabled := range s.boards() {
			if !enabled {
				continue
			}
			all[board] = boardPeriods{}
			for _, period := range []string{"today", "yesterday", "all"} {
				var table, userCol, dateCol, expression string
				switch board {
				case "invitations":
					table, userCol, dateCol, expression = "extension_referral_bindings", "inviter_id", "registered_at", "COUNT(*)"
				case "income":
					table, userCol, dateCol, expression = "extension_referral_rewards", "inviter_id", "claimed_at", "SUM(f.quota - f.reversed)"
				case "tokens":
					table, userCol, dateCol, expression = "quota_data", "user_id", "created_at", "SUM(f.token_used)"
				case "savings":
					table, userCol, dateCol, expression = "extension_leaderboard_savings", "user_id", "created_at", "SUM(f.amount)"
				case "cyber":
					table, userCol, dateCol, expression = "extension_leaderboard_warnings", "user_id", "created_at", "COUNT(*)"
				}
				q := db.Table(table+" AS f").Joins("JOIN users AS u ON u.id = f."+userCol).
					Where("u.status = ? AND u.deleted_at IS NULL", common.UserStatusEnabled)
				if s.ExcludeAdmins {
					q = q.Where("u.role < ?", common.RoleAdminUser)
				}
				if len(s.ExcludedUserIDs) > 0 {
					q = q.Where("u.id NOT IN ?", s.ExcludedUserIDs)
				}
				if period != "all" {
					from, until := start, now.Unix()+1
					if period == "yesterday" {
						from, until = start-86400, start
					}
					q = q.Where("f."+dateCol+" >= ? AND f."+dateCol+" < ?", from, until)
				} else {
					q = q.Where("f."+dateCol+" <= ?", now.Unix())
				}
				switch board {
				case "invitations":
					q = q.Where("f.state = ? AND f.historical = ?", "active", false).
						Joins("JOIN users AS invited ON invited.id = f.user_id").Where("invited.status = ? AND invited.deleted_at IS NULL", common.UserStatusEnabled)
					if s.InvitationPaidOnly {
						q = q.Where("EXISTS (SELECT 1 FROM extension_referral_rewards AS r WHERE r.user_id = f.user_id AND r.inviter_id = f.inviter_id AND r.historical = ? AND r.paid_quota > r.refunded_quota AND r.quota > r.reversed AND r.state IN ?)", false, []string{"pending", "claimed"})
					}
				case "income":
					q = q.Where("f.claimed_at > 0 AND f.historical = ?", false)
				}
				rows := []rank{}
				if err := q.Select("f." + userCol + " AS user_id, " + expression + " AS value").Group("f." + userCol).
					Having(expression + " > 0").Order("value DESC").Order("user_id ASC").Limit(s.TopN).Scan(&rows).Error; err != nil {
					return err
				}
				all[board][period] = rows
			}
		}
	}
	encoded, err := common.Marshal(all)
	if err != nil {
		return err
	}
	return db.Clauses(clause.OnConflict{UpdateAll: true}).Create(&Snapshot{ID: 1, Revision: s.Revision,
		UpdatedAt: now.Unix(), DayStart: start, Payload: string(encoded)}).Error
}

type taskHandler struct{}

func RegisterTasks()                        { service.RegisterSystemTaskHandler(taskHandler{}) }
func (taskHandler) Type() string            { return taskType }
func (taskHandler) Interval() time.Duration { return time.Minute }
func (taskHandler) NewPayload() any         { return struct{}{} }
func (taskHandler) Enabled() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	s, _, err := getSettings(model.DB.WithContext(ctx))
	if err != nil {
		common.SysError("leaderboard schedule: " + err.Error())
		return false
	}
	// The master also refreshes collection before deciding whether to publish.
	record.Configure(model.DB, s.policy())
	var last Snapshot
	err = model.DB.WithContext(ctx).First(&last, 1).Error
	return errors.Is(err, gorm.ErrRecordNotFound) || err == nil &&
		(last.Revision != s.Revision || last.DayStart != dayStart(time.Now()) || time.Now().Unix()-last.UpdatedAt >= int64(s.IntervalMinutes)*60)
}

func (taskHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	err := aggregate(ctx, model.DB, time.Now())
	status, message := model.SystemTaskStatusSucceeded, ""
	if err != nil {
		status, message = model.SystemTaskStatusFailed, "Unable to update leaderboard"
		common.SysError("leaderboard aggregate: " + err.Error())
	}
	if err := model.FinishSystemTask(task.TaskID, runnerID, status, nil, message); err != nil {
		common.SysError("leaderboard task finish: " + err.Error())
	}
}
