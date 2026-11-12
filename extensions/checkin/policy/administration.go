package policy

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

type AccountRow struct {
	UserID        int    `json:"user_id"`
	Username      string `json:"username"`
	State         string `json:"state"`
	Reason        string `json:"reason"`
	UpdatedAt     int64  `json:"updated_at"`
	UpdatedBy     int    `json:"updated_by"`
	TotalCheckins int64  `json:"total_checkins"`
	TotalQuota    int    `json:"total_quota"`
	LastCheckinAt int64  `json:"last_checkin_at"`
}

func GetAccounts(db *gorm.DB, userID int, state string, page, pageSize int) ([]AccountRow, int64, error) {
	rows := make([]AccountRow, 0)
	if userID < 0 || (state != "" && state != "active" && state != "paused") || page < 1 || page > 1000000 || pageSize < 1 || pageSize > 100 {
		return rows, 0, ErrInvalid
	}
	query := db.Model(&HostUser{}).Joins("LEFT JOIN extension_checkin_accounts a ON a.user_id = users.id")
	if userID > 0 {
		query = query.Where("users.id = ?", userID)
	}
	if state != "" {
		query = query.Where("COALESCE(a.state, 'active') = ?", state)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return rows, 0, err
	}
	if err := query.Select("users.id AS user_id, users.username, COALESCE(a.state, 'active') AS state, COALESCE(a.reason, '') AS reason, COALESCE(a.updated_at, 0) AS updated_at, COALESCE(a.updated_by, 0) AS updated_by").
		Order("users.id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Scan(&rows).Error; err != nil {
		return rows, 0, err
	}
	if len(rows) == 0 {
		return rows, total, nil
	}
	ids := make([]int, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.UserID)
	}
	var totals []struct {
		UserID        int
		TotalCheckins int64
		TotalQuota    int
		LastCheckinAt int64
	}
	if err := db.Model(&Checkin{}).Where("user_id IN ?", ids).
		Select("user_id, COUNT(*) AS total_checkins, COALESCE(SUM(quota_awarded), 0) AS total_quota, COALESCE(MAX(created_at), 0) AS last_checkin_at").Group("user_id").Scan(&totals).Error; err != nil {
		return rows, 0, err
	}
	byUser := make(map[int]int, len(rows))
	for i, row := range rows {
		byUser[row.UserID] = i
	}
	for _, total := range totals {
		if total.TotalQuota < 0 || total.TotalQuota > common.MaxWalletQuota {
			return rows, 0, ErrUnavailable
		}
		if i, ok := byUser[total.UserID]; ok {
			rows[i].TotalCheckins, rows[i].TotalQuota, rows[i].LastCheckinAt = total.TotalCheckins, total.TotalQuota, total.LastCheckinAt
		}
	}
	return rows, total, nil
}

func UpdateAccount(db *gorm.DB, userID, actorID int, state, reason string) (Account, error) {
	reason = strings.TrimSpace(reason)
	reasonLength := utf8.RuneCountInString(reason)
	if userID <= 0 || actorID <= 0 || (state != "active" && state != "paused") || reasonLength < 3 || reasonLength > 500 {
		return Account{}, ErrInvalid
	}
	var account Account
	err := db.Transaction(func(tx *gorm.DB) error {
		settings, err := LockSettings(tx)
		if err != nil {
			return err
		}
		var user HostUser
		if err := tx.Select("id").Where("id = ?", userID).Take(&user).Error; errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrInactive
		} else if err != nil {
			return err
		}
		account, err = readAccount(tx, userID)
		if err != nil {
			return err
		}
		previous := account.State
		account.State, account.Reason, account.UpdatedAt, account.UpdatedBy = state, reason, time.Now().Unix(), actorID
		if err := tx.Save(&account).Error; err != nil {
			return err
		}
		detail, err := common.Marshal(map[string]any{"previous_state": previous, "state": state})
		if err != nil {
			return err
		}
		return tx.Create(&Audit{ActorID: actorID, UserID: userID, Action: "account_" + state, Detail: string(detail), Reason: reason, CreatedAt: account.UpdatedAt, SettingsVersion: settings.Version}).Error
	})
	return account, err
}
