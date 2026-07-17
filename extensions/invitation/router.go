package invitation

import (
	"github.com/QuantumNous/new-api/middleware"

	"github.com/gin-gonic/gin"
)

func RegisterRoutes(apiRouter *gin.RouterGroup) {
	adminRoute := apiRouter.Group("/extensions/invitation/admin")
	adminRoute.Use(middleware.RootAuth())
	{
		adminRoute.GET("/settings", getSettings)
		adminRoute.PUT("/settings", updateSettings)
		adminRoute.GET("/codes", listCodes)
		adminRoute.POST("/codes", createCodes)
		adminRoute.PUT("/codes/:id", updateCode)
		adminRoute.DELETE("/codes/:id", deleteCode)
	}
}
