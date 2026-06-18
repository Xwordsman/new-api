package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"math/rand"
	"net/http"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/bytedance/gopkg/util/gopool"
	"gorm.io/gorm"
)

const (
	communityBotFetchLimit = 50
	communityBotTimeout    = 15 * time.Second
)

var (
	communityBotOnce    sync.Once
	communityBotRunning atomic.Bool
)

type communityMessage struct {
	ID              string
	CreatedAt       time.Time
	UserID          string
	ProviderUserIDs []string
	Text            string
}

type communityRemoteUser struct {
	ID       string `json:"id"`
	Username string `json:"username"`
}

type communityRemoteMessage struct {
	ID         string              `json:"id"`
	CreatedAt  string              `json:"createdAt"`
	Text       string              `json:"text"`
	FromUserID string              `json:"fromUserId"`
	User       communityRemoteUser `json:"user"`
	FromUser   communityRemoteUser `json:"fromUser"`
}

func StartCommunityBotTask() {
	communityBotOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			logger.LogInfo(context.Background(), "community bot task started")
			runCommunityBotOnce()
			for {
				time.Sleep(operation_setting.GetCommunityBotPollInterval())
				runCommunityBotOnce()
			}
		})
	})
}

func runCommunityBotOnce() {
	if !communityBotRunning.CompareAndSwap(false, true) {
		return
	}
	defer communityBotRunning.Store(false)

	ctx := context.Background()
	setting := operation_setting.GetCommunityBotSetting()
	if !setting.Enabled {
		return
	}
	if message := validateCommunityBotRuntimeSetting(setting); message != "" {
		logger.LogWarn(ctx, "community bot skipped: "+message)
		return
	}

	cursor, err := model.GetCommunityBotCursor(setting.RoomID)
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("community bot cursor load failed: %v", err))
		return
	}

	messages, err := fetchCommunityMessages(ctx, setting, cursor.LastMessageId)
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("community bot fetch failed: %v", err))
		return
	}
	if len(messages) == 0 {
		return
	}

	sort.Slice(messages, func(i, j int) bool {
		return messages[i].CreatedAt.Before(messages[j].CreatedAt)
	})

	if strings.TrimSpace(cursor.LastMessageId) == "" {
		latest := messages[len(messages)-1]
		if err := model.UpsertCommunityBotCursor(setting.RoomID, latest.ID, latest.CreatedAt.Unix()); err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("community bot initial cursor update failed: message_id=%s error=%v", latest.ID, err))
		}
		return
	}

	for _, message := range messages {
		if err := processCommunityMessage(ctx, setting, message); err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("community bot message process failed: message_id=%s error=%v", message.ID, err))
		}
		if err := model.UpsertCommunityBotCursor(setting.RoomID, message.ID, message.CreatedAt.Unix()); err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("community bot cursor update failed: message_id=%s error=%v", message.ID, err))
			return
		}
	}
}

func validateCommunityBotRuntimeSetting(setting *operation_setting.CommunityBotSetting) string {
	if strings.TrimSpace(setting.NormalizedBaseURL()) == "" {
		return "base_url is empty"
	}
	if strings.TrimSpace(setting.RoomID) == "" {
		return "room_id is empty"
	}
	if strings.TrimSpace(setting.BotToken) == "" {
		return "bot_token is empty"
	}
	if setting.OAuthProviderID <= 0 && strings.TrimSpace(setting.OAuthProviderSlug) == "" {
		return "oauth provider is empty"
	}
	if strings.TrimSpace(setting.CheckinCommand) == "" && strings.TrimSpace(setting.TokenRequestCommand) == "" {
		return "commands are empty"
	}
	if setting.MinAmount < 0 || setting.MaxAmount < setting.MinAmount {
		return "amount range is invalid"
	}
	return ""
}

