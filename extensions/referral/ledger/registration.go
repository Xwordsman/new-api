package ledger

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type signupContextKey struct{}
type signupSignals struct{ Network, Client, Browser string }

// WithSignupBrowser receives the registration guard's signed-cookie digest.
// A resettable browser marker is evidence for reward review, never identity proof.
func WithSignupBrowser(tx *gorm.DB, browser string) *gorm.DB {
	signals, _ := tx.Statement.Context.Value(signupContextKey{}).(signupSignals)
	signals.Browser = browser
	return tx.WithContext(context.WithValue(tx.Statement.Context, signupContextKey{}, signals))
}

func WithSignupContext(tx *gorm.DB, ip, agent string) *gorm.DB {
	signals, _ := tx.Statement.Context.Value(signupContextKey{}).(signupSignals)
	signals.Network, signals.Client = ip, agent
	return tx.WithContext(context.WithValue(tx.Statement.Context, signupContextKey{}, signals))
}

func digest(salt, value string) string {
	if value == "" {
		return ""
	}
	mac := hmac.New(sha256.New, []byte(salt))
	_, _ = mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil))
}

func Observe(tx *gorm.DB, userID int, ip, agent string) error {
	settings, err := GetSettings(tx)
	if err != nil {
		return err
	}
	if ip == "" {
		return nil
	}
	signal := Signal{UserID: userID, Network: digest(settings.RiskSalt, ip), Client: digest(settings.RiskSalt, ip+"|"+agent)}
	if signals, ok := tx.Statement.Context.Value(signupContextKey{}).(signupSignals); ok {
		signal.Browser = digest(settings.RiskSalt, signals.Browser)
	}
	// Keep the original registration signal; changing a browser cannot erase it.
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&signal).Error
}

// RestoreSignupBrowsers imports original registration markers during an upgrade.
// It never replaces existing evidence or invents a missing registration signal.
func RestoreSignupBrowsers(db *gorm.DB, markers map[int]string) error {
	settings, err := GetSettings(db)
	if err != nil {
		return err
	}
	for id, marker := range markers {
		if marker == "" {
			continue
		}
		if err := db.Model(&Signal{}).Where("user_id = ? AND (browser = '' OR browser IS NULL)", id).Update("browser", digest(settings.RiskSalt, marker)).Error; err != nil {
			return err
		}
	}
	return nil
}

func Register(tx *gorm.DB, userID, inviterID int, registeredAt int64) error {
	return registerInvitation(tx, userID, inviterID, registeredAt, true)
}

func registerInvitation(tx *gorm.DB, userID, inviterID int, registeredAt int64, signup bool) error {
	settings, err := GetSettings(tx)
	// Model tests and installations before extension initialization have no tables.
	// Production migrations run before accepting registrations.
	if err != nil {
		return err
	}
	// Use the same account -> binding lock order as award, payment and review.
	// Cooling-end checks also cover records committed after a MySQL snapshot.
	if inviterID > 0 && inviterID != userID {
		if _, err := lockAccount(tx, inviterID); err != nil {
			return err
		}
	}
	if signals, ok := tx.Statement.Context.Value(signupContextKey{}).(signupSignals); ok {
		if err := Observe(tx, userID, signals.Network, signals.Client); err != nil {
			return err
		}
	}
	if inviterID <= 0 || inviterID == userID {
		return nil
	}
	if registeredAt <= 0 {
		registeredAt = time.Now().Unix()
	}
	state, reason := "active", ""
	historical := registeredAt < settings.StartedAt
	if historical {
		state, reason = "historical", "Historical invitation requires approval"
	}
	if !settings.Enabled {
		state, reason = "ineligible", "Referral program was paused at registration"
	}
	binding := Binding{UserID: userID, InviterID: inviterID, RegisteredAt: registeredAt, ExpiresAt: registeredAt + int64(settings.WindowDays)*86400, RateBPS: settings.RateBPS, CapQuota: settings.CapQuota, CoolingHours: settings.CoolingHours, SettingsVersion: settings.Version, State: state, Reason: reason, Historical: historical}
	if signup && settings.Enabled && settings.SignupBonusEnabled && !historical {
		binding.SignupBonusQuota = settings.SignupBonusQuota
		binding.SignupBonusAvailableAt = registeredAt + int64(settings.SignupCoolingHours)*3600
	}
	result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&binding)
	if result.Error != nil || result.RowsAffected == 0 {
		return result.Error
	}
	return checkQualification(tx, &binding)
}

