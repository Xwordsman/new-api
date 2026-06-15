package model

import (
	"errors"
)

type CustomNavItem struct {
	Id          int    `gorm:"primaryKey;autoIncrement" json:"id"`
	Name        string `gorm:"type:varchar(100);not null" json:"name"`        // 导航项显示名称
	Url         string `gorm:"type:varchar(500);not null" json:"url"`         // 链接地址
	Enabled     bool   `gorm:"type:boolean;default:true" json:"enabled"`      // 是否启用
	Sort        int    `gorm:"type:int;default:0" json:"sort"`                // 排序（数字越小越靠前）
	OpenNewTab  bool   `gorm:"type:boolean;default:true" json:"open_new_tab"` // 是否在新标签页打开
	CreatedTime int64  `gorm:"bigint;index" json:"created_time"`
}

func GetAllCustomNavItems(onlyEnabled bool) ([]*CustomNavItem, error) {
	var items []*CustomNavItem
	db := DB
	if onlyEnabled {
		db = db.Where("enabled = ?", true)
	}
	err := db.Order("sort ASC, id ASC").Find(&items).Error
	return items, err
}

func GetCustomNavItemById(id int) (*CustomNavItem, error) {
	if id == 0 {
		return nil, errors.New("id is required")
	}
	item := CustomNavItem{Id: id}
	err := DB.First(&item, "id = ?", id).Error
	return &item, err
}

func CreateCustomNavItem(item *CustomNavItem) error {
	if item.Name == "" || item.Url == "" {
		return errors.New("name and url are required")
	}
	return DB.Create(item).Error
}

func UpdateCustomNavItem(item *CustomNavItem) error {
	if item.Id == 0 {
		return errors.New("id is required")
	}
	if item.Name == "" || item.Url == "" {
		return errors.New("name and url are required")
	}
	return DB.Model(&CustomNavItem{}).Where("id = ?", item.Id).Updates(item).Error
}

func DeleteCustomNavItem(id int) error {
	if id == 0 {
		return errors.New("id is required")
	}
	return DB.Delete(&CustomNavItem{}, "id = ?", id).Error
}

func UpdateCustomNavItemSort(id int, sort int) error {
	if id == 0 {
		return errors.New("id is required")
	}
	return DB.Model(&CustomNavItem{}).Where("id = ?", id).Update("sort", sort).Error
}

func ToggleCustomNavItem(id int, enabled bool) error {
	if id == 0 {
		return errors.New("id is required")
	}
	return DB.Model(&CustomNavItem{}).Where("id = ?", id).Update("enabled", enabled).Error
}
