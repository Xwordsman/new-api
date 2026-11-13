package luckydraw

import (
	"github.com/QuantumNous/new-api/extensions/luckydraw/policy"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func Migrate(db *gorm.DB) error { return policy.Migrate(db) }

func Enabled(db *gorm.DB) (bool, error) {
	s, err := policy.GetSettings(db)
	return s.Enabled, err
}

func RegisterRoutes(api *gin.RouterGroup) {
	users := api.Group("/extensions/lucky-draw", middleware.UserAuth(), middleware.DisableCache())
	users.GET("/dashboard", dashboard)
	users.GET("/history", history)
	users.GET("/result/:key", result)
	users.GET("/winners", winners)
	users.POST("/draw", middleware.StrictSessionCookieOriginGuard(), middleware.UserCriticalRateLimit("lucky-draw"), draw)
	admin := api.Group("/extensions/lucky-draw", middleware.RootAuth(), middleware.DisableCache())
	admin.GET("/settings", getSettings)
	admin.GET("/summary", summary)
	admin.GET("/records", records)
	admin.GET("/records/:id", snapshot)
	admin.GET("/accounts", accounts)
	admin.GET("/audit", audit)
	writes := admin.Group("", middleware.StrictSessionCookieOriginGuard(), middleware.UserCriticalRateLimit("lucky-draw-admin"))
	writes.PUT("/settings", putSettings)
	writes.POST("/accounts/:id", updateAccount)
}
