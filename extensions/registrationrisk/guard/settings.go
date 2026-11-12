// Package guard owns registration policies and promotional credits without
// depending on the host's models, controllers, or relay services.
package guard

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"math"
	"net/mail"
	"net/url"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"golang.org/x/net/idna"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrInvalid     = common.NewMessage("Invalid registration risk settings")
	ErrConflict    = common.NewMessage("Registration risk settings changed. Reload before saving.")
	ErrDenied      = common.NewMessage("Registration cannot be completed. Please try later or contact support.")
	ErrCode        = common.NewMessage("Verification code is incorrect or has expired")
	ErrUnavailable = errors.New("promotional credit unavailable")
)

const settingsKey = "RegistrationRiskExtensionSettings"

type Rule struct {
	ID            string `json:"id"`
	Enabled       bool   `json:"enabled"`
	Stage         string `json:"stage"`
	Signal        string `json:"signal"`
	WindowSeconds int    `json:"window_seconds"`
	Limit         int    `json:"limit"`
	Action        string `json:"action"`
}

type Settings struct {
	Revision               int64    `json:"revision"`
	Mode                   string   `json:"mode"`
	RequireEmail           bool     `json:"require_email"`
	OAuthEmailAction       string   `json:"oauth_email_action"`
	Captcha                bool     `json:"captcha"`
	CaptchaHostname        string   `json:"captcha_hostname"`
	CodeTTLSeconds         int      `json:"code_ttl_seconds"`
	ResendSeconds          int      `json:"resend_seconds"`
	CodeMaxFailures        int      `json:"code_max_failures"`
	CodeFailureWindow      int      `json:"code_failure_window"`
	DomainAction           string   `json:"domain_action"`
	AllowOnly              bool     `json:"allow_only"`
	BlockedDomains         []string `json:"blocked_domains"`
	AllowedDomains         []string `json:"allowed_domains"`
	DomainExceptions       []string `json:"domain_exceptions"`
	IPv4Prefix             int      `json:"ipv4_prefix"`
	IPv6Prefix             int      `json:"ipv6_prefix"`
	DeviceDays             int      `json:"device_days"`
	Rules                  []Rule   `json:"rules"`
	BonusEnabled           bool     `json:"bonus_enabled"`
	BonusQuota             int      `json:"bonus_quota"`
	BonusDays              int      `json:"bonus_days"`
	BonusDailyQuota        int      `json:"bonus_daily_quota"`
	BonusModels            []string `json:"bonus_models"`
	BonusRPM               int      `json:"bonus_rpm"`
	BonusConcurrency       int      `json:"bonus_concurrency"`
	LeaseSeconds           int      `json:"lease_seconds"`
	SharedPayerAction      string   `json:"shared_payer_action"`
	HoldReferral           bool     `json:"hold_referral"`
	AlertEnabled           bool     `json:"alert_enabled"`
	AlertEmails            []string `json:"alert_emails"`
	AlertWebhook           string   `json:"alert_webhook"`
	AlertMinutes           int      `json:"alert_minutes"`
	AlertWindowMinutes     int      `json:"alert_window_minutes"`
	AlertRiskCount         int      `json:"alert_risk_count"`
	AlertEmailCount        int      `json:"alert_email_count"`
	AlertCompletionPercent int      `json:"alert_completion_percent"`
	AlertBudgetPercent     int      `json:"alert_budget_percent"`
	AlertDedupMinutes      int      `json:"alert_dedup_minutes"`
	RetentionDays          int      `json:"retention_days"`
}

type option struct {
	Key   string `gorm:"primaryKey;size:191"`
	Value string `gorm:"type:text"`
}

func (option) TableName() string { return "options" }

type Secret struct {
	ID   int    `gorm:"primaryKey;autoIncrement:false"`
	Salt string `gorm:"size:64"`
}

func (Secret) TableName() string { return "extension_registration_secrets" }

