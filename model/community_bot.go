package model

import (
	"errors"
	"math"
	"math/rand"

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

type CommunityLotteryDraw struct {
	Id             int    `json:"id" gorm:"primaryKey"`
	UserId         int    `json:"user_id" gorm:"not null;uniqueIndex:idx_community_lottery_once"`
	ProviderId     int    `json:"provider_id" gorm:"not null"`
	ProviderUserId string `json:"provider_user_id" gorm:"type:varchar(256);not null"`
	RoomId         string `json:"room_id" gorm:"type:varchar(128);not null;uniqueIndex:idx_community_lottery_once"`
	MessageId      string `json:"message_id" gorm:"type:varchar(256);not null"`
	DrawDate       string `json:"draw_date" gorm:"type:varchar(10);not null;uniqueIndex:idx_community_lottery_once"`
	SessionKey     string `json:"session_key" gorm:"type:varchar(128);not null;uniqueIndex:idx_community_lottery_once"`
	SessionName    string `json:"session_name" gorm:"type:varchar(128);not null"`
	SessionStart   string `json:"session_start" gorm:"type:varchar(5);not null"`
	SessionEnd     string `json:"session_end" gorm:"type:varchar(5);not null"`
	PrizeName      string `json:"prize_name" gorm:"type:varchar(128);not null"`
	AmountCents    int    `json:"amount_cents" gorm:"not null;default:0"`
	QuotaAwarded   int    `json:"quota_awarded" gorm:"not null;default:0"`
	CreatedAt      int64  `json:"created_at" gorm:"bigint;not null"`
}

const (
	CommunityRedPacketStatusOpen    = "open"
	CommunityRedPacketStatusClosed  = "closed"
	CommunityRedPacketStatusExpired = "expired"
)

type CommunityRedPacket struct {
	Id                    int    `json:"id" gorm:"primaryKey"`
	RoomId                string `json:"room_id" gorm:"type:varchar(128);not null;index:idx_community_red_packet_status"`
	CreatorProviderUserId string `json:"creator_provider_user_id" gorm:"type:varchar(256);not null"`
	CreatorUserId         int    `json:"creator_user_id" gorm:"not null;default:0"`
	TotalAmountCents      int    `json:"total_amount_cents" gorm:"not null"`
	RemainingAmountCents  int    `json:"remaining_amount_cents" gorm:"not null"`
	TotalCount            int    `json:"total_count" gorm:"not null"`
	RemainingCount        int    `json:"remaining_count" gorm:"not null"`
	SplitMode             string `json:"split_mode" gorm:"type:varchar(16);not null"`
	Status                string `json:"status" gorm:"type:varchar(16);not null;index:idx_community_red_packet_status"`
	ExpiresAt             int64  `json:"expires_at" gorm:"bigint;not null;default:0"`
	SourceMessageId       string `json:"source_message_id" gorm:"type:varchar(256);not null"`
	LastRemindedAt        int64  `json:"last_reminded_at" gorm:"bigint;not null;default:0"`
	CreatedAt             int64  `json:"created_at" gorm:"bigint;not null"`
	UpdatedAt             int64  `json:"updated_at" gorm:"bigint;not null"`
}

type CommunityRedPacketClaim struct {
	Id              int    `json:"id" gorm:"primaryKey"`
	PacketId        int    `json:"packet_id" gorm:"not null;uniqueIndex:idx_community_red_packet_claim_once"`
	UserId          int    `json:"user_id" gorm:"not null"`
	ProviderUserId  string `json:"provider_user_id" gorm:"type:varchar(256);not null;uniqueIndex:idx_community_red_packet_claim_once"`
	AmountCents     int    `json:"amount_cents" gorm:"not null"`
	QuotaAwarded    int    `json:"quota_awarded" gorm:"not null"`
	SourceMessageId string `json:"source_message_id" gorm:"type:varchar(256);not null"`
	CreatedAt       int64  `json:"created_at" gorm:"bigint;not null"`
}

type CommunityLotteryPrizeCandidate struct {
	Name           string
	Weight         int
	MinAmountCents int
	MaxAmountCents int
}

type CommunityLotteryReminder struct {
	Id             int    `json:"id" gorm:"primaryKey"`
	RoomId         string `json:"room_id" gorm:"type:varchar(128);not null;uniqueIndex:idx_community_lottery_reminder"`
	SessionKey     string `json:"session_key" gorm:"type:varchar(128);not null;uniqueIndex:idx_community_lottery_reminder"`
	LastRemindedAt int64  `json:"last_reminded_at" gorm:"bigint;not null"`
	UpdatedAt      int64  `json:"updated_at" gorm:"bigint;not null"`
}

type CommunityLotteryDrawParams struct {
	UserId         int
	ProviderId     int
	ProviderUserId string
	RoomId         string
	MessageId      string
	DrawDate       string
	SessionKey     string
	SessionName    string
	SessionStart   string
	SessionEnd     string
	BudgetCents    int
	Prizes         []CommunityLotteryPrizeCandidate
}

type CommunityLotteryDrawResult struct {
	Draw           *CommunityLotteryDraw
	AlreadyDrawn   bool
	PoolEmpty      bool
	RemainingCents int
}

func (CommunityBotCursor) TableName() string {
	return "community_bot_cursors"
}

func (CommunityTokenApproval) TableName() string {
	return "community_token_approvals"
}

func (CommunityLotteryDraw) TableName() string {
	return "community_lottery_draws"
}

func (CommunityRedPacket) TableName() string {
	return "community_red_packets"
}

func (CommunityRedPacketClaim) TableName() string {
	return "community_red_packet_claims"
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

func CreateCommunityLotteryDraw(params CommunityLotteryDrawParams) (*CommunityLotteryDrawResult, error) {
	result := &CommunityLotteryDrawResult{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&CommunityLotteryDraw{}).
			Where("user_id = ? AND room_id = ? AND session_key = ? AND draw_date = ?", params.UserId, params.RoomId, params.SessionKey, params.DrawDate).
			Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			result.AlreadyDrawn = true
			return nil
		}

		var usedCents int64
		if err := tx.Model(&CommunityLotteryDraw{}).
			Where("room_id = ? AND session_key = ? AND draw_date = ?", params.RoomId, params.SessionKey, params.DrawDate).
			Select("COALESCE(SUM(amount_cents), 0)").
			Scan(&usedCents).Error; err != nil {
			return err
		}
		remainingCents := params.BudgetCents - int(usedCents)
		if remainingCents < 0 {
			remainingCents = 0
		}
		result.RemainingCents = remainingCents

		availablePrizes := make([]CommunityLotteryPrizeCandidate, 0, len(params.Prizes))
		for _, prize := range params.Prizes {
			if prize.Weight > 0 && prize.MinAmountCents <= remainingCents {
				availablePrizes = append(availablePrizes, prize)
			}
		}
		if len(availablePrizes) == 0 {
			result.PoolEmpty = true
			return nil
		}

		selected := selectCommunityLotteryPrize(availablePrizes)
		amountCents := selectCommunityLotteryAmount(selected, remainingCents)
		quotaAwarded := int(math.Round(float64(amountCents) / 100 * common.QuotaPerUnit))
		draw := &CommunityLotteryDraw{
			UserId:         params.UserId,
			ProviderId:     params.ProviderId,
			ProviderUserId: params.ProviderUserId,
			RoomId:         params.RoomId,
			MessageId:      params.MessageId,
			DrawDate:       params.DrawDate,
			SessionKey:     params.SessionKey,
			SessionName:    params.SessionName,
			SessionStart:   params.SessionStart,
			SessionEnd:     params.SessionEnd,
			PrizeName:      selected.Name,
			AmountCents:    amountCents,
			QuotaAwarded:   quotaAwarded,
			CreatedAt:      common.GetTimestamp(),
		}
		if err := tx.Create(draw).Error; err != nil {
			if errors.Is(err, gorm.ErrDuplicatedKey) {
				result.AlreadyDrawn = true
				return nil
			}
			return err
		}
		if quotaAwarded > 0 {
			if common.UsingSQLite {
				if err := IncreaseUserQuota(params.UserId, quotaAwarded, true); err != nil {
					return err
				}
			} else {
				if err := tx.Model(&User{}).Where("id = ?", params.UserId).
					Update("quota", gorm.Expr("quota + ?", quotaAwarded)).Error; err != nil {
					return err
				}
			}
		}
		result.Draw = draw
		result.RemainingCents = remainingCents - amountCents
		if result.RemainingCents < 0 {
			result.RemainingCents = 0
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if result.Draw != nil && result.Draw.QuotaAwarded > 0 && !common.UsingSQLite {
		go func() {
			_ = cacheIncrUserQuota(params.UserId, int64(result.Draw.QuotaAwarded))
		}()
	}
	return result, nil
}

func selectCommunityLotteryPrize(prizes []CommunityLotteryPrizeCandidate) CommunityLotteryPrizeCandidate {
	totalWeight := 0
	for _, prize := range prizes {
		totalWeight += prize.Weight
	}
	if totalWeight <= 0 {
		return prizes[0]
	}
	roll := rand.Intn(totalWeight)
	for _, prize := range prizes {
		if roll < prize.Weight {
			return prize
		}
		roll -= prize.Weight
	}
	return prizes[len(prizes)-1]
}

func selectCommunityLotteryAmount(prize CommunityLotteryPrizeCandidate, remainingCents int) int {
	min := prize.MinAmountCents
	max := prize.MaxAmountCents
	if max > remainingCents {
		max = remainingCents
	}
	if min > max {
		min = max
	}
	if min < 0 {
		min = 0
	}
	if max <= 0 {
		return 0
	}
	if max == min {
		return min
	}
	return min + rand.Intn(max-min+1)
}

func GetCommunityLotteryReminder(roomId, sessionKey string) (*CommunityLotteryReminder, error) {
	var reminder CommunityLotteryReminder
	err := DB.Where("room_id = ? AND session_key = ?", roomId, sessionKey).First(&reminder).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &reminder, nil
}

func UpsertCommunityLotteryReminder(roomId, sessionKey string, ts int64) error {
	var reminder CommunityLotteryReminder
	err := DB.Where("room_id = ? AND session_key = ?", roomId, sessionKey).First(&reminder).Error
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		reminder = CommunityLotteryReminder{
			RoomId:         roomId,
			SessionKey:     sessionKey,
			LastRemindedAt: ts,
			UpdatedAt:      ts,
		}
		return DB.Create(&reminder).Error
	}
	return DB.Model(&reminder).Updates(map[string]interface{}{
		"last_reminded_at": ts,
		"updated_at":       ts,
	}).Error
}

func SumCommunityLotterySessionAmountCents(roomId, sessionKey, drawDate string) (int, error) {
	var total int64
	err := DB.Model(&CommunityLotteryDraw{}).
		Where("room_id = ? AND session_key = ? AND draw_date = ?", roomId, sessionKey, drawDate).
		Select("COALESCE(SUM(amount_cents), 0)").
		Scan(&total).Error
	return int(total), err
}

func GetCommunityRedPacketsForReminder(roomId string, intervalSeconds int64) ([]CommunityRedPacket, error) {
	now := common.GetTimestamp()
	var packets []CommunityRedPacket
	err := DB.Where("room_id = ? AND status = ? AND remaining_count > 0", roomId, CommunityRedPacketStatusOpen).
		Where("(expires_at = 0 OR expires_at > ?)", now).
		Where("(? - last_reminded_at) >= ?", now, intervalSeconds).
		Find(&packets).Error
	return packets, err
}

func UpdateCommunityRedPacketReminder(packetId int, ts int64) error {
	return DB.Model(&CommunityRedPacket{}).Where("id = ?", packetId).
		Updates(map[string]interface{}{
			"last_reminded_at": ts,
			"updated_at":       ts,
		}).Error
}

type CreateCommunityRedPacketParams struct {
	RoomId                string
	CreatorProviderUserId string
	CreatorUserId         int
	TotalAmountCents      int
	TotalCount            int
	SplitMode             string
	ExpireMinutes         int
	SourceMessageId       string
	ConcurrencyMode       string
}

type CreateCommunityRedPacketResult struct {
	Packet     *CommunityRedPacket
	Conflict   bool
	ConflictId int
}

func CreateCommunityRedPacket(params CreateCommunityRedPacketParams) (*CreateCommunityRedPacketResult, error) {
	if params.TotalCount <= 0 {
		return nil, errors.New("total count must be > 0")
	}
	if params.TotalAmountCents <= 0 {
		return nil, errors.New("total amount must be > 0")
	}
	now := common.GetTimestamp()
	expiresAt := int64(0)
	if params.ExpireMinutes > 0 {
		expiresAt = now + int64(params.ExpireMinutes)*60
	}
	splitMode := params.SplitMode
	if splitMode != "random" && splitMode != "average" {
		splitMode = "random"
	}
	result := &CreateCommunityRedPacketResult{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		if params.ConcurrencyMode == "single" {
			var existing CommunityRedPacket
			err := tx.Where("room_id = ? AND status = ?", params.RoomId, CommunityRedPacketStatusOpen).
				Order("created_at ASC").
				First(&existing).Error
			if err == nil {
				if existing.ExpiresAt > 0 && existing.ExpiresAt <= now {
					if err := tx.Model(&existing).Updates(map[string]interface{}{
						"status":     CommunityRedPacketStatusExpired,
						"updated_at": now,
					}).Error; err != nil {
						return err
					}
				} else {
					result.Conflict = true
					result.ConflictId = existing.Id
					return nil
				}
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}
		packet := &CommunityRedPacket{
			RoomId:                params.RoomId,
			CreatorProviderUserId: params.CreatorProviderUserId,
			CreatorUserId:         params.CreatorUserId,
			TotalAmountCents:      params.TotalAmountCents,
			RemainingAmountCents:  params.TotalAmountCents,
			TotalCount:            params.TotalCount,
			RemainingCount:        params.TotalCount,
			SplitMode:             splitMode,
			Status:                CommunityRedPacketStatusOpen,
			ExpiresAt:             expiresAt,
			SourceMessageId:       params.SourceMessageId,
			LastRemindedAt:        now,
			CreatedAt:             now,
			UpdatedAt:             now,
		}
		if err := tx.Create(packet).Error; err != nil {
			return err
		}
		result.Packet = packet
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

type ClaimCommunityRedPacketParams struct {
	RoomId          string
	UserId          int
	ProviderUserId  string
	SourceMessageId string
}

type ClaimCommunityRedPacketResult struct {
	Packet         *CommunityRedPacket
	Claim          *CommunityRedPacketClaim
	NoPacket       bool
	AlreadyClaimed bool
	Expired        bool
}

func ClaimCommunityRedPacket(params ClaimCommunityRedPacketParams) (*ClaimCommunityRedPacketResult, error) {
	now := common.GetTimestamp()
	result := &ClaimCommunityRedPacketResult{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var packet CommunityRedPacket
		query := tx.Where("room_id = ? AND status = ?", params.RoomId, CommunityRedPacketStatusOpen).
			Order("created_at ASC")
		if !common.UsingSQLite {
			query = query.Clauses()
		}
		if err := query.First(&packet).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				result.NoPacket = true
				return nil
			}
			return err
		}
		if packet.ExpiresAt > 0 && packet.ExpiresAt <= now {
			if err := tx.Model(&packet).Updates(map[string]interface{}{
				"status":     CommunityRedPacketStatusExpired,
				"updated_at": now,
			}).Error; err != nil {
				return err
			}
			result.Expired = true
			result.Packet = &packet
			return nil
		}
		if packet.RemainingCount <= 0 || packet.RemainingAmountCents <= 0 {
			if err := tx.Model(&packet).Updates(map[string]interface{}{
				"status":     CommunityRedPacketStatusClosed,
				"updated_at": now,
			}).Error; err != nil {
				return err
			}
			result.NoPacket = true
			return nil
		}
		var existingClaim CommunityRedPacketClaim
		err := tx.Where("packet_id = ? AND provider_user_id = ?", packet.Id, params.ProviderUserId).
			First(&existingClaim).Error
		if err == nil {
			result.AlreadyClaimed = true
			result.Packet = &packet
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		amountCents := splitCommunityRedPacketAmount(&packet)
		if amountCents <= 0 {
			result.NoPacket = true
			return nil
		}
		quotaAwarded := int(float64(amountCents) / 100 * common.QuotaPerUnit)
		claim := &CommunityRedPacketClaim{
			PacketId:        packet.Id,
			UserId:          params.UserId,
			ProviderUserId:  params.ProviderUserId,
			AmountCents:     amountCents,
			QuotaAwarded:    quotaAwarded,
			SourceMessageId: params.SourceMessageId,
			CreatedAt:       now,
		}
		if err := tx.Create(claim).Error; err != nil {
			if errors.Is(err, gorm.ErrDuplicatedKey) {
				result.AlreadyClaimed = true
				result.Packet = &packet
				return nil
			}
			return err
		}
		newRemainingAmountCents := packet.RemainingAmountCents - amountCents
		newRemainingCount := packet.RemainingCount - 1
		newStatus := packet.Status
		if newRemainingCount <= 0 || newRemainingAmountCents <= 0 {
			newStatus = CommunityRedPacketStatusClosed
		}
		updates := map[string]interface{}{
			"remaining_amount_cents": newRemainingAmountCents,
			"remaining_count":        newRemainingCount,
			"updated_at":             now,
		}
		if newStatus != packet.Status {
			updates["status"] = newStatus
		}
		if err := tx.Model(&packet).Updates(updates).Error; err != nil {
			return err
		}
		packet.RemainingAmountCents = newRemainingAmountCents
		packet.RemainingCount = newRemainingCount
		packet.Status = newStatus
		packet.UpdatedAt = now
		if quotaAwarded > 0 {
			if common.UsingSQLite {
				if err := IncreaseUserQuota(params.UserId, quotaAwarded, true); err != nil {
					return err
				}
			} else {
				if err := tx.Model(&User{}).Where("id = ?", params.UserId).
					Update("quota", gorm.Expr("quota + ?", quotaAwarded)).Error; err != nil {
					return err
				}
			}
		}
		result.Packet = &packet
		result.Claim = claim
		return nil
	})
	if err != nil {
		return nil, err
	}
	if result.Claim != nil && result.Claim.QuotaAwarded > 0 && !common.UsingSQLite {
		go func() {
			_ = cacheIncrUserQuota(params.UserId, int64(result.Claim.QuotaAwarded))
		}()
	}
	return result, nil
}

func splitCommunityRedPacketAmount(packet *CommunityRedPacket) int {
	if packet.RemainingCount <= 1 {
		return packet.RemainingAmountCents
	}
	if packet.SplitMode == "average" {
		base := packet.RemainingAmountCents / packet.RemainingCount
		if base < 1 {
			base = packet.RemainingAmountCents
		}
		return base
	}
	max := packet.RemainingAmountCents / packet.RemainingCount * 2
	if max <= 1 {
		max = packet.RemainingAmountCents
	}
	if max <= 1 {
		return packet.RemainingAmountCents
	}
	amount := rand.Intn(max-1) + 1
	if amount > packet.RemainingAmountCents-(packet.RemainingCount-1) {
		amount = packet.RemainingAmountCents - (packet.RemainingCount - 1)
	}
	if amount < 1 {
		amount = 1
	}
	return amount
}

func ExpireCommunityRedPackets(roomId string) ([]CommunityRedPacket, error) {
	now := common.GetTimestamp()
	var packets []CommunityRedPacket
	if err := DB.Where("room_id = ? AND status = ? AND expires_at > 0 AND expires_at <= ?",
		roomId, CommunityRedPacketStatusOpen, now).
		Find(&packets).Error; err != nil {
		return nil, err
	}
	if len(packets) == 0 {
		return nil, nil
	}
	ids := make([]int, 0, len(packets))
	for _, packet := range packets {
		ids = append(ids, packet.Id)
	}
	if err := DB.Model(&CommunityRedPacket{}).Where("id IN ?", ids).
		Updates(map[string]interface{}{
			"status":     CommunityRedPacketStatusExpired,
			"updated_at": now,
		}).Error; err != nil {
		return nil, err
	}
	for i := range packets {
		packets[i].Status = CommunityRedPacketStatusExpired
		packets[i].UpdatedAt = now
	}
	return packets, nil
}
