// Package policy owns check-in qualification and rewards independently of the
// gateway models, allowing every check-in entry point to enforce the same rules.
package policy

import "gorm.io/gorm"

type Settings struct {
	ID                     int    `json:"-" gorm:"primaryKey;autoIncrement:false"`
	Enabled                bool   `json:"enabled"`
	Version                int    `json:"version"`
	ThresholdAmount        string `json:"threshold_amount" gorm:"type:varchar(48)"`
	Currency               string `json:"currency" gorm:"type:varchar(8)"`
	CNYPerUSD              string `json:"cny_per_usd" gorm:"type:varchar(48)"`
	RechargeMode           string `json:"recharge_mode" gorm:"type:varchar(16)"`
	LookbackDays           int    `json:"lookback_days"`
	IncludeSubscriptions   bool   `json:"include_subscriptions"`
	EligibilityDays        int    `json:"eligibility_days"`
	RenewOnRecharge        bool   `json:"renew_on_recharge"`
	RewardMode             string `json:"reward_mode" gorm:"type:varchar(16)"`
	RewardMinQuota         int    `json:"reward_min_quota"`
	RewardMaxQuota         int    `json:"reward_max_quota"`
	MonthlyCapQuota        int    `json:"monthly_cap_quota"`
	LifetimeCapQuota       int    `json:"lifetime_cap_quota"`
	DailyBudgetQuota       int    `json:"daily_budget_quota"`
	Timezone               string `json:"timezone" gorm:"type:varchar(64)"`
	FollowRegistrationRisk bool   `json:"follow_registration_risk"`
	RequireTurnstile       bool   `json:"require_turnstile"`
}

func (Settings) TableName() string { return "extension_checkin_settings" }

type Account struct {
	UserID      int    `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	State       string `json:"state" gorm:"type:varchar(16)"`
	Reason      string `json:"reason" gorm:"type:varchar(500)"`
	UpdatedAt   int64  `json:"updated_at"`
	UpdatedBy   int    `json:"updated_by"`
	LastClaimAt int64  `json:"last_claim_at"`
	// Preserve the reset promised at the last claim. Moving the configured
	// timezone must not give an account an earlier second reward.
	NextResetAt int64 `json:"next_reset_at"`
}

func (Account) TableName() string { return "extension_checkin_accounts" }

type Audit struct {
	ID              int    `json:"id" gorm:"primaryKey"`
	ActorID         int    `json:"actor_id"`
	UserID          int    `json:"user_id" gorm:"index"`
	Action          string `json:"action" gorm:"type:varchar(40)"`
	Detail          string `json:"detail" gorm:"type:text"`
	Reason          string `json:"reason" gorm:"type:varchar(500)"`
	CreatedAt       int64  `json:"created_at" gorm:"index"`
	SettingsVersion int    `json:"settings_version"`
}

func (Audit) TableName() string { return "extension_checkin_audits" }

// Checkin is a host-table projection. Migrations remain owned by model.Checkin;
// the plugin continues the existing history and daily uniqueness guarantee.
type Checkin struct {
	ID           int    `json:"id" gorm:"primaryKey"`
	UserID       int    `json:"user_id"`
	CheckinDate  string `json:"checkin_date"`
	QuotaAwarded int    `json:"quota_awarded"`
	CreatedAt    int64  `json:"created_at"`
}

func (Checkin) TableName() string { return "checkins" }

type CheckinRecord struct {
	CheckinDate  string `json:"checkin_date"`
	QuotaAwarded int    `json:"quota_awarded"`
}

// HostUser and RegistrationAccount contain only the fields needed to enforce
// eligibility. They are never migrated as extension tables.
type HostUser struct {
	ID        int
	Username  string
	Status    int
	Quota     int
	DeletedAt gorm.DeletedAt
}

func (HostUser) TableName() string { return "users" }

type RegistrationAccount struct {
	UserID int
	State  string
}

func (RegistrationAccount) TableName() string { return "extension_registration_accounts" }

type Stats struct {
	TotalCheckins int64 `json:"total_checkins"`
	TotalQuota    int   `json:"total_quota"`
	MonthCheckins int64 `json:"month_checkins"`
	MonthQuota    int   `json:"month_quota"`
}

type Eligibility struct {
	Eligible        bool   `json:"eligible"`
	Reason          string `json:"reason"`
	QualifiedAmount string `json:"qualified_amount"`
	RemainingAmount string `json:"remaining_amount"`
	Currency        string `json:"currency"`
	LastRechargeAt  int64  `json:"last_recharge_at"`
	QualifiedAt     int64  `json:"qualified_at"`
	ExpiresAt       int64  `json:"expires_at"`
}

type DashboardData struct {
	Enabled              bool            `json:"enabled"`
	Today                string          `json:"today"`
	Month                string          `json:"month"`
	Timezone             string          `json:"timezone"`
	NextResetAt          int64           `json:"next_reset_at"`
	VerificationRequired bool            `json:"verification_required"`
	Rules                Settings        `json:"rules"`
	Eligibility          Eligibility     `json:"eligibility"`
	CheckedInToday       bool            `json:"checked_in_today"`
	Claimable            bool            `json:"claimable"`
	ClaimReason          string          `json:"claim_reason"`
	Stats                Stats           `json:"stats"`
	Records              []CheckinRecord `json:"records"`
}
