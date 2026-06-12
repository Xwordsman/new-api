/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package keymonitor

import (
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

var monitorTicker *time.Ticker

// Start 启动密钥监控服务
func Start() {
	go monitorLoop()
	common.SysLog("[KeyMonitor] Service started")
}

// monitorLoop 主监控循环
func monitorLoop() {
	var currentInterval time.Duration

	for {
		config := GetConfig()

		if !config.Enabled {
			if monitorTicker != nil {
				monitorTicker.Stop()
				monitorTicker = nil
			}
			time.Sleep(30 * time.Second)
			continue
		}

		newInterval := time.Duration(config.CheckInterval) * time.Minute
		if monitorTicker == nil || currentInterval != newInterval {
			if monitorTicker != nil {
				monitorTicker.Stop()
			}
			monitorTicker = time.NewTicker(newInterval)
			currentInterval = newInterval
			common.SysLog(fmt.Sprintf("[KeyMonitor] Started with interval: %d minutes", config.CheckInterval))
		}

		select {
		case <-monitorTicker.C:
			performHealthCheck(config)
		}
	}
}

// performHealthCheck 执行健康检查
func performHealthCheck(config *Config) {
	common.SysLog(fmt.Sprintf("[KeyMonitor] Checking channel #%d health...", config.TargetChannelID))

	isHealthy, err := checkChannelHealth(config)
	if err != nil {
		common.SysLog(fmt.Sprintf("[KeyMonitor] Error: %v", err))
		return
	}

	if isHealthy {
		common.SysLog(fmt.Sprintf("[KeyMonitor] Channel #%d is healthy", config.TargetChannelID))
		return
	}

	common.SysLog(fmt.Sprintf("[KeyMonitor] Channel #%d is down, fetching new key...", config.TargetChannelID))

	newKey, noteID, err := fetchLatestValidKey(config)
	if err != nil {
		common.SysLog(fmt.Sprintf("[KeyMonitor] Failed to fetch valid key: %v", err))
		return
	}

	err = updateChannelKey(config.TargetChannelID, newKey)
	if err != nil {
		common.SysLog(fmt.Sprintf("[KeyMonitor] Failed to update channel: %v", err))
		return
	}

	common.SysLog(fmt.Sprintf("[KeyMonitor] ✓ Successfully updated channel #%d with key from note %s", config.TargetChannelID, noteID))
}

// fetchLatestValidKey 从最新笔记中获取有效 key
func fetchLatestValidKey(config *Config) (key string, noteID string, err error) {
	client := &MisskeyClient{
		BaseURL: config.CommunityURL,
		Timeout: time.Duration(config.ValidationTimeout) * time.Second,
	}

	// 提取 host
	host := strings.TrimPrefix(config.CommunityURL, "https://")
	host = strings.TrimPrefix(host, "http://")
	host = strings.TrimSuffix(host, "/")

	// 获取目标用户信息
	user, err := client.GetUserByUsername(config.TargetUsername, host)
	if err != nil {
		return "", "", fmt.Errorf("failed to get user info: %w", err)
	}

	// 获取最近 N 条笔记
	notes, err := client.GetUserNotes(user.ID, config.FetchNoteLimit)
	if err != nil {
		return "", "", fmt.Errorf("failed to fetch notes: %w", err)
	}

	common.SysLog(fmt.Sprintf("[KeyMonitor] Fetched %d notes from @%s", len(notes), config.TargetUsername))

	// 从第一条开始遍历（最新的在前）
	for i, note := range notes {
		common.SysLog(fmt.Sprintf("[KeyMonitor] Checking note #%d (ID: %s, created: %s)",
			i+1, note.ID, note.CreatedAt.Format("2006-01-02 15:04:05")))

		// 从笔记文本中提取候选 key
		candidateKeys := ExtractKeys(note.Text)

		if len(candidateKeys) == 0 {
			common.SysLog(fmt.Sprintf("[KeyMonitor] No key found in note #%d", i+1))
			continue
		}

		common.SysLog(fmt.Sprintf("[KeyMonitor] Found %d candidate key(s) in note #%d", len(candidateKeys), i+1))

		// 验证提取到的 key
		channel, _ := model.GetChannelById(config.TargetChannelID, false)
		for j, candidateKey := range candidateKeys {
			common.SysLog(fmt.Sprintf("[KeyMonitor] Validating candidate key #%d: %s...", j+1, maskKey(candidateKey)))

			if validateKeyWithChannel(candidateKey, channel, config) {
				common.SysLog(fmt.Sprintf("[KeyMonitor] ✓ Key #%d from note #%d is valid!", j+1, i+1))
				return candidateKey, note.ID, nil
			}

			common.SysLog(fmt.Sprintf("[KeyMonitor] ✗ Key #%d from note #%d is invalid", j+1, i+1))
		}

		// 第一条笔记的所有 key 都无效，继续检查下一条
		common.SysLog(fmt.Sprintf("[KeyMonitor] Note #%d has no valid key, checking next note...", i+1))
	}

	return "", "", fmt.Errorf("no valid key found in recent %d notes", config.FetchNoteLimit)
}

// updateChannelKey 更新渠道密钥
func updateChannelKey(channelID int, newKey string) error {
	channel, err := model.GetChannelById(channelID, false)
	if err != nil {
		return fmt.Errorf("get channel failed: %w", err)
	}

	channel.Key = newKey
	return channel.Update()
}
