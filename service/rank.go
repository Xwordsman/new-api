package service

import "github.com/QuantumNous/new-api/model"

func GetTodaySiteUserUsageRank() (*model.SiteUserUsageRankResponse, error) {
	return model.GetTodaySiteUserUsageRank()
}