func fetchCommunityMessages(ctx context.Context, setting *operation_setting.CommunityBotSetting, sinceId string) ([]communityMessage, error) {
	requestCtx, cancel := context.WithTimeout(ctx, communityBotTimeout)
	defer cancel()

	payload := map[string]interface{}{
		"i":      setting.BotToken,
		"roomId": setting.RoomID,
		"limit":  communityBotFetchLimit,
	}
	if strings.TrimSpace(sinceId) != "" {
		payload["sinceId"] = sinceId
	}

	var remoteMessages []communityRemoteMessage
	if err := postCommunityJSON(requestCtx, setting.NormalizedBaseURL()+"/api/chat/messages/room-timeline", payload, &remoteMessages); err != nil {
		return nil, err
	}

	messages := make([]communityMessage, 0, len(remoteMessages))
	for _, remoteMessage := range remoteMessages {
		userID := strings.TrimSpace(remoteMessage.FromUserID)
		if userID == "" {
			userID = strings.TrimSpace(remoteMessage.FromUser.ID)
		}
		if userID == "" {
			userID = strings.TrimSpace(remoteMessage.User.ID)
		}
		if remoteMessage.ID == "" || userID == "" {
			continue
		}
		createdAt, err := time.Parse(time.RFC3339Nano, remoteMessage.CreatedAt)
		if err != nil {
			createdAt = time.Now()
		}
		message := communityMessage{
			ID:        remoteMessage.ID,
			CreatedAt: createdAt,
			UserID:    userID,
			Text:      remoteMessage.Text,
		}
		if strings.TrimSpace(remoteMessage.FromUser.Username) != "" {
			message.ProviderUserIDs = append(message.ProviderUserIDs, strings.TrimSpace(remoteMessage.FromUser.Username))
		}
		if strings.TrimSpace(remoteMessage.FromUserID) != "" {
			message.ProviderUserIDs = append(message.ProviderUserIDs, strings.TrimSpace(remoteMessage.FromUserID))
		}
		if strings.TrimSpace(remoteMessage.FromUser.ID) != "" {
			message.ProviderUserIDs = append(message.ProviderUserIDs, strings.TrimSpace(remoteMessage.FromUser.ID))
		}
		if strings.TrimSpace(remoteMessage.User.ID) != "" {
			message.ProviderUserIDs = append(message.ProviderUserIDs, strings.TrimSpace(remoteMessage.User.ID))
		}
		messages = append(messages, message)
	}
	return messages, nil
}

func sendCommunityReply(ctx context.Context, setting *operation_setting.CommunityBotSetting, replyId string, text string) error {
	if strings.TrimSpace(text) == "" {
		return nil
	}
	requestCtx, cancel := context.WithTimeout(ctx, communityBotTimeout)
	defer cancel()

	payload := map[string]interface{}{
		"i":        setting.BotToken,
		"toRoomId": setting.RoomID,
		"text":     text,
	}
	if strings.TrimSpace(replyId) != "" {
		payload["replyId"] = replyId
	}
	return postCommunityJSON(requestCtx, setting.NormalizedBaseURL()+"/api/chat/messages/create-to-room", payload, nil)
}

func postCommunityJSON(ctx context.Context, url string, payload map[string]interface{}, out any) error {
	body, err := common.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := GetHttpClient().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		responseBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("community api returned %d: %s", resp.StatusCode, strings.TrimSpace(string(responseBody)))
	}
	if out == nil {
		return nil
	}
	return common.DecodeJson(resp.Body, out)
}

func processCommunityMessage(ctx context.Context, setting *operation_setting.CommunityBotSetting, message communityMessage) error {
	text := strings.TrimSpace(message.Text)
	if text == "" {
		return nil
	}

	checkinCommand := strings.TrimSpace(setting.CheckinCommand)
	tokenRequestCommand := strings.TrimSpace(setting.TokenRequestCommand)
	if text != checkinCommand && text != tokenRequestCommand {
		return nil
	}

	providerId, err := resolveCommunityBotOAuthProviderID(setting)
	if err != nil {
		_ = sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.UnknownErrorReply, nil))
		return err
	}

	user, providerUserID, err := getCommunityMessageUser(ctx, providerId, message)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if text == checkinCommand {
				return sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.CheckinUnboundReply, map[string]string{
					"command":          text,
					"provider_user_id": providerUserID,
				}))
			}
			return sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.TokenUnboundReply, map[string]string{
				"command":          text,
				"provider_user_id": providerUserID,
			}))
		}
		return err
	}

	if text == checkinCommand {
		return handleCommunityCheckin(ctx, setting, message, user.Id, providerUserID, text)
	}
	return handleCommunityTokenRequest(ctx, setting, message, providerId, user.Id, providerUserID, text)
}

