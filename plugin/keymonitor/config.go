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
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// Config 密钥监控配置
type Config struct {
	// 基础设置
	Enabled         bool   `json:"enabled"`
	CheckInterval   int    `json:"check_interval"`    // 分钟，范围 1-60
	TargetChannelID int    `json:"target_channel_id"` // 目标渠道 ID

	// 社区设置
	CommunityURL   string `json:"community_url"`    // 社区地址
	TargetUsername string `json:"target_username"`  // 目标用户名
	FetchNoteLimit int    `json:"fetch_note_limit"` // 获取笔记数量，范围 1-20

	// 高级设置
	ValidationTimeout int      `json:"validation_timeout"` // 验证超时（秒）
	ExpiredKeywords   []string `json:"expired_keywords"`   // 失效关键词列表
}

// DefaultConfig 默认配置
var DefaultConfig = Config{
	Enabled:         false,
	CheckInterval:   5,
	TargetChannelID: 1,
	CommunityURL:    "https://dc.hhhl.cc",
	TargetUsername:  "ls",
	FetchNoteLimit:  5,
	ValidationTimeout: 10,
	ExpiredKeywords: []string{
		"公益服务器压力很大",
		"休息十分钟换key开放",
		"Remember to join the new community",
		"The key will be changed",
	},
}

const configKey = "plugin.key_monitor.config"

// GetConfig 获取配置
func GetConfig() *Config {
	configStr, exists := common.OptionMap[configKey]
	if !exists || configStr == "" {
		return &DefaultConfig
	}

	var config Config
	err := common.Unmarshal([]byte(configStr), &config)
	if err != nil {
		common.SysLog("[KeyMonitor] Failed to parse config, using default")
		return &DefaultConfig
	}

	// 参数校验和边界处理
	if config.CheckInterval < 1 {
		config.CheckInterval = 1
	}
	if config.CheckInterval > 60 {
		config.CheckInterval = 60
	}
	if config.FetchNoteLimit < 1 {
		config.FetchNoteLimit = 1
	}
	if config.FetchNoteLimit > 20 {
		config.FetchNoteLimit = 20
	}
	if config.ValidationTimeout < 5 {
		config.ValidationTimeout = 5
	}
	if config.ValidationTimeout > 60 {
		config.ValidationTimeout = 60
	}
	if config.TargetChannelID < 1 {
		config.TargetChannelID = 1
	}

	return &config
}

// SaveConfig 保存配置
func SaveConfig(config *Config) error {
	configBytes, err := common.Marshal(config)
	if err != nil {
		return err
	}

	return model.UpdateOption(configKey, string(configBytes))
}
