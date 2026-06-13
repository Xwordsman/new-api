package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func GetSiteUserUsageRank(c *gin.Context) {
	username := c.GetString("username")
	result, err := service.GetTodaySiteUserUsageRank(username)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, result)
}