func Defaults() Settings {
	return Settings{Mode: "observe", OAuthEmailAction: "review", CodeTTLSeconds: 600, ResendSeconds: 60,
		CodeMaxFailures: 5, CodeFailureWindow: 3600, DomainAction: "deny", BlockedDomains: []string{"mail.tm", "maildrop.cc", "guerrillamail.com", "tempmail.com", "10minutemail.com"},
		AllowedDomains: []string{}, DomainExceptions: []string{}, IPv4Prefix: 24, IPv6Prefix: 56, DeviceDays: 180,
		Rules: []Rule{
			{ID: "email-hour", Enabled: true, Stage: "email", Signal: "email", WindowSeconds: 3600, Limit: 5, Action: "deny"},
			{ID: "mail-ip", Enabled: true, Stage: "email", Signal: "ip", WindowSeconds: 3600, Limit: 20, Action: "deny"},
			{ID: "device-day", Enabled: true, Stage: "register", Signal: "device", WindowSeconds: 86400, Limit: 2, Action: "review"},
			{ID: "network-hour", Enabled: true, Stage: "register", Signal: "network", WindowSeconds: 3600, Limit: 10, Action: "review"},
			{ID: "inviter-day", Enabled: true, Stage: "register", Signal: "inviter", WindowSeconds: 86400, Limit: 20, Action: "review"},
			{ID: "global-mail", Enabled: true, Stage: "email", Signal: "global", WindowSeconds: 3600, Limit: 200, Action: "deny"},
		}, BonusEnabled: true, BonusQuota: common.QuotaForNewUser, BonusDays: 7, BonusDailyQuota: 50000000,
		BonusModels: []string{}, BonusRPM: 5, BonusConcurrency: 1, LeaseSeconds: 1800, SharedPayerAction: "review", HoldReferral: true,
		AlertEmails: []string{}, AlertMinutes: 5, AlertWindowMinutes: 60, AlertRiskCount: 10, AlertEmailCount: 50, AlertCompletionPercent: 10,
		AlertBudgetPercent: 80, AlertDedupMinutes: 60, RetentionDays: 90}
}

func GetSettings(db *gorm.DB) (Settings, error) {
	s := Defaults()
	var row option
	err := db.Where(clause.Eq{Column: "key", Value: settingsKey}).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	err = common.UnmarshalJsonStr(row.Value, &s)
	return s, err
}

func validAction(action string) bool {
	return slices.Contains([]string{"observe", "review", "deny"}, action)
}

func normalizeDomains(list []string) ([]string, error) {
	result := make([]string, 0, len(list))
	if len(list) > 2000 {
		return nil, ErrInvalid
	}
	for _, d := range list {
		d, err := idna.Lookup.ToASCII(strings.ToLower(strings.TrimSuffix(strings.TrimSpace(d), ".")))
		if err != nil || len(d) > 253 || !strings.Contains(d, ".") || strings.ContainsAny(d, " /@*:?") {
			return nil, ErrInvalid
		}
		for label := range strings.SplitSeq(d, ".") {
			if len(label) == 0 || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
				return nil, ErrInvalid
			}
		}
		result = append(result, d)
	}
	slices.Sort(result)
	return slices.Compact(result), nil
}

