package guard

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"net/netip"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func Salt(db *gorm.DB) (string, error) {
	var secret Secret
	err := db.First(&secret, 1).Error
	return secret.Salt, err
}

func Digest(salt, value string) string {
	if value == "" {
		return ""
	}
	mac := hmac.New(sha256.New, []byte(salt))
	_, _ = mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil))
}

type Input struct {
	Stage, Source, Email, IP, Device string
	InviterID                        int
	VerifiedEmail                    bool
}

type Decision struct {
	Settings Settings
	Event    Event
}
type signupKey struct{}

func WithDecision(tx *gorm.DB, d *Decision) *gorm.DB {
	return tx.WithContext(context.WithValue(tx.Statement.Context, signupKey{}, d))
}

func OverrideSignupQuota(tx *gorm.DB) bool {
	d, ok := tx.Statement.Context.Value(signupKey{}).(*Decision)
	return ok && d != nil && d.Settings.BonusEnabled
}

// Increment serializes a shared fixed-window counter. It must be committed even
// when an attempt is denied; callers return policy errors after their transaction.
func Increment(tx *gorm.DB, key string, expires int64, amount int64) (int64, error) {
	row := Counter{Key: key, ExpiresAt: expires}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
		return 0, err
	}
	if err := tx.Model(&Counter{}).Where(clause.Eq{Column: "key", Value: key}).UpdateColumn("count", gorm.Expr("count + ?", amount)).Error; err != nil {
		return 0, err
	}
	if err := tx.First(&row, clause.Eq{Column: "key", Value: key}).Error; err != nil {
		return 0, err
	}
	return row.Count, nil
}

func domainMatches(domain string, list []string) bool {
	for _, d := range list {
		if domain == d || strings.HasSuffix(domain, "."+d) {
			return true
		}
	}
	return false
}

func raise(event *Event, action, reason string) {
	if action == "allow" {
		return
	}
	if event.Action == "allow" || action == "deny" || action == "review" && event.Action == "observe" {
		event.Action = action
	}
	if event.Reasons != "" {
		event.Reasons += "; "
	}
	event.Reasons += reason
}

func Evaluate(db *gorm.DB, input Input, now time.Time) (*Decision, error) {
	s, err := GetSettings(db)
	if err != nil {
		return nil, err
	}
	salt, err := Salt(db)
	if err != nil {
		return nil, err
	}
	email := strings.ToLower(strings.TrimSpace(input.Email))
	_, domain, _ := strings.Cut(email, "@")
	if domain != "" {
		domains, e := normalizeDomains([]string{domain})
		if e != nil {
			return nil, ErrDenied
		}
		domain = domains[0]
	}
	e := Event{CreatedAt: now.Unix(), Stage: input.Stage, Source: input.Source, Action: "allow", InviterID: input.InviterID,
		EmailHash: Digest(salt, "email:"+email), Domain: domain, DeviceHash: Digest(salt, "device:"+input.Device), Revision: s.Revision}
	if email == "" {
		e.EmailHash = ""
	}
	if input.Device == "" {
		e.DeviceHash = ""
	}
	if ip, parseErr := netip.ParseAddr(input.IP); parseErr == nil {
		ip = ip.Unmap()
		e.IPHash = Digest(salt, "ip:"+ip.String())
		bits := s.IPv6Prefix
		if ip.Is4() {
			bits = s.IPv4Prefix
		}
		e.NetworkHash = Digest(salt, "network:"+netip.PrefixFrom(ip, bits).Masked().String())
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		if s.Mode != "off" {
			if input.Stage == "register" && e.EmailHash != "" {
				var recent Event
				err := tx.Where("email_hash = ? AND stage = ? AND action = ? AND enforced = ? AND created_at > ?", e.EmailHash, "email", "review", true, now.Unix()-int64(s.CodeTTLSeconds)).Order("id DESC").Take(&recent).Error
				if err == nil {
					raise(&e, "review", "email-attempt-review")
				} else if !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				}
			}
			if domain != "" && !domainMatches(domain, s.DomainExceptions) && (domainMatches(domain, s.BlockedDomains) || s.AllowOnly && !domainMatches(domain, s.AllowedDomains)) {
				raise(&e, s.DomainAction, "email-domain")
			}
			if input.Stage == "register" && input.Source != "password" && !input.VerifiedEmail {
				raise(&e, s.OAuthEmailAction, "unverified-provider-email")
			}
			signals := map[string]string{"email": e.EmailHash, "ip": e.IPHash, "network": e.NetworkHash, "device": e.DeviceHash, "global": "all"}
			if input.InviterID > 0 {
				signals["inviter"] = fmt.Sprint(input.InviterID)
			}
			for _, rule := range s.Rules {
				value := signals[rule.Signal]
				if !rule.Enabled || rule.Stage != input.Stage || value == "" {
					continue
				}
				start := now.Unix() / int64(rule.WindowSeconds) * int64(rule.WindowSeconds)
				// Include the rule semantics and revision so changing a threshold
				// or signal cannot reinterpret counters from a previous policy.
				key := Digest(salt, fmt.Sprintf("rule:%d:%s:%s:%d", s.Revision, rule.ID, value, start))
				count, err := Increment(tx, key, start+int64(rule.WindowSeconds), 1)
				if err != nil {
					return err
				}
				if count > int64(rule.Limit) {
					raise(&e, rule.Action, rule.ID)
				}
			}
		}
		e.Enforced = s.Mode == "enforce" && (e.Action == "deny" || e.Action == "review")
		return tx.Create(&e).Error
	})
	if err != nil {
		return nil, err
	}
	d := &Decision{Settings: s, Event: e}
	if e.Enforced && e.Action == "deny" {
		return d, ErrDenied
	}
	return d, nil
}

