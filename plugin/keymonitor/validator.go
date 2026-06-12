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
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// validateKeyWithChannel 使用渠道配置验证 key 是否可用
func validateKeyWithChannel(key string, channel *model.Channel, config *Config) bool {
	testReq := map[string]interface{}{
		"model": "gpt-3.5-turbo",
		"messages": []map[string]string{
			{"role": "user", "content": "hi"},
		},
		"max_tokens": 5,
	}

	reqBody, _ := common.Marshal(testReq)
	req, err := http.NewRequest("POST", channel.GetBaseURL()+"/v1/chat/completions", bytes.NewReader(reqBody))
	if err != nil {
		common.SysLog(fmt.Sprintf("[KeyMonitor] Failed to create validation request: %v", err))
		return false
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)

	client := &http.Client{
		Timeout: time.Duration(config.ValidationTimeout) * time.Second,
	}

	resp, err := client.Do(req)
	if err != nil {
		common.SysLog(fmt.Sprintf("[KeyMonitor] Validation request failed: %v", err))
		return false
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	bodyStr := string(body)

	// 检查是否包含失效关键词
	for _, keyword := range config.ExpiredKeywords {
		if strings.Contains(bodyStr, keyword) {
			common.SysLog(fmt.Sprintf("[KeyMonitor] Response contains expired keyword: %s", keyword))
			return false
		}
	}

	// 检查是否是正常的 OpenAI 响应
	isValid := resp.StatusCode == 200 && (strings.Contains(bodyStr, `"choices"`) || strings.Contains(bodyStr, `"model"`))

	if !isValid {
		preview := bodyStr
		if len(preview) > 100 {
			preview = preview[:100] + "..."
		}
		common.SysLog(fmt.Sprintf("[KeyMonitor] Unexpected response status=%d, body preview: %s", resp.StatusCode, preview))
	}

	return isValid
}

// checkChannelHealth 检查渠道是否真正可用
func checkChannelHealth(config *Config) (bool, error) {
	channel, err := model.GetChannelById(config.TargetChannelID, false)
	if err != nil {
		return false, fmt.Errorf("failed to get channel: %w", err)
	}

	// 发送测试请求
	testReq := map[string]interface{}{
		"model": "gpt-3.5-turbo",
		"messages": []map[string]string{
			{"role": "user", "content": "hi"},
		},
		"max_tokens": 5,
	}

	reqBody, _ := common.Marshal(testReq)
	req, err := http.NewRequest("POST", channel.GetBaseURL()+"/v1/chat/completions", bytes.NewReader(reqBody))
	if err != nil {
		return false, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+channel.Key)

	client := &http.Client{
		Timeout: time.Duration(config.ValidationTimeout) * time.Second,
	}

	resp, err := client.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	bodyStr := string(body)

	// 检查响应是否包含失效标识
	for _, keyword := range config.ExpiredKeywords {
		if strings.Contains(bodyStr, keyword) {
			return false, nil
		}
	}

	return true, nil
}
