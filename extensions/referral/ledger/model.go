// Package ledger owns referral accounting independently of the gateway models.
package ledger

import "gorm.io/gorm"

type Settings struct {
	ID           int    `json:"-" gorm:"primaryKey;autoIncrement:false"`
	Enabled      bool   `json:"enabled"`
	RateBPS      int    `json:"rate_bps"`
	WindowDays   int    `json:"window_days"`
	CoolingHours int    `json:"cooling_hours"`
	CapQuota     int    `json:"cap_quota"`
	CNYPerUSD    string `json:"cny_per_usd" gorm:"type:varchar(32)"`
	Version      int    `json:"version"`
	StartedAt    int64  `json:"started_at"`
	RiskSalt     string `json:"-" gorm:"type:varchar(64)"`
}

func (Settings) TableName() string { return "extension_referral_settings" }

type Account struct {
	UserID      int `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	Balance     int `json:"balance"`
	Debt        int `json:"debt"`
	Earned      int `json:"earned"`
	Transferred int `json:"transferred"`
}

func (Account) TableName() string { return "extension_referral_accounts" }

type Binding struct {
	ID              int    `json:"id" gorm:"primaryKey"`
	UserID          int    `json:"user_id" gorm:"uniqueIndex"`
	InviterID       int    `json:"inviter_id" gorm:"index"`
	RegisteredAt    int64  `json:"registered_at"`
	ExpiresAt       int64  `json:"expires_at"`
	RateBPS         int    `json:"rate_bps"`
	CapQuota        int    `json:"cap_quota"`
	CoolingHours    int    `json:"cooling_hours"`
	SettingsVersion int    `json:"settings_version"`
	State           string `json:"state" gorm:"type:varchar(24);index"`
	Reason          string `json:"reason" gorm:"type:varchar(100)"`
	Reserved        int    `json:"reserved"`
	Historical      bool   `json:"historical"`
	ReviewedAt      int64  `json:"reviewed_at"`
}

func (Binding) TableName() string { return "extension_referral_bindings" }

// Signals contain keyed digests, never IP addresses, cookies or credentials.
type Signal struct {
	UserID  int    `gorm:"primaryKey;autoIncrement:false"`
	Network string `gorm:"type:varchar(64);index"`
	Client  string `gorm:"type:varchar(64);index"`
}

func (Signal) TableName() string { return "extension_referral_signals" }

// PaymentIdentity links verified payer digests across accounts, including
// accounts that were not themselves referred. No provider identifiers are kept.
type PaymentIdentity struct {
	ID     int    `gorm:"primaryKey"`
	UserID int    `gorm:"uniqueIndex:referral_payment_identity;index"`
	Digest string `gorm:"type:varchar(64);uniqueIndex:referral_payment_identity;index"`
}

func (PaymentIdentity) TableName() string { return "extension_referral_payment_identities" }

type Reward struct {
	ID              int    `json:"id" gorm:"primaryKey"`
	TradeNo         string `json:"trade_no" gorm:"type:varchar(255);uniqueIndex"`
	Provider        string `json:"provider" gorm:"type:varchar(50)"`
	Reference       string `json:"-" gorm:"type:varchar(255);index"`
	PayerHash       string `json:"-" gorm:"type:varchar(64);index"`
	InviterID       int    `json:"inviter_id" gorm:"index"`
	UserID          int    `json:"user_id" gorm:"index"`
	PaidQuota       int    `json:"paid_quota"`
	RefundedQuota   int    `json:"refunded_quota"`
	Amount          string `json:"amount" gorm:"type:varchar(48)"`
	Currency        string `json:"currency" gorm:"type:varchar(8)"`
	ExchangeRate    string `json:"exchange_rate" gorm:"type:varchar(48)"`
	RateBPS         int    `json:"rate_bps"`
	SettingsVersion int    `json:"settings_version"`
	Quota           int    `json:"quota"`
	Reversed        int    `json:"reversed"`
	Offset          int    `json:"offset"`
	PaidAt          int64  `json:"paid_at"`
	AvailableAt     int64  `json:"available_at"`
	ClaimedAt       int64  `json:"claimed_at"`
	State           string `json:"state" gorm:"type:varchar(24);index"`
	Historical      bool   `json:"historical"`
}

func (Reward) TableName() string { return "extension_referral_rewards" }

type Transfer struct {
	ID        int    `json:"id" gorm:"primaryKey"`
	UserID    int    `json:"-" gorm:"uniqueIndex:referral_transfer_request;index"`
	RequestID string `json:"request_id" gorm:"type:varchar(64);uniqueIndex:referral_transfer_request"`
	Quota     int    `json:"quota"`
	Offset    int    `json:"offset"`
	CreatedAt int64  `json:"created_at"`
}

func (Transfer) TableName() string { return "extension_referral_transfers" }

type Audit struct {
	ID        int    `json:"id" gorm:"primaryKey"`
	ActorID   int    `json:"actor_id"`
	UserID    int    `json:"user_id" gorm:"index"`
	Action    string `json:"action" gorm:"type:varchar(40)"`
	Detail    string `json:"detail" gorm:"type:text"`
	CreatedAt int64  `json:"created_at"`
}

func (Audit) TableName() string { return "extension_referral_audits" }

// RefundNotice retains cumulative provider totals, including callbacks arriving
// before checkout completion. Smaller/out-of-order totals can never undo a refund.
type RefundNotice struct {
	ID        int    `gorm:"primaryKey"`
	Provider  string `gorm:"type:varchar(50);uniqueIndex:referral_refund_reference"`
	Reference string `gorm:"type:varchar(255);uniqueIndex:referral_refund_reference"`
	Amount    string `gorm:"type:varchar(48)"`
	Currency  string `gorm:"type:varchar(8)"`
}

func (RefundNotice) TableName() string { return "extension_referral_refunds" }

// HostUser is a read projection, not a migration model for the host users table.
type HostUser struct {
	ID        int
	Username  string
	Status    int
	InviterID int
	CreatedAt int64
	DeletedAt gorm.DeletedAt
}

func (HostUser) TableName() string { return "users" }

// Payment must originate from a verified provider callback or an audited
// administrator reconciliation. Amount is actual payment, excluding gifts.
type Payment struct {
	Amount    string
	Currency  string
	Reference string
	Payer     string
	PaidAt    int64
	// USDPerUnit is only set by audited administrator reconciliation.
	USDPerUnit string
}