// ImportHistory exposes existing invitations without awarding old payments.
func ImportHistory(tx *gorm.DB, inviterID int) error {
	var users []HostUser
	query := tx.Where("inviter_id > 0 AND NOT EXISTS (SELECT 1 FROM extension_referral_bindings b WHERE b.user_id = users.id)")
	if inviterID > 0 {
		query = query.Where("inviter_id = ?", inviterID)
	}
	return query.FindInBatches(&users, 200, func(batch *gorm.DB, _ int) error {
		for _, user := range users {
			var count int64
			if err := batch.Model(&Binding{}).Where("user_id = ?", user.ID).Count(&count).Error; err != nil {
				return err
			}
			if count == 0 {
				registeredAt := user.CreatedAt
				if registeredAt <= 0 {
					registeredAt = 1
				}
				if err := registerInvitation(batch, user.ID, user.InviterID, registeredAt, false); err != nil {
					return err
				}
			}
		}
		return nil
	}).Error
}

// CompleteSignup runs after registration risk checks, inside the signup or
// review transaction. The binding is the one-time gift ledger; payment rewards
// and their cap/window/cooling rules are deliberately independent.
func CompleteSignup(tx *gorm.DB, userID int) error {
	return completeSignupAt(tx, userID, time.Now().Unix())
}

// ReleaseSignupBonuses is retried by the shared task runner. Each award rechecks
// eligibility and commits its account, binding and audit record atomically.
func ReleaseSignupBonuses(db *gorm.DB, now int64) error {
	var bindings []Binding
	if err := db.Where("signup_bonus_quota > 0 AND signup_bonus_paid_at = 0 AND signup_bonus_available_at <= ? AND state = ? AND historical = ?", now, "active", false).Order("id").Limit(200).Find(&bindings).Error; err != nil {
		return err
	}
	for _, binding := range bindings {
		if err := db.Transaction(func(tx *gorm.DB) error { return completeSignupAt(tx, binding.UserID, now) }); err != nil {
			return err
		}
	}
	return nil
}

func completeSignupAt(tx *gorm.DB, userID int, now int64) error {
	var binding Binding
	if err := tx.First(&binding, "user_id = ?", userID).Error; err != nil {
		if isMissing(err) {
			return nil
		}
		return err
	}
	if binding.SignupBonusQuota <= 0 || binding.SignupBonusPaidAt > 0 || binding.State != "active" || binding.Historical {
		return nil
	}
	settings, err := GetSettings(tx)
	if err != nil {
		return err
	}
	if !settings.Enabled {
		return nil
	}
	account, err := lockAccount(tx, binding.InviterID)
	if err != nil {
		return err
	}
	if err := Lock(tx).First(&binding, binding.ID).Error; err != nil {
		return err
	}
	if binding.SignupBonusPaidAt > 0 || binding.State != "active" || binding.Historical {
		return nil
	}
	if err := checkQualification(tx, &binding); err != nil {
		return err
	}
	if binding.State != "active" || binding.SignupBonusAvailableAt > now {
		return nil
	}
	offset := min(binding.SignupBonusQuota, account.Debt)
	balance, balanceErr := checkedAdd(account.Balance, binding.SignupBonusQuota-offset)
	earned, earnedErr := checkedAdd(account.Earned, binding.SignupBonusQuota)
	if balanceErr != nil || earnedErr != nil {
		// A full inviter account must not prevent a new user from registering.
		return tx.Model(&binding).Updates(map[string]any{"state": "review", "reason": "Referral reward balance requires review", "reviewed_at": 0}).Error
	}
	account.Balance, account.Earned, account.Debt = balance, earned, account.Debt-offset
	if err := tx.Save(&account).Error; err != nil {
		return err
	}
	binding.SignupBonusPaidAt = now
	if err := tx.Model(&binding).Update("signup_bonus_paid_at", binding.SignupBonusPaidAt).Error; err != nil {
		return err
	}
	return tx.Create(&Audit{UserID: binding.UserID, Action: "signup_bonus", Detail: common.GetJsonString(map[string]any{"inviter_id": binding.InviterID, "quota": binding.SignupBonusQuota, "offset": offset, "settings_version": binding.SettingsVersion}), CreatedAt: binding.SignupBonusPaidAt}).Error
}

