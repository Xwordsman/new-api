package model

import (
	"github.com/QuantumNous/new-api/common"
)

type ChannelMonitorLog struct {
	Id           int    `gorm:"primaryKey;autoIncrement" json:"id"`
	ChannelId    int    `gorm:"index:idx_channel_time;not null" json:"channel_id"`
	ModelName    string `gorm:"type:varchar(255);index:idx_model_time" json:"model_name"`
	Status       int    `gorm:"type:tinyint;not null;default:0" json:"status"` // 0=failed, 1=success
	ResponseTime int    `gorm:"type:int" json:"response_time"`                  // milliseconds
	ErrorMessage string `gorm:"type:text" json:"error_message,omitempty"`
	TestedAt     int64  `gorm:"index:idx_channel_time;index:idx_model_time;bigint;not null" json:"tested_at"` // Unix timestamp
}

func (ChannelMonitorLog) TableName() string {
	return "channel_monitor_logs"
}

// CreateChannelMonitorLog creates a new monitor log
func CreateChannelMonitorLog(log *ChannelMonitorLog) error {
	return DB.Create(log).Error
}

// GetChannelMonitorLogs retrieves monitor logs for a specific time range
func GetChannelMonitorLogs(startTime int64, endTime int64) ([]*ChannelMonitorLog, error) {
	var logs []*ChannelMonitorLog
	err := DB.Where("tested_at >= ? AND tested_at <= ?", startTime, endTime).
		Order("tested_at ASC").
		Find(&logs).Error
	return logs, err
}

// GetChannelMonitorLogsByModel retrieves monitor logs for a specific model
func GetChannelMonitorLogsByModel(modelName string, startTime int64, endTime int64) ([]*ChannelMonitorLog, error) {
	var logs []*ChannelMonitorLog
	err := DB.Where("model_name = ? AND tested_at >= ? AND tested_at <= ?", modelName, startTime, endTime).
		Order("tested_at ASC").
		Find(&logs).Error
	return logs, err
}

// DeleteOldChannelMonitorLogs deletes logs older than the specified timestamp
func DeleteOldChannelMonitorLogs(beforeTime int64) error {
	return DB.Where("tested_at < ?", beforeTime).Delete(&ChannelMonitorLog{}).Error
}

// CleanupChannelMonitorLogs removes logs older than the retention period (in hours)
func CleanupChannelMonitorLogs(retentionHours int) error {
	cutoffTime := common.GetTimestamp() - int64(retentionHours*3600)
	return DeleteOldChannelMonitorLogs(cutoffTime)
}