// AfterSignup runs inside the user-creation transaction, after the referral hook.
// A failed signup cannot leave a grant or issue the same grant twice.
func AfterSignup(tx *gorm.DB, userID int, now time.Time) error {
	d, ok := tx.Statement.Context.Value(signupKey{}).(*Decision)
	if !ok || d == nil {
		return nil
	}
	e, s := d.Event, d.Settings
	if e.Stage != "register" || e.Enforced && e.Action == "deny" {
		return ErrDenied
	}
	linked := tx.Model(&Event{}).Where("id = ? AND user_id = 0", e.ID).Update("user_id", userID)
	if linked.Error != nil {
		return linked.Error
	}
	if linked.RowsAffected != 1 {
		return ErrDenied
	}
	state := "active"
	if e.Enforced && e.Action == "review" {
		state = "review"
	}
	account := Account{UserID: userID, EventID: e.ID, CreatedAt: now.Unix(), DeviceHash: e.DeviceHash, NetworkHash: e.NetworkHash, EmailHash: e.EmailHash, InviterID: e.InviterID, State: state}
	if err := tx.Create(&account).Error; err != nil {
		return err
	}
	if state == "review" && s.HoldReferral {
		if err := tx.Table("extension_referral_bindings").Where("user_id = ?", userID).Updates(map[string]any{"state": "review", "reason": "Registration risk requires review", "reviewed_at": 0}).Error; err != nil {
			return err
		}
	}
	if !s.BonusEnabled || s.BonusQuota <= 0 {
		return nil
	}
	grant := Grant{UserID: userID, Total: s.BonusQuota, Remaining: s.BonusQuota, CreatedAt: now.Unix(), ExpiresAt: now.Unix() + int64(s.BonusDays)*86400, State: state}
	if state == "review" {
		grant.Reason = "Registration risk requires review"
	}
	day := now.UTC().Unix() / 86400 * 86400
	issued, err := Increment(tx, fmt.Sprintf("bonus:%d", day), day+86400, int64(s.BonusQuota))
	if err != nil {
		return err
	}
	if s.BonusDailyQuota > 0 && issued > int64(s.BonusDailyQuota) {
		grant.State = "review"
		grant.Reason = "Promotional credit daily budget reached"
	}
	return tx.Create(&grant).Error
}

func IssueCode(db *gorm.DB, email string, now time.Time) (string, error) {
	s, err := GetSettings(db)
	if err != nil {
		return "", err
	}
	salt, err := Salt(db)
	if err != nil {
		return "", err
	}
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return "", err
	}
	code := fmt.Sprintf("%06d", n.Int64())
	key := Digest(salt, "email:"+strings.ToLower(strings.TrimSpace(email)))
	denied := false
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&Challenge{EmailHash: key}).Error; err != nil {
			return err
		}
		if err := tx.Model(&Challenge{}).Where("email_hash = ?", key).UpdateColumn("version", gorm.Expr("version + 1")).Error; err != nil {
			return err
		}
		var row Challenge
		if err := tx.First(&row, "email_hash = ?", key).Error; err != nil {
			return err
		}
		if row.ResendAt > now.Unix() || row.FailureResetAt > now.Unix() && row.Failures >= s.CodeMaxFailures {
			denied = true
			return nil
		}
		if row.FailureResetAt <= now.Unix() {
			row.Failures = 0
			row.FailureResetAt = now.Unix() + int64(s.CodeFailureWindow)
		}
		row.CodeHash = Digest(salt, "code:"+key+":"+code)
		row.ExpiresAt = now.Unix() + int64(s.CodeTTLSeconds)
		row.ResendAt = now.Unix() + int64(s.ResendSeconds)
		return tx.Save(&row).Error
	})
	if err != nil {
		return "", err
	}
	if denied {
		return "", ErrDenied
	}
	return code, nil
}