func SaveSettings(db *gorm.DB, s Settings) (Settings, error) {
	if s.Revision < 0 || s.Revision == math.MaxInt64 || !slices.Contains([]string{"off", "observe", "enforce"}, s.Mode) ||
		!validAction(s.OAuthEmailAction) || !validAction(s.DomainAction) || !validAction(s.SharedPayerAction) ||
		s.CodeTTLSeconds < 60 || s.CodeTTLSeconds > 1800 || s.ResendSeconds < 10 || s.ResendSeconds > 3600 || s.CodeMaxFailures < 1 || s.CodeMaxFailures > 20 ||
		s.CodeFailureWindow < 60 || s.CodeFailureWindow > 86400 || s.IPv4Prefix < 8 || s.IPv4Prefix > 32 || s.IPv6Prefix < 16 || s.IPv6Prefix > 128 ||
		s.DeviceDays < 1 || s.DeviceDays > 730 || len(s.Rules) > 50 || s.BonusQuota < 0 || s.BonusQuota > math.MaxInt32 || s.BonusDays < 1 || s.BonusDays > 365 ||
		s.BonusDailyQuota < 0 || int64(s.BonusDailyQuota) > common.MaxWalletQuota || s.BonusRPM < 1 || s.BonusRPM > 10000 || s.BonusConcurrency < 1 || s.BonusConcurrency > 100 ||
		s.LeaseSeconds < 60 || s.LeaseSeconds > 86400 || len(s.BonusModels) > 200 || s.AlertMinutes < 1 || s.AlertMinutes > 1440 ||
		s.AlertWindowMinutes < 1 || s.AlertWindowMinutes > 1440 || s.AlertRiskCount < 1 || s.AlertEmailCount < 1 || s.AlertCompletionPercent < 0 || s.AlertCompletionPercent > 100 ||
		s.AlertBudgetPercent < 1 || s.AlertBudgetPercent > 100 || s.AlertDedupMinutes < 1 || s.AlertDedupMinutes > 10080 || s.RetentionDays < 1 || s.RetentionDays > 3650 || len(s.AlertEmails) > 20 {
		return s, ErrInvalid
	}
	var err error
	s.BlockedDomains, err = normalizeDomains(s.BlockedDomains)
	if err != nil {
		return s, err
	}
	s.AllowedDomains, err = normalizeDomains(s.AllowedDomains)
	if err != nil {
		return s, err
	}
	s.DomainExceptions, err = normalizeDomains(s.DomainExceptions)
	if err != nil {
		return s, err
	}
	if s.AllowOnly && len(s.AllowedDomains) == 0 {
		return s, ErrInvalid
	}
	s.CaptchaHostname = strings.TrimSpace(strings.ToLower(s.CaptchaHostname))
	if strings.ContainsAny(s.CaptchaHostname, " /:?#") || len(s.CaptchaHostname) > 253 {
		return s, ErrInvalid
	}
	if s.Captcha && (common.TurnstileSecretKey == "" || common.TurnstileSiteKey == "") {
		return s, ErrInvalid
	}
	ids := map[string]bool{}
	for _, r := range s.Rules {
		if r.ID == "" || len(r.ID) > 50 || strings.ContainsAny(r.ID, " /|\n\r") || ids[r.ID] || !slices.Contains([]string{"email", "register"}, r.Stage) ||
			!slices.Contains([]string{"email", "ip", "network", "device", "inviter", "global"}, r.Signal) || !validAction(r.Action) || r.WindowSeconds < 10 || r.WindowSeconds > 2592000 || r.Limit < 1 || r.Limit > 1000000 {
			return s, ErrInvalid
		}
		ids[r.ID] = true
	}
	for i, m := range s.BonusModels {
		m = strings.TrimSpace(m)
		if m == "" || len(m) > 200 || strings.ContainsAny(m, "*\r\n") {
			return s, ErrInvalid
		}
		s.BonusModels[i] = m
	}
	for _, a := range s.AlertEmails {
		parsed, e := mail.ParseAddress(a)
		if e != nil || parsed.Address != a || len(a) > 254 {
			return s, ErrInvalid
		}
	}
	if s.AlertWebhook != "" {
		u, e := url.Parse(s.AlertWebhook)
		if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || len(s.AlertWebhook) > 2000 {
			return s, ErrInvalid
		}
	}
	if s.Rules == nil {
		s.Rules = []Rule{}
	}
	if s.BonusModels == nil {
		s.BonusModels = []string{}
	}
	if s.AlertEmails == nil {
		s.AlertEmails = []string{}
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		initial, e := common.Marshal(Defaults())
		if e != nil {
			return e
		}
		if e = tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&option{Key: settingsKey, Value: string(initial)}).Error; e != nil {
			return e
		}
		var current option
		if e = tx.Where(clause.Eq{Column: "key", Value: settingsKey}).Take(&current).Error; e != nil {
			return e
		}
		var old Settings
		if e = common.UnmarshalJsonStr(current.Value, &old); e != nil {
			return e
		}
		if old.Revision != s.Revision {
			return ErrConflict
		}
		s.Revision++
		encoded, e := common.Marshal(s)
		if e != nil {
			return e
		}
		r := tx.Model(&option{}).Where(clause.Eq{Column: "key", Value: settingsKey}).Where("value = ?", current.Value).Update("value", string(encoded))
		if r.Error != nil {
			return r.Error
		}
		if r.RowsAffected != 1 {
			return ErrConflict
		}
		return nil
	})
	return s, err
}

func Migrate(db *gorm.DB) error {
	if err := db.AutoMigrate(&Secret{}, &Counter{}, &Challenge{}, &Event{}, &Account{}, &Grant{}, &Reservation{}, &Alert{}, &Audit{}, &Payer{}); err != nil {
		return err
	}
	var salt [32]byte
	if _, err := rand.Read(salt[:]); err != nil {
		return err
	}
	return db.Clauses(clause.OnConflict{DoNothing: true}).Create(&Secret{ID: 1, Salt: hex.EncodeToString(salt[:])}).Error
}
