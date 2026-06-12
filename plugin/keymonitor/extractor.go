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
	"encoding/base64"
	"regexp"
	"strings"
)

// ExtractKeys 从文本中提取 API key（支持明文和 base64 编码）
func ExtractKeys(text string) []string {
	var keys []string
	seen := make(map[string]bool)

	// 1. 直接匹配明文 sk- 开头的 key
	plainKeyRe := regexp.MustCompile(`sk-[a-zA-Z0-9_-]{20,}`)
	for _, match := range plainKeyRe.FindAllString(text, -1) {
		if !seen[match] {
			keys = append(keys, match)
			seen[match] = true
		}
	}

	// 2. 尝试 base64 解码
	// 匹配可能的 base64 字符串（至少 40 个字符）
	base64Re := regexp.MustCompile(`[A-Za-z0-9+/]{40,}={0,2}`)
	for _, match := range base64Re.FindAllString(text, -1) {
		// 跳过已经识别为明文 key 的部分
		if strings.HasPrefix(match, "sk-") {
			continue
		}

		decoded, err := base64.StdEncoding.DecodeString(match)
		if err != nil {
			// 尝试 URL safe base64
			decoded, err = base64.URLEncoding.DecodeString(match)
			if err != nil {
				continue
			}
		}

		decodedText := string(decoded)
		// 递归查找解码后文本中的 key
		decodedKeys := ExtractKeys(decodedText)
		for _, key := range decodedKeys {
			if !seen[key] {
				keys = append(keys, key)
				seen[key] = true
			}
		}
	}

	return keys
}

// maskKey 屏蔽 key 的中间部分用于日志输出
func maskKey(key string) string {
	if len(key) <= 10 {
		return "sk-***"
	}
	return key[:7] + "***" + key[len(key)-4:]
}
