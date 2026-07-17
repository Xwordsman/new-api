package invitation

import (
	"errors"

	"gorm.io/gorm"
)

func Migrate(db *gorm.DB) error {
	if err := db.AutoMigrate(&Settings{}, &Code{}); err != nil {
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

	return db.Create(&Settings{ID: settingsID, Enabled: false}).Error
}
