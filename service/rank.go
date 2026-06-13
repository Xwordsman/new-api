package service

import "github.com/QuantumNous/new-api/model"

func GetTodaySiteUserUsageRank(currentUsername string) (*model.SiteUserUsageRankResponse, error) {
	return model.GetTodaySiteUserUsageRank(currentUsername)
}
