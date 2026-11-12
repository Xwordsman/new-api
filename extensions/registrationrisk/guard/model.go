package guard

// Counters and challenges live in the primary DB, shared by every gateway node.
// No credentials, codes, raw IPs or usable authentication tokens enter audit rows.
type Counter struct {
	Key       string `gorm:"primaryKey;size:128"`
	Count     int64
	ExpiresAt int64 `gorm:"index"`
}

func (Counter) TableName() string { return "extension_registration_counters" }

type Challenge struct {
	EmailHash      string `gorm:"primaryKey;size:64"`
	CodeHash       string `gorm:"size:64"`
	ExpiresAt      int64
	ResendAt       int64
	Failures       int
	FailureResetAt int64
	Version        int64
}

func (Challenge) TableName() string { return "extension_registration_challenges" }

type Event struct {
	ID          int    `gorm:"primaryKey" json:"id"`
	CreatedAt   int64  `gorm:"index" json:"created_at"`
	Stage       string `gorm:"size:24;index" json:"stage"`
	Source      string `gorm:"size:50" json:"source"`
	Action      string `gorm:"size:16;index" json:"action"`
	Enforced    bool   `json:"enforced"`
	Reasons     string `gorm:"type:text" json:"reasons"`
	UserID      int    `gorm:"index" json:"user_id"`
	InviterID   int    `gorm:"index" json:"inviter_id"`
	EmailHash   string `gorm:"size:64" json:"email_hash"`
	Domain      string `gorm:"size:253" json:"domain"`
	IPHash      string `gorm:"size:64" json:"ip_hash"`
	NetworkHash string `gorm:"size:64;index" json:"network_hash"`
	DeviceHash  string `gorm:"size:64;index" json:"device_hash"`
	Revision    int64  `json:"revision"`
}

func (Event) TableName() string { return "extension_registration_events" }

type Account struct {
	UserID      int    `gorm:"primaryKey;autoIncrement:false" json:"user_id"`
	EventID     int    `json:"event_id"`
	CreatedAt   int64  `json:"created_at"`
	DeviceHash  string `gorm:"size:64;index" json:"device_hash"`
	NetworkHash string `gorm:"size:64;index" json:"network_hash"`
	EmailHash   string `gorm:"size:64" json:"email_hash"`
	InviterID   int    `gorm:"index" json:"inviter_id"`
	State       string `gorm:"size:16" json:"state"`
}

func (Account) TableName() string { return "extension_registration_accounts" }

type Grant struct {
	UserID    int    `gorm:"primaryKey;autoIncrement:false" json:"user_id"`
	Total     int    `json:"total"`
	Remaining int    `json:"remaining"`
	CreatedAt int64  `json:"created_at"`
	ExpiresAt int64  `gorm:"index" json:"expires_at"`
	State     string `gorm:"size:16;index" json:"state"`
	Reason    string `gorm:"size:500" json:"reason"`
	Version   int64  `json:"-"`
}

func (Grant) TableName() string { return "extension_registration_grants" }

type Reservation struct {
	RequestID  string `gorm:"primaryKey;size:64"`
	UserID     int    `gorm:"index"`
	Trial      int
	Wallet     int
	State      string `gorm:"size:16"`
	CreatedAt  int64
	LeaseUntil int64 `gorm:"index"`
	Version    int64
}

func (Reservation) TableName() string { return "extension_registration_reservations" }

type Alert struct {
	ID            int            `gorm:"primaryKey" json:"id"`
	CreatedAt     int64          `gorm:"index" json:"created_at"`
	Kind          string         `gorm:"size:50" json:"kind"`
	Summary       string         `gorm:"type:text" json:"summary"`
	SummaryKey    string         `gorm:"type:text" json:"summary_key"`
	SummaryParams map[string]any `gorm:"serializer:json;type:text" json:"summary_params"`
	DeliveredAt   int64          `json:"delivered_at"`
	Attempts      int            `json:"attempts"`
	NextAttemptAt int64          `json:"next_attempt_at"`
	LeaseUntil    int64          `json:"-"`
	EmailDone     bool           `json:"-"`
	WebhookDone   bool           `json:"-"`
	LastError     string         `gorm:"size:200" json:"last_error"`
}

func (Alert) TableName() string { return "extension_registration_alerts" }

type Audit struct {
	ID        int    `gorm:"primaryKey" json:"id"`
	CreatedAt int64  `gorm:"index" json:"created_at"`
	ActorID   int    `json:"actor_id"`
	UserID    int    `gorm:"index" json:"user_id"`
	Action    string `gorm:"size:32" json:"action"`
	Reason    string `gorm:"size:500" json:"reason"`
}

func (Audit) TableName() string { return "extension_registration_audits" }

// Only authenticated payment callbacks may write these provider identities.
type Payer struct {
	Digest string `gorm:"primaryKey;size:64"`
	UserID int    `gorm:"primaryKey;autoIncrement:false"`
}

func (Payer) TableName() string { return "extension_registration_payers" }
