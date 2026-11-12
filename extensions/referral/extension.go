package referral

import (
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/extensions/referral/ledger"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func Migrate(db *gorm.DB) error {
	if err := ledger.Migrate(db); err != nil {
		return err
	}
	if err := ledger.ImportLegacyBalances(db); err != nil {
		return err
	}
	if err := db.Transaction(func(tx *gorm.DB) error { return ledger.ImportHistory(tx, 0) }); err != nil {
		return err
	}
	return nil
}

// Enabled exposes only the feature switch, excluding private ledger settings.
func Enabled(db *gorm.DB) (bool, error) {
	settings, err := ledger.GetSettings(db)
	return settings.Enabled, err
}

// Initialize installs runtime hooks on every node, including non-migrating
// workers receiving signups and payment callbacks.
func Initialize(db *gorm.DB) {
	model.ReferralRegistrationHook = ledger.Register
	model.ReferralPaymentHook = ledger.RecordPayment
	model.ReferralTransferHook = func(userID, quota int) error {
		transfer, replayed, err := ledger.TransferBalance(db, userID, common.GetRandomString(32), quota, time.Now().Unix())
		if err == nil && !replayed {
			model.SyncReferralWalletCache(userID, transfer.Quota)
		}
		return err
	}
}

func RegisterRoutes(apiRouter *gin.RouterGroup) {
	users := apiRouter.Group("/extensions/referral", middleware.UserAuth(), middleware.DisableCache())
	users.GET("/dashboard", dashboard)
	users.GET("/invitees", invitees)
	users.GET("/rewards", rewards)
	users.GET("/transfers", transfers)
	writes := users.Group("", middleware.SessionCookieOriginGuard(), middleware.UserCriticalRateLimit("referral"))
	writes.POST("/claim", claim)
	writes.POST("/transfer", transfer)
	admin := apiRouter.Group("/extensions/referral/admin", middleware.RootAuth(), middleware.DisableCache())
	admin.GET("/settings", settings)
	admin.GET("/reviews", reviews)
	admin.GET("/audit", audits)
	adminWrites := admin.Group("", middleware.SessionCookieOriginGuard(), middleware.UserCriticalRateLimit("referral-admin"))
	adminWrites.PUT("/settings", updateSettings)
	adminWrites.POST("/reviews/:id", review)
	adminWrites.POST("/reconcile", reconcile)
	adminWrites.POST("/refund", refund)
}
