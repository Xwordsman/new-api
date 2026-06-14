package controller

import (
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// GetMonitorStatus returns the monitor status data for the status page
func GetMonitorStatus(c *gin.Context) {
	// Parse query parameters
	hoursStr := c.DefaultQuery("hours", "12")
	hours, err := strconv.Atoi(hoursStr)
	if err != nil || hours <= 0 || hours > 168 { // max 7 days
		hours = 12
	}

	now := time.Now().Unix()
	startTime := now - int64(hours*3600)

	// Get all monitor logs within the time range
	logs, err := model.GetChannelMonitorLogs(startTime, now)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// Get all channels to build the response
	channels, err := model.GetAllChannels(0, 0, true, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// Build channel map for quick lookup
	channelMap := make(map[int]*model.Channel)
	for _, ch := range channels {
		channelMap[ch.Id] = ch
	}

	// Group logs by model name
	modelGroups := make(map[string][]MonitorLogItem)
	channelStats := make(map[int]*ChannelStats)

	for _, log := range logs {
		channel, exists := channelMap[log.ChannelId]
		if !exists {
			continue
		}

		// Use model name from log, or first model from channel if empty
		modelName := log.ModelName
		if modelName == "" {
			models := channel.GetModels()
			if len(models) > 0 {
				modelName = models[0]
			} else {
				modelName = "unknown"
			}
		}

		// Add to model groups
		item := MonitorLogItem{
			ChannelId:    log.ChannelId,
			ChannelName:  channel.Name,
			Status:       log.Status,
			ResponseTime: log.ResponseTime,
			ErrorMessage: log.ErrorMessage,
			TestedAt:     log.TestedAt,
		}
		modelGroups[modelName] = append(modelGroups[modelName], item)

		// Update channel stats
		if _, exists := channelStats[log.ChannelId]; !exists {
			channelStats[log.ChannelId] = &ChannelStats{
				ChannelId:   log.ChannelId,
				ChannelName: channel.Name,
				TotalTests:  0,
				SuccessTests: 0,
			}
		}
		stats := channelStats[log.ChannelId]
		stats.TotalTests++
		if log.Status == 1 {
			stats.SuccessTests++
		}
	}

	// Calculate uptime percentages
	for _, stats := range channelStats {
		if stats.TotalTests > 0 {
			stats.UptimePercent = float64(stats.SuccessTests) / float64(stats.TotalTests) * 100
		}
	}

	// Build response
	response := MonitorStatusResponse{
		StartTime:    startTime,
		EndTime:      now,
		Hours:        hours,
		ModelGroups:  modelGroups,
		ChannelStats: channelStats,
		TotalLogs:    len(logs),
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    response,
	})
}

// MonitorLogItem represents a single monitor log entry
type MonitorLogItem struct {
	ChannelId    int    `json:"channel_id"`
	ChannelName  string `json:"channel_name"`
	Status       int    `json:"status"`
	ResponseTime int    `json:"response_time"`
	ErrorMessage string `json:"error_message,omitempty"`
	TestedAt     int64  `json:"tested_at"`
}

// ChannelStats represents statistics for a channel
type ChannelStats struct {
	ChannelId      int     `json:"channel_id"`
	ChannelName    string  `json:"channel_name"`
	TotalTests     int     `json:"total_tests"`
	SuccessTests   int     `json:"success_tests"`
	UptimePercent  float64 `json:"uptime_percent"`
}

// MonitorStatusResponse is the response structure for monitor status
type MonitorStatusResponse struct {
	StartTime    int64                       `json:"start_time"`
	EndTime      int64                       `json:"end_time"`
	Hours        int                         `json:"hours"`
	ModelGroups  map[string][]MonitorLogItem `json:"model_groups"`
	ChannelStats map[int]*ChannelStats       `json:"channel_stats"`
	TotalLogs    int                         `json:"total_logs"`
}
