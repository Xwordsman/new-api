package model

import (
	"time"

	"github.com/QuantumNous/new-api/extensions/checkin/policy"
)

// Checkin 签到记录
type Checkin struct {
	Id           int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId       int    `json:"user_id" gorm:"not null;uniqueIndex:idx_user_checkin_date"`
	CheckinDate  string `json:"checkin_date" gorm:"type:varchar(10);not null;uniqueIndex:idx_user_checkin_date"` // 格式: YYYY-MM-DD
	QuotaAwarded int    `json:"quota_awarded" gorm:"not null"`
	CreatedAt    int64  `json:"created_at" gorm:"bigint"`
}

// CheckinRecord 用于API返回的签到记录（不包含敏感字段）
type CheckinRecord struct {
	CheckinDate  string `json:"checkin_date"`
	QuotaAwarded int    `json:"quota_awarded"`
}

func (Checkin) TableName() string {
	return "checkins"
}

// GetUserCheckinRecords 获取用户在指定日期范围内的签到记录
func GetUserCheckinRecords(userId int, startDate, endDate string) ([]Checkin, error) {
	var records []Checkin
	err := DB.Where("user_id = ? AND checkin_date >= ? AND checkin_date <= ?",
		userId, startDate, endDate).
		Order("checkin_date DESC").
		Find(&records).Error
	return records, err
}

// HasCheckedInToday 检查用户今天是否已签到
func HasCheckedInToday(userId int) (bool, error) {
	settings, err := policy.GetSettings(DB)
	if err != nil {
		return false, err
	}
	return policy.CheckinToday(DB, userId, settings, time.Now())
}

// UserCheckin uses one atomic qualification, history, reward, and wallet
// transaction in every database. CAPTCHA proof is supplied by the handler.
func UserCheckin(userId int, verificationPassed ...bool) (*Checkin, error) {
	value, err := policy.Claim(DB, userId, time.Now(), verificationPassed...)
	if err != nil {
		return nil, err
	}
	syncCreditUserQuotaCache(userId, value.QuotaAwarded, "daily check-in")
	return &Checkin{Id: value.ID, UserId: value.UserID, CheckinDate: value.CheckinDate, QuotaAwarded: value.QuotaAwarded, CreatedAt: value.CreatedAt}, nil
}

// GetUserCheckinStats 获取用户签到统计信息
func GetUserCheckinStats(userId int, month string) (map[string]any, error) {
	stats, records, err := policy.ReadHistory(DB, userId, month)
	if err != nil {
		return nil, err
	}
	hasCheckedToday, err := HasCheckedInToday(userId)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"total_quota":      stats.TotalQuota,
		"total_checkins":   stats.TotalCheckins,
		"checkin_count":    stats.MonthCheckins,
		"checked_in_today": hasCheckedToday,
		"records":          records,
	}, nil
}
