package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

type CommunityBotCursor struct {
	Id              int    `json:"id" gorm:"primaryKey"`
	RoomId          string `json:"room_id" gorm:"type:varchar(128);not null;uniqueIndex:idx_community_bot_room"`
	LastMessageId   string `json:"last_message_id" gorm:"type:varchar(256);not null;default:''"`
	LastMessageTime int64  `json:"last_message_time" gorm:"bigint;not null;default:0"`
	UpdatedAt       int64  `json:"updated_at" gorm:"bigint;not null"`
}

type CommunityTokenApproval struct {
	Id              int    `json:"id" gorm:"primaryKey"`
	UserId          int    `json:"user_id" gorm:"not null;uniqueIndex"`
	ProviderId      int    `json:"provider_id" gorm:"not null"`
	ProviderUserId  string `json:"provider_user_id" gorm:"type:varchar(256);not null"`
	SourceRoomId    string `json:"source_room_id" gorm:"type:varchar(128);not null"`
	SourceMessageId string `json:"source_message_id" gorm:"type:varchar(256);not null"`
	ApprovedAt      int64  `json:"approved_at" gorm:"bigint;not null"`
	UpdatedAt       int64  `json:"updated_at" gorm:"bigint;not null"`
}

func (CommunityBotCursor) TableName() string {
	return "community_bot_cursors"
}

func (CommunityTokenApproval) TableName() string {
	return "community_token_approvals"
}

func GetCommunityBotCursor(roomId string) (*CommunityBotCursor, error) {
	var cursor CommunityBotCursor
	err := DB.Where("room_id = ?", roomId).First(&cursor).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return &CommunityBotCursor{RoomId: roomId}, nil
		}
		return nil, err
	}
	return &cursor, nil
}

func UpsertCommunityBotCursor(roomId, messageId string, messageTime int64) error {
	now := common.GetTimestamp()
	var cursor CommunityBotCursor
	err := DB.Where("room_id = ?", roomId).First(&cursor).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		cursor = CommunityBotCursor{
			RoomId:          roomId,
			LastMessageId:   messageId,
			LastMessageTime: messageTime,
			UpdatedAt:       now,
		}
		return DB.Create(&cursor).Error
	}
	return DB.Model(&cursor).Updates(map[string]interface{}{
		"last_message_id":   messageId,
		"last_message_time": messageTime,
		"updated_at":        now,
	}).Error
}

func HasCommunityTokenApproval(userId int) (bool, error) {
	var count int64
	err := DB.Model(&CommunityTokenApproval{}).Where("user_id = ?", userId).Count(&count).Error
	return count > 0, err
}

func GrantCommunityTokenApproval(userId, providerId int, providerUserId, roomId, messageId string) (bool, error) {
	now := common.GetTimestamp()
	var approval CommunityTokenApproval
	err := DB.Where("user_id = ?", userId).First(&approval).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return false, err
		}
		approval = CommunityTokenApproval{
			UserId:          userId,
			ProviderId:      providerId,
			ProviderUserId:  providerUserId,
			SourceRoomId:    roomId,
			SourceMessageId: messageId,
			ApprovedAt:      now,
			UpdatedAt:       now,
		}
		return true, DB.Create(&approval).Error
	}
	return false, DB.Model(&approval).Updates(map[string]interface{}{
		"provider_id":       providerId,
		"provider_user_id":  providerUserId,
		"source_room_id":    roomId,
		"source_message_id": messageId,
		"updated_at":        now,
	}).Error
}
