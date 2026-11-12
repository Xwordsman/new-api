package checkin

import (
	"github.com/QuantumNous/new-api/extensions/checkin/policy"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func Migrate(db *gorm.DB) error { return policy.Migrate(db) }

func Enabled(db *gorm.DB) (bool, error) {
	settings, err := policy.GetSettings(db)
	return settings.Enabled, err
}

// Payment facts are retained while check-in is disabled. Turning the feature
// on later must not lose genuine payments or continue counting refunded funds.
func Initialize(_ *gorm.DB) {
	model.CheckinPaymentHook = policy.RecordPayment
	model.CheckinSubscriptionPaymentHook = policy.RecordSubscriptionPayment
	model.CheckinRefundHook = policy.Refund
}

func RegisterRoutes(api *gin.RouterGroup) {
	users := api.Group("/extensions/checkin", middleware.UserAuth(), middleware.DisableCache())
	users.GET("/dashboard", dashboard)
	users.POST("/claim", middleware.StrictSessionCookieOriginGuard(), middleware.UserCriticalRateLimit("checkin-claim"), ClaimHandler)

	admin := api.Group("/extensions/checkin", middleware.RootAuth(), middleware.DisableCache())
	admin.GET("/settings", getSettings)
	admin.GET("/accounts", accounts)
	admin.GET("/payments", payments)
	admin.GET("/audit", audits)
	writes := admin.Group("", middleware.StrictSessionCookieOriginGuard(), middleware.UserCriticalRateLimit("checkin-admin"))
	writes.PUT("/settings", putSettings)
	writes.POST("/accounts/:id", updateAccount)
	writes.POST("/reconcile", reconcile)
	writes.POST("/refund", refund)
}
