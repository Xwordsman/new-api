package extensions

import (
	"github.com/QuantumNous/new-api/extensions/homepage"
	"github.com/QuantumNous/new-api/extensions/invitation"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Migrate runs database migrations owned by compile-time extensions.
func Migrate(db *gorm.DB) error {
	if err := invitation.Migrate(db); err != nil {
		return err
	}
	return homepage.Migrate(db)
}

// RegisterRoutes mounts routes owned by compile-time extensions.
func RegisterRoutes(apiRouter *gin.RouterGroup) {
	invitation.RegisterRoutes(apiRouter)
	homepage.RegisterRoutes(apiRouter)
}

func HomepageAccessSettings(db *gorm.DB) (homepage.Settings, error) {
	return homepage.GetSettings(db)
}

func InvitationRegistrationEnabled(db *gorm.DB) (bool, error) {
	return invitation.RegistrationEnabled(db)
}

func ConsumeRegistrationInvitation(tx *gorm.DB, code string) error {
	return invitation.Consume(tx, code)
}

func InvitationErrorMessageKey(err error) string {
	return invitation.ErrorMessageKey(err)
}

func IsInvitationError(err error) bool {
	return invitation.IsCodeError(err)
}
