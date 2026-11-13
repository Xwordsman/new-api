package policy

import "gorm.io/gorm"

const ProbabilityTotal = 1000000 // One unit is 0.0001 percent.

type Prize struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Kind   string `json:"kind"`
	Quota  int    `json:"quota"`
	Weight int    `json:"weight"`
	Stock  int64  `json:"stock"` // Total inventory, zero means unlimited; never reset on settings edits.
	Color  string `json:"color"`
}

type Settings struct {
	ID                     int     `json:"-" gorm:"primaryKey;autoIncrement:false"`
	Version                int     `json:"version"`
	Enabled                bool    `json:"enabled"`
	ThresholdAmount        string  `json:"threshold_amount" gorm:"type:varchar(48)"`
	Currency               string  `json:"currency" gorm:"type:varchar(8)"`
	RechargeMode           string  `json:"recharge_mode" gorm:"type:varchar(16)"`
	LookbackDays           int     `json:"lookback_days"`
	IncludeSubscriptions   bool    `json:"include_subscriptions"`
	EligibilityDays        int     `json:"eligibility_days"`
	RenewOnRecharge        bool    `json:"renew_on_recharge"`
	DailyAttempts          int     `json:"daily_attempts"`
	Timezone               string  `json:"timezone" gorm:"type:varchar(64)"`
	StartsAt               int64   `json:"starts_at"`
	EndsAt                 int64   `json:"ends_at"`
	AllowedGroups          string  `json:"allowed_groups" gorm:"type:text"` // Comma separated; empty means all.
	DailyBudgetQuota       int     `json:"daily_budget_quota"`
	TotalBudgetQuota       int     `json:"total_budget_quota"`
	UserCapQuota           int     `json:"user_cap_quota"`
	FollowRegistrationRisk bool    `json:"follow_registration_risk"`
	RequireTurnstile       bool    `json:"require_turnstile"`
	ShowWinners            bool    `json:"show_winners"`
	PrizeJSON              string  `json:"-" gorm:"type:text"`
	Prizes                 []Prize `json:"prizes" gorm:"-"`
}

func (Settings) TableName() string { return "extension_lucky_draw_settings" }

type Account struct {
	UserID      int    `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	State       string `json:"state" gorm:"type:varchar(16)"`
	Reason      string `json:"reason" gorm:"type:varchar(500)"`
	UpdatedBy   int    `json:"updated_by"`
	UpdatedAt   int64  `json:"updated_at"`
	Attempts    int    `json:"attempts"`
	NextResetAt int64  `json:"next_reset_at"`
	TotalDraws  int64  `json:"total_draws"`
	TotalQuota  int    `json:"total_quota"`
}

func (Account) TableName() string { return "extension_lucky_draw_accounts" }

type Pool struct {
	ID          int   `json:"-" gorm:"primaryKey;autoIncrement:false"`
	NextResetAt int64 `json:"next_reset_at"`
	DailyQuota  int   `json:"daily_quota"`
	TotalQuota  int   `json:"total_quota"`
	TotalDraws  int64 `json:"total_draws"`
}

func (Pool) TableName() string { return "extension_lucky_draw_pool" }

type Stock struct {
	PrizeID string `json:"prize_id" gorm:"type:varchar(40);primaryKey"`
	Awarded int64  `json:"awarded"`
}

func (Stock) TableName() string { return "extension_lucky_draw_stock" }

type Record struct {
	ID              int    `json:"id" gorm:"primaryKey"`
	UserID          int    `json:"user_id" gorm:"not null;uniqueIndex:idx_lucky_request;index"`
	RequestKey      string `json:"request_key" gorm:"type:varchar(64);not null;uniqueIndex:idx_lucky_request"`
	PrizeID         string `json:"prize_id" gorm:"type:varchar(40)"`
	PrizeName       string `json:"prize_name" gorm:"type:varchar(100)"`
	QuotaAwarded    int    `json:"quota_awarded"`
	CreatedAt       int64  `json:"created_at" gorm:"index"`
	SettingsVersion int    `json:"settings_version"`
	Snapshot        string `json:"-" gorm:"type:text"`
}

func (Record) TableName() string { return "extension_lucky_draw_records" }

type Audit struct {
	ID        int    `json:"id" gorm:"primaryKey"`
	ActorID   int    `json:"actor_id"`
	UserID    int    `json:"user_id" gorm:"index"`
	Action    string `json:"action" gorm:"type:varchar(32)"`
	Detail    string `json:"detail" gorm:"type:text"`
	CreatedAt int64  `json:"created_at"`
}

func (Audit) TableName() string { return "extension_lucky_draw_audits" }

type HostUser struct {
	ID        int
	Status    int
	Quota     int
	Group     string
	DeletedAt gorm.DeletedAt
}

func (HostUser) TableName() string { return "users" }

type Result struct {
	Record Record  `json:"record"`
	Prizes []Prize `json:"prizes"`
	Replay bool    `json:"replay"`
}

type DashboardData struct {
	Rules                Settings `json:"rules"`
	Account              Account  `json:"account"`
	QualifiedAmount      string   `json:"qualified_amount"`
	RemainingAmount      string   `json:"remaining_amount"`
	ExpiresAt            int64    `json:"expires_at"`
	RemainingAttempts    int      `json:"remaining_attempts"`
	Reason               string   `json:"reason"`
	Drawable             bool     `json:"drawable"`
	VerificationRequired bool     `json:"verification_required"`
}
