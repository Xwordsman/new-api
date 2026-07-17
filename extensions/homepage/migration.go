package homepage

import (
	"errors"

	"gorm.io/gorm"
)

func Migrate(db *gorm.DB) error {
	if err := db.AutoMigrate(&Settings{}); err != nil {
		return err
	}

	var settings Settings
	err := db.Where("id = ?", settingsID).First(&settings).Error
	if err == nil {
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	settings = DefaultSettings()
	return db.Create(&settings).Error
}
