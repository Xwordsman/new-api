package model

import "time"

const SiteUserUsageRankLimit = 100

type SiteUserUsageRankSummary struct {
	PromptTokens     int64 `json:"prompt_tokens"`
	CompletionTokens int64 `json:"completion_tokens"`
	TotalTokens      int64 `json:"total_tokens"`
}

type SiteUserUsageRankRow struct {
	Rank             int    `json:"rank" gorm:"-"`
	Username         string `json:"username"`
	RequestCount     int64  `json:"request_count"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	TotalTokens      int64  `json:"total_tokens"`
}

type SiteUserUsageRankResponse struct {
	Summary     SiteUserUsageRankSummary `json:"summary"`
	Items       []SiteUserUsageRankRow   `json:"items"`
	CurrentUser *SiteUserUsageRankRow    `json:"current_user,omitempty"`
}

func GetTodaySiteUserUsageRank(currentUsername string) (*SiteUserUsageRankResponse, error) {
	now := time.Now()
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
	end := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, now.Location()).Unix()

	summary, err := getSiteUserUsageRankSummary(start, end)
	if err != nil {
		return nil, err
	}

	rows, err := getSiteUserUsageRankRows(start, end)
	if err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []SiteUserUsageRankRow{}
	}

	for i := range rows {
		rows[i].Rank = i + 1
	}

	var currentUser *SiteUserUsageRankRow
	if currentUsername != "" {
		currentUser, err = getSiteUserUsageRankForUser(start, end, currentUsername, rows)
		if err != nil {
			return nil, err
		}
	}

	return &SiteUserUsageRankResponse{
		Summary:     summary,
		Items:       rows,
		CurrentUser: currentUser,
	}, nil
}

func getSiteUserUsageRankSummary(start int64, end int64) (SiteUserUsageRankSummary, error) {
	var summary SiteUserUsageRankSummary
	err := LOG_DB.Table("logs").
		Select("COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens, COALESCE(SUM(completion_tokens), 0) AS completion_tokens").
		Where("type = ? AND created_at >= ? AND created_at < ?", LogTypeConsume, start, end).
		Scan(&summary).Error
	if err != nil {
		return summary, err
	}
	summary.TotalTokens = summary.PromptTokens + summary.CompletionTokens
	return summary, nil
}

func getSiteUserUsageRankRows(start int64, end int64) ([]SiteUserUsageRankRow, error) {
	var rows []SiteUserUsageRankRow
	err := LOG_DB.Table("logs").
		Select("username, COUNT(*) AS request_count, COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens, COALESCE(SUM(completion_tokens), 0) AS completion_tokens, COALESCE(SUM(prompt_tokens), 0) + COALESCE(SUM(completion_tokens), 0) AS total_tokens").
		Where("type = ? AND created_at >= ? AND created_at < ?", LogTypeConsume, start, end).
		Group("user_id, username").
		Order("request_count DESC, total_tokens DESC").
		Limit(SiteUserUsageRankLimit).
		Scan(&rows).Error
	return rows, err
}

func getSiteUserUsageRankForUser(start int64, end int64, username string, topRows []SiteUserUsageRankRow) (*SiteUserUsageRankRow, error) {
	// Check if user is already in top 100
	for i := range topRows {
		if topRows[i].Username == username {
			return &topRows[i], nil
		}
	}

	// User not in top 100, query their stats and calculate rank
	var userRow SiteUserUsageRankRow
	err := LOG_DB.Table("logs").
		Select("username, COUNT(*) AS request_count, COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens, COALESCE(SUM(completion_tokens), 0) AS completion_tokens, COALESCE(SUM(prompt_tokens), 0) + COALESCE(SUM(completion_tokens), 0) AS total_tokens").
		Where("type = ? AND created_at >= ? AND created_at < ? AND username = ?", LogTypeConsume, start, end, username).
		Group("user_id, username").
		Scan(&userRow).Error

	if err != nil || userRow.Username == "" {
		return nil, err
	}

	// Calculate rank by counting users with more requests
	var rank int64
	err = LOG_DB.Table("logs").
		Select("COUNT(DISTINCT user_id)").
		Where("type = ? AND created_at >= ? AND created_at < ?", LogTypeConsume, start, end).
		Group("user_id").
		Having("COUNT(*) > ? OR (COUNT(*) = ? AND COALESCE(SUM(prompt_tokens), 0) + COALESCE(SUM(completion_tokens), 0) > ?)", userRow.RequestCount, userRow.RequestCount, userRow.TotalTokens).
		Count(&rank).Error

	if err != nil {
		return nil, err
	}

	userRow.Rank = int(rank) + 1
	return &userRow, nil
}
