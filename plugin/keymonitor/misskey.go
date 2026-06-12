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
	"time"

	"github.com/QuantumNous/new-api/common"
)

type MisskeyClient struct {
	BaseURL string
	Timeout time.Duration
}

type MisskeyUser struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Host     string `json:"host"`
	Name     string `json:"name"`
}

type MisskeyNote struct {
	ID        string      `json:"id"`
	CreatedAt time.Time   `json:"createdAt"`
	Text      string      `json:"text"`
	User      MisskeyUser `json:"user"`
}

type userShowRequest struct {
	Username string `json:"username"`
	Host     string `json:"host"`
}

type userNotesRequest struct {
	UserID         string `json:"userId"`
	Limit          int    `json:"limit"`
	IncludeReplies bool   `json:"includeReplies"`
}

// GetUserByUsername 通过用户名获取用户信息
func (c *MisskeyClient) GetUserByUsername(username, host string) (*MisskeyUser, error) {
	req := userShowRequest{
		Username: username,
		Host:     host,
	}

	body, err := common.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request failed: %w", err)
	}

	httpReq, err := http.NewRequest("POST", c.BaseURL+"/api/users/show", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request failed: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: c.Timeout}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response failed: %w", err)
	}

	var user MisskeyUser
	if err := common.Unmarshal(respBody, &user); err != nil {
		return nil, fmt.Errorf("unmarshal response failed: %w", err)
	}

	return &user, nil
}

// GetUserNotes 获取用户的最新笔记
func (c *MisskeyClient) GetUserNotes(userID string, limit int) ([]MisskeyNote, error) {
	req := userNotesRequest{
		UserID:         userID,
		Limit:          limit,
		IncludeReplies: false,
	}

	body, err := common.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request failed: %w", err)
	}

	httpReq, err := http.NewRequest("POST", c.BaseURL+"/api/users/notes", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request failed: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: c.Timeout}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response failed: %w", err)
	}

	var notes []MisskeyNote
	if err := common.Unmarshal(respBody, &notes); err != nil {
		return nil, fmt.Errorf("unmarshal response failed: %w", err)
	}

	return notes, nil
}