func getCommunityMessageUser(ctx context.Context, providerId int, message communityMessage) (*model.User, string, error) {
	seen := make(map[string]struct{})
	candidates := append([]string{}, message.ProviderUserIDs...)
	candidates = append(candidates, message.UserID)
	var lastErr error
	for _, candidate := range candidates {
		providerUserID := strings.TrimSpace(candidate)
		if providerUserID == "" {
			continue
		}
		if _, ok := seen[providerUserID]; ok {
			continue
		}
		seen[providerUserID] = struct{}{}
		user, err := model.GetUserByOAuthBinding(providerId, providerUserID)
		if err == nil {
			return user, providerUserID, nil
		}
		lastErr = err
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			logger.LogWarn(ctx, fmt.Sprintf("community bot OAuth binding lookup failed: provider_id=%d provider_user_id=%s error=%v", providerId, providerUserID, err))
		}
	}
	if lastErr == nil {
		lastErr = gorm.ErrRecordNotFound
	}
	return nil, message.UserID, lastErr
}

func resolveCommunityBotOAuthProviderID(setting *operation_setting.CommunityBotSetting) (int, error) {
	if setting.OAuthProviderID > 0 {
		provider, err := model.GetCustomOAuthProviderById(setting.OAuthProviderID)
		if err != nil {
			return 0, err
		}
		return provider.Id, nil
	}
	provider, err := model.GetCustomOAuthProviderBySlug(strings.TrimSpace(setting.OAuthProviderSlug))
	if err != nil {
		return 0, err
	}
	return provider.Id, nil
}

func handleCommunityCheckin(ctx context.Context, setting *operation_setting.CommunityBotSetting, message communityMessage, userId int, providerUserID string, command string) error {
	amount := randomCommunityCheckinAmount(setting.MinAmount, setting.MaxAmount)
	quotaAwarded := int(math.Round(amount * common.QuotaPerUnit))
	checkin, err := model.UserCheckinWithQuotaRange(userId, quotaAwarded, quotaAwarded)
	if err != nil {
		if errors.Is(err, model.ErrAlreadyCheckedInToday) {
			return sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.CheckinAlreadyReply, map[string]string{
				"command":          command,
				"date":             time.Now().Format("2006-01-02"),
				"user_id":          fmt.Sprintf("%d", userId),
				"provider_user_id": providerUserID,
			}))
		}
		_ = sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.UnknownErrorReply, map[string]string{
			"command":          command,
			"user_id":          fmt.Sprintf("%d", userId),
			"provider_user_id": providerUserID,
		}))
		return err
	}
	user, err := model.GetUserById(userId, false)
	if err != nil {
		return err
	}
	return sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.CheckinSuccessReply, map[string]string{
		"amount":           formatCommunityAmount(amount),
		"balance":          formatCommunityAmount(float64(user.Quota) / common.QuotaPerUnit),
		"command":          command,
		"quota":            fmt.Sprintf("%d", checkin.QuotaAwarded),
		"date":             checkin.CheckinDate,
		"user_id":          fmt.Sprintf("%d", userId),
		"provider_user_id": providerUserID,
	}))
}

func randomCommunityCheckinAmount(minAmount float64, maxAmount float64) float64 {
	minCents := int(math.Round(minAmount * 100))
	maxCents := int(math.Round(maxAmount * 100))
	if maxCents <= minCents {
		return float64(minCents) / 100
	}
	return float64(minCents+rand.Intn(maxCents-minCents+1)) / 100
}

func formatCommunityAmount(amount float64) string {
	return fmt.Sprintf("%.2f", amount)
}

func handleCommunityTokenRequest(ctx context.Context, setting *operation_setting.CommunityBotSetting, message communityMessage, providerId int, userId int, providerUserID string, command string) error {
	created, err := model.GrantCommunityTokenApproval(userId, providerId, providerUserID, setting.RoomID, message.ID)
	if err != nil {
		_ = sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.UnknownErrorReply, map[string]string{
			"command":          command,
			"user_id":          fmt.Sprintf("%d", userId),
			"provider_user_id": providerUserID,
		}))
		return err
	}
	reply := setting.TokenApprovedReply
	if !created {
		reply = setting.TokenAlreadyApprovedReply
	}
	return sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(reply, map[string]string{
		"command":          command,
		"date":             time.Now().Format("2006-01-02"),
		"user_id":          fmt.Sprintf("%d", userId),
		"provider_user_id": providerUserID,
	}))
}

func renderCommunityBotTemplate(template string, values map[string]string) string {
	if values == nil {
		values = map[string]string{}
	}
	if _, ok := values["date"]; !ok {
		values["date"] = time.Now().Format("2006-01-02")
	}
	result := template
	for key, value := range values {
		result = strings.ReplaceAll(result, "{"+key+"}", value)
	}
	return result
}