func checkQualification(tx *gorm.DB, binding *Binding) error {
	if binding.State == "ineligible" || binding.State == "historical" {
		return nil
	}
	if err := activeUsers(tx, binding.InviterID, binding.UserID); err != nil {
		if err != ErrUnavailable {
			return err
		}
		binding.State, binding.Reason = "review", "Account eligibility requires review"
		return tx.Model(binding).Updates(map[string]any{"state": binding.State, "reason": binding.Reason}).Error
	}
	if binding.ReviewedAt > 0 {
		return nil
	}
	// A hold is durable: evidence retention, policy changes and time cannot
	// approve it. Only the audited administrator Review operation can do so.
	if binding.State == "review" {
		return nil
	}
	var sharedPayment int64
	identities := tx.Model(&PaymentIdentity{}).Select("digest").Where("user_id IN ?", []int{binding.UserID, binding.InviterID})
	if err := tx.Model(&PaymentIdentity{}).Where("digest IN (?)", identities).Where("EXISTS (SELECT 1 FROM extension_referral_payment_identities peer WHERE peer.digest = extension_referral_payment_identities.digest AND peer.user_id <> extension_referral_payment_identities.user_id)").Count(&sharedPayment).Error; err != nil {
		return err
	}
	if sharedPayment > 0 {
		binding.State, binding.Reason = "review", "Shared payment account requires review"
		return tx.Model(binding).Updates(map[string]any{"state": binding.State, "reason": binding.Reason}).Error
	}
	var own Signal
	if err := tx.First(&own, "user_id = ?", binding.UserID).Error; err != nil {
		if !isMissing(err) {
			return err
		}
		binding.State, binding.Reason = "review", "Registration evidence requires review"
	} else {
		settings, err := GetSettings(tx)
		if err != nil {
			return err
		}
		var related int64
		if settings.ReviewSharedBrowser {
			browsers := tx.Model(&Signal{}).Select("browser").Where("user_id IN ? AND browser <> ''", []int{binding.UserID, binding.InviterID})
			if err := tx.Model(&Signal{}).Where("browser IN (?)", browsers).Where("EXISTS (SELECT 1 FROM extension_referral_signals peer WHERE peer.browser = extension_referral_signals.browser AND peer.user_id <> extension_referral_signals.user_id)").Count(&related).Error; err != nil {
				return err
			}
		}
		if related > 0 {
			binding.State, binding.Reason = "review", "Shared registration browser requires review"
		}
		burst, err := inviterHasRegistrationBurst(tx, binding.InviterID, settings)
		if err != nil {
			return err
		}
		if burst {
			binding.State, binding.Reason = "review", "Concentrated invitation registrations require review"
		}
		// An office address alone is not a risk decision. A configurable burst
		// under one inviter and exact registration IP holds unpaid rewards only.
		if settings.InviteBurstLimit > 0 && own.Network != "" {
			var candidates []Binding
			window := int64(settings.InviteBurstMinutes) * 60
			if err := tx.Model(&Binding{}).Select("extension_referral_bindings.user_id, extension_referral_bindings.registered_at").Joins("JOIN extension_referral_signals s ON s.user_id = extension_referral_bindings.user_id").Where("inviter_id = ? AND registered_at >= ? AND registered_at <= ? AND s.network = ?", binding.InviterID, binding.RegisteredAt-window, binding.RegisteredAt+window, own.Network).Order("registered_at, extension_referral_bindings.user_id").Find(&candidates).Error; err != nil {
				return err
			}
			// A burst must fit inside one configured window, not a doubled
			// window around the member being checked.
			start, bestStart, bestEnd := 0, 0, 0
			for end := range candidates {
				for candidates[end].RegisteredAt-candidates[start].RegisteredAt > window {
					start++
				}
				if candidates[start].RegisteredAt <= binding.RegisteredAt && candidates[end].RegisteredAt >= binding.RegisteredAt && end-start+1 > bestEnd-bestStart {
					bestStart, bestEnd = start, end+1
				}
			}
			ids := make([]int, 0, bestEnd-bestStart)
			for _, candidate := range candidates[bestStart:bestEnd] {
				ids = append(ids, candidate.UserID)
			}
			if len(ids) >= settings.InviteBurstLimit {
				binding.State, binding.Reason = "review", "Concentrated invitation registrations require review"
				if err := tx.Model(&Binding{}).Where("user_id IN ? AND state = ? AND signup_bonus_paid_at = 0 AND reviewed_at = 0", ids, "active").Updates(map[string]any{"state": "review", "reason": binding.Reason}).Error; err != nil {
					return err
				}
			}
		}
	}
	return tx.Model(&Binding{}).Where("user_id = ?", binding.UserID).Updates(map[string]any{"state": binding.State, "reason": strings.TrimSpace(binding.Reason)}).Error
}

// The recipient's other invitations matter too, even when this invitee changes
// browser or network. A shared IP alone never satisfies this time-bounded rule.
func inviterHasRegistrationBurst(tx *gorm.DB, inviterID int, settings Settings) (bool, error) {
	if settings.InviteBurstLimit < 2 {
		return false, nil
	}
	var rows []struct {
		Network      string
		RegisteredAt int64
	}
	err := tx.Model(&Binding{}).Select("s.network, extension_referral_bindings.registered_at").Joins("JOIN extension_referral_signals s ON s.user_id = extension_referral_bindings.user_id").Where("inviter_id = ? AND s.network <> ''", inviterID).Order("s.network, extension_referral_bindings.registered_at").Limit(100001).Scan(&rows).Error
	if err != nil {
		return false, err
	}
	if len(rows) > 100000 {
		return true, nil
	}
	start := 0
	for end := range rows {
		for rows[start].Network != rows[end].Network || rows[end].RegisteredAt-rows[start].RegisteredAt > int64(settings.InviteBurstMinutes)*60 {
			start++
		}
		if end-start+1 >= settings.InviteBurstLimit {
			return true, nil
		}
	}
	return false, nil
}
