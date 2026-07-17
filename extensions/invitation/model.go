package invitation

import "time"

const (
	settingsID        = 1
	CodeStatusDisabled = 0
	CodeStatusEnabled  = 1
)

type Settings struct {
	ID        int       `json:"id" gorm:"primaryKey;autoIncrement:false"`
	Enabled   bool      `json:"enabled"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (Settings) TableName() string {
	return "extension_invitation_settings"
}

type Code struct {
	ID        int        `json:"id" gorm:"primaryKey"`
	Code      string     `json:"code" gorm:"type:varchar(64);uniqueIndex;not null"`
	Name      string     `json:"name" gorm:"type:varchar(100)"`
	Status    int        `json:"status" gorm:"index"`
	MaxUses   int        `json:"max_uses"`
	UsedCount int        `json:"used_count"`
	ExpiresAt *time.Time `json:"expires_at" gorm:"index"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

func (Code) TableName() string {
	return "extension_invitation_codes"
}