func ConsumeCode(db *gorm.DB, email, code string, now time.Time) error {
	s, err := GetSettings(db)
	if err != nil {
		return err
	}
	salt, err := Salt(db)
	if err != nil {
		return err
	}
	key := Digest(salt, "email:"+strings.ToLower(strings.TrimSpace(email)))
	valid := false
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&Challenge{EmailHash: key}).Error; err != nil {
			return err
		}
		if err := tx.Model(&Challenge{}).Where("email_hash = ?", key).UpdateColumn("version", gorm.Expr("version + 1")).Error; err != nil {
			return err
		}
		var row Challenge
		if err := tx.First(&row, "email_hash = ?", key).Error; err != nil {
			return err
		}
		if row.FailureResetAt <= now.Unix() {
			row.Failures = 0
			row.FailureResetAt = now.Unix() + int64(s.CodeFailureWindow)
		}
		valid = row.Failures < s.CodeMaxFailures && row.CodeHash != "" && row.ExpiresAt > now.Unix() && hmac.Equal([]byte(row.CodeHash), []byte(Digest(salt, "code:"+key+":"+code)))
		if valid {
			row.CodeHash = ""
			row.ExpiresAt = 0
		} else {
			row.Failures = min(row.Failures+1, s.CodeMaxFailures)
		}
		if err := tx.Save(&row).Error; err != nil {
			return err
		}
		if !valid {
			return tx.Create(&Event{CreatedAt: now.Unix(), Stage: "verify", Action: "deny", Enforced: true, Reasons: "invalid-email-challenge", EmailHash: key, Revision: s.Revision}).Error
		}
		return nil
	})
	if err != nil {
		return err
	}
	if !valid {
		return ErrCode
	}
	return nil
}

// Review controls the grant only. Referral administrators retain their separate
// review so one approval cannot silently release two different reward systems.
func Review(db *gorm.DB, actorID, userID int, approve bool, reason string, now time.Time) error {
	reason = strings.TrimSpace(reason)
	if len([]rune(reason)) < 3 || len(reason) > 500 {
		return ErrInvalid
	}
	return db.Transaction(func(tx *gorm.DB) error {
		state := "rejected"
		if approve {
			state = "active"
		}
		// Serialize both the account and any grant. Expired credits never become
		// spendable again merely because a delayed review was approved.
		result := tx.Model(&Account{}).Where("user_id = ? AND state = ?", userID, "review").Update("state", state)
		if result.Error != nil {
			return result.Error
		}
		grant := tx.Model(&Grant{}).Where("user_id = ? AND state = ?", userID, "review").Updates(map[string]any{"state": state, "reason": reason, "version": gorm.Expr("version + 1")})
		if grant.Error != nil {
			return grant.Error
		}
		if result.RowsAffected+grant.RowsAffected == 0 {
			return ErrConflict
		}
		return tx.Create(&Audit{CreatedAt: now.Unix(), ActorID: actorID, UserID: userID, Action: "grant-" + state, Reason: reason}).Error
	})
}

// MarkSharedPayer is invoked only after a trusted payment callback associated a
// provider-issued payer ID with the user. A weak signal holds future trial use;
// it never confiscates a paid wallet or automatically bans an account.
func MarkSharedPayer(tx *gorm.DB, userID int, provider, payer string, now time.Time) error {
	s, err := GetSettings(tx)
	if err != nil {
		return err
	}
	if s.Mode == "off" {
		return nil
	}
	if payer == "" {
		return nil
	}
	if len(payer) > 2048 || len(provider) > 50 {
		return ErrInvalid
	}
	salt, err := Salt(tx)
	if err != nil {
		return err
	}
	digest := Digest(salt, "payer:"+provider+":"+payer)
	// A shared counter serializes first-time callbacks from different accounts.
	if _, err := Increment(tx, "payer:"+digest, now.Unix()+int64(s.RetentionDays)*86400, 1); err != nil {
		return err
	}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&Payer{Digest: digest, UserID: userID}).Error; err != nil {
		return err
	}
	var count int64
	if err := tx.Model(&Payer{}).Where("user_id <> ? AND digest = ?", userID, digest).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return nil
	}
	e := Event{CreatedAt: now.Unix(), Stage: "payment", Action: s.SharedPayerAction, Enforced: s.Mode == "enforce" && s.SharedPayerAction != "observe", Reasons: "shared-trusted-payer", UserID: userID, Revision: s.Revision}
	if err := tx.Create(&e).Error; err != nil {
		return err
	}
	if !e.Enforced {
		return nil
	}
	state := "review"
	if s.SharedPayerAction == "deny" {
		state = "rejected"
	}
	users := tx.Model(&Payer{}).Select("user_id").Where("digest = ?", digest)
	if err := tx.Model(&Grant{}).Where("user_id IN (?) AND state IN ?", users, []string{"active", "review"}).Updates(map[string]any{"state": state, "reason": "Shared payment account requires review", "version": gorm.Expr("version + 1")}).Error; err != nil {
		return err
	}
	if err := tx.Model(&Account{}).Where("user_id IN (?) AND state IN ?", users, []string{"active", "review"}).Update("state", state).Error; err != nil {
		return err
	}
	if s.HoldReferral {
		return tx.Table("extension_referral_bindings").Where("user_id IN (?) AND state = ?", users, "active").Updates(map[string]any{"state": "review", "reason": "Shared payment account requires review", "reviewed_at": 0}).Error
	}
	return nil
}

func IsPolicyError(err error) bool {
	return errors.Is(err, ErrDenied) || errors.Is(err, ErrInvalid) || errors.Is(err, ErrConflict) || errors.Is(err, ErrCode) || errors.Is(err, ErrUnavailable)
}
