package homepage

import (
	"github.com/QuantumNous/new-api/middleware"

	"github.com/gin-gonic/gin"
)

func RegisterRoutes(apiRouter *gin.RouterGroup) {
	adminRoute := apiRouter.Group("/extensions/homepage/admin")
	adminRoute.Use(middleware.RootAuth())
	{
		adminRoute.GET("/settings", getSettings)
		adminRoute.PUT("/settings", updateSettings)
	}
}
