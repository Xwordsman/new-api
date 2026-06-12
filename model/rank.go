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
	Summary SiteUserUsageRankSummary `json:"summary"`
	Items   []SiteUserUsageRankRow   `json:"items"`
}

func GetTodaySiteUserUsageRank() (*SiteUserUsageRankResponse, error) {
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

	return &SiteUserUsageRankResponse{
		Summary: summary,
		Items:   rows,
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
		Order("total_tokens DESC, request_count DESC").
		Limit(SiteUserUsageRankLimit).
		Scan(&rows).Error
	return rows, err
}
