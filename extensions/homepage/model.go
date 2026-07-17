package homepage

import "time"

const (
	settingsID   = 1
	ModeShowcase = "showcase"
	ModeNotFound = "not_found"
)

type Settings struct {
	ID          int       `json:"-" gorm:"primaryKey;autoIncrement:false"`
	Enabled     bool      `json:"enabled"`
	Mode        string    `json:"mode" gorm:"type:varchar(20);not null"`
	Title       string    `json:"title" gorm:"type:varchar(120)"`
	Description string    `json:"description" gorm:"type:varchar(500)"`
	ButtonText  string    `json:"button_text" gorm:"type:varchar(50)"`
	ButtonURL   string    `json:"button_url" gorm:"type:varchar(2048)"`
	CreatedAt   time.Time `json:"-"`
	UpdatedAt   time.Time `json:"-"`
}

func (Settings) TableName() string {
	return "extension_homepage_settings"
}

func DefaultSettings() Settings {
	return Settings{
		ID:      settingsID,
		Enabled: false,
		Mode:    ModeShowcase,
	}
}
