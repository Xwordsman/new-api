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
	Name             string `json:"name"`
	TokenSuffix      string `json:"token_suffix" gorm:"-"`
	Username         string `json:"username"`
	TokenId          int    `json:"-"`
	RequestCount     int64  `json:"request_count"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	TotalTokens      int64  `json:"total_tokens"`
}

type SiteUserUsageRankResponse struct {
	Summary SiteUserUsageRankSummary `json:"summary"`
	Items   []SiteUserUsageRankRow   `json:"items"`
}

type tokenKeyForSuffix struct {
	Id  int
	Key string
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

	suffixes, err := getTokenKeySuffixesForRank(rows)
	if err != nil {
		return nil, err
	}

	for i := range rows {
		rows[i].Rank = i + 1
		if rows[i].Name == "" {
			rows[i].Name = "Unnamed token"
		}
		rows[i].TokenSuffix = suffixes[rows[i].TokenId]
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
		Select("token_id, token_name AS name, username, COUNT(*) AS request_count, COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens, COALESCE(SUM(completion_tokens), 0) AS completion_tokens, COALESCE(SUM(prompt_tokens), 0) + COALESCE(SUM(completion_tokens), 0) AS total_tokens").
		Where("type = ? AND created_at >= ? AND created_at < ?", LogTypeConsume, start, end).
		Group("user_id, username, token_id, token_name").
		Order("total_tokens DESC, request_count DESC").
		Limit(SiteUserUsageRankLimit).
		Scan(&rows).Error
	return rows, err
}

func getTokenKeySuffixesForRank(rows []SiteUserUsageRankRow) (map[int]string, error) {
	tokenIds := make([]int, 0, len(rows))
	seen := make(map[int]bool, len(rows))
	for _, row := range rows {
		if row.TokenId <= 0 || seen[row.TokenId] {
			continue
		}
		seen[row.TokenId] = true
		tokenIds = append(tokenIds, row.TokenId)
	}

	if len(tokenIds) == 0 {
		return map[int]string{}, nil
	}

	var tokens []tokenKeyForSuffix
	if err := DB.Model(&Token{}).Select("id", commonKeyCol).Where("id IN ?", tokenIds).Find(&tokens).Error; err != nil {
		return nil, err
	}

	suffixes := make(map[int]string, len(tokens))
	for _, token := range tokens {
		suffixes[token.Id] = tokenKeySuffix(token.Key)
	}
	return suffixes, nil
}

func tokenKeySuffix(key string) string {
	if key == "" {
		return ""
	}
	if len(key) <= 4 {
		return key
	}
	return key[len(key)-4:]
}
