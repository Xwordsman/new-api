package extensions

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/extensions/benchmark"
	"github.com/QuantumNous/new-api/extensions/channelmonitor"
	"github.com/QuantumNous/new-api/extensions/checkin"
	"github.com/QuantumNous/new-api/extensions/concurrency"
	documentation "github.com/QuantumNous/new-api/extensions/documentation"
	"github.com/QuantumNous/new-api/extensions/emailtemplate"
	"github.com/QuantumNous/new-api/extensions/invitation"
	"github.com/QuantumNous/new-api/extensions/keypricing"
	keypricepolicy "github.com/QuantumNous/new-api/extensions/keypricing/policy"
	"github.com/QuantumNous/new-api/extensions/leaderboard"
	"github.com/QuantumNous/new-api/extensions/referral"
	"github.com/QuantumNous/new-api/extensions/referral/ledger"
	"github.com/QuantumNous/new-api/extensions/registrationrisk"
	"github.com/QuantumNous/new-api/extensions/registrationrisk/guard"
	"github.com/QuantumNous/new-api/extensions/requestprotection"
	requestpolicy "github.com/QuantumNous/new-api/extensions/requestprotection/policy"
	"github.com/QuantumNous/new-api/extensions/tickets"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Migrate runs database migrations owned by compile-time extensions.
func Migrate(db *gorm.DB) error {
	if err := requestpolicy.Migrate(db); err != nil {
		return err
	}
	if err := keypricepolicy.Migrate(db); err != nil {
		return err
	}
	if err := invitation.Migrate(db); err != nil {
		return err
	}
	if err := referral.Migrate(db); err != nil {
		return err
	}
	if err := checkin.Migrate(db); err != nil {
		return err
	}
	if err := benchmark.Migrate(db); err != nil {
		return err
	}
	if err := tickets.Migrate(db); err != nil {
		return err
	}
	if err := leaderboard.Migrate(db); err != nil {
		return err
	}
	if err := documentation.Migrate(db); err != nil {
		return err
	}
	return guard.Migrate(db)
}

func Initialize(db *gorm.DB) {
	emailtemplate.Initialize()
	service.InstallRequestProtection()
	service.InstallKeyPriceProtection()
	referral.Initialize(db)
	checkin.Initialize(db)
	registrationrisk.Initialize(db)
	leaderboard.Initialize(db)
}

// RegisterRoutes mounts routes owned by compile-time extensions.
func RegisterRoutes(apiRouter *gin.RouterGroup) {
	documentation.RegisterRoutes(apiRouter)
	concurrency.RegisterRoutes(apiRouter)
	emailtemplate.RegisterRoutes(apiRouter)
	requestprotection.RegisterRoutes(apiRouter)
	keypricing.RegisterRoutes(apiRouter)
	benchmark.RegisterRoutes(apiRouter)
	channelmonitor.RegisterRoutes(apiRouter)
	invitation.RegisterRoutes(apiRouter)
	referral.RegisterRoutes(apiRouter)
	checkin.RegisterRoutes(apiRouter)
	tickets.RegisterRoutes(apiRouter)
	leaderboard.RegisterRoutes(apiRouter)
	registrationrisk.RegisterRoutes(apiRouter)
}

// FeatureStatus publishes only the switches needed for console navigation.
// Unavailable settings hide their own entry without hiding healthy features or
// preventing the rest of the public site configuration from loading.
func FeatureStatus(db *gorm.DB) (map[string]bool, error) {
	features := map[string]bool{}
	var errs []error
	for _, feature := range []struct {
		key     string
		enabled func(*gorm.DB) (bool, error)
	}{
		{"channel_monitor", channelmonitor.Enabled},
		{"benchmark", benchmark.Enabled},
		{"referrals", referral.Enabled},
		{"checkin", checkin.Enabled},
		{"leaderboard", leaderboard.Enabled},
		{"documentation", documentation.Enabled},
	} {
		features[feature.key] = false
		if db == nil {
			continue
		}
		enabled, err := feature.enabled(db)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", feature.key, err))
			continue
		}
		features[feature.key] = enabled
	}
	return features, errors.Join(errs...)
}

// ExportDocumentation exposes the public, published catalog for AI clients.
func ExportDocumentation(c *gin.Context) {
	documentation.ExportLLMs(c)
}

func ReferralSignupContext(tx *gorm.DB, ip, agent string) *gorm.DB {
	return ledger.WithSignupContext(tx, ip, agent)
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
