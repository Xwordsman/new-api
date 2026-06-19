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
	"strconv"
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
	expireCommunityRedPackets(ctx, setting)
	remindCommunityLottery(ctx, setting)
	remindCommunityRedPackets(ctx, setting)
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
	if strings.TrimSpace(setting.CheckinCommand) == "" && strings.TrimSpace(setting.TokenRequestCommand) == "" && (!setting.LotteryEnabled || strings.TrimSpace(setting.LotteryCommand) == "") {
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
	lotteryCommand := strings.TrimSpace(setting.LotteryCommand)
	isLotteryCommand := setting.LotteryEnabled && lotteryCommand != "" && text == lotteryCommand
	redPacketCreateCommand := strings.TrimSpace(setting.RedPacketCreateCommand)
	redPacketClaimCommand := strings.TrimSpace(setting.RedPacketClaimCommand)
	isRedPacketCreateCommand := setting.RedPacketEnabled && redPacketCreateCommand != "" && strings.HasPrefix(text, redPacketCreateCommand)
	isRedPacketClaimCommand := setting.RedPacketEnabled && redPacketClaimCommand != "" && text == redPacketClaimCommand
	if text != checkinCommand && text != tokenRequestCommand && !isLotteryCommand && !isRedPacketCreateCommand && !isRedPacketClaimCommand {
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
			if isLotteryCommand {
				return sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.LotteryUnboundReply, map[string]string{
					"command":          text,
					"provider_user_id": providerUserID,
				}))
			}
			if isRedPacketCreateCommand || isRedPacketClaimCommand {
				return sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.RedPacketUnboundReply, map[string]string{
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
	if isLotteryCommand {
		return handleCommunityLottery(ctx, setting, message, providerId, user.Id, providerUserID, text)
	}
	if isRedPacketCreateCommand {
		return handleCommunityRedPacketCreate(ctx, setting, message, user.Id, providerUserID, text, redPacketCreateCommand)
	}
	if isRedPacketClaimCommand {
		return handleCommunityRedPacketClaim(ctx, setting, message, user.Id, providerUserID, text)
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
	model.RecordLog(userId, model.LogTypeSystem, fmt.Sprintf("社区群签到，获得额度 %s，社区用户 @%s", logger.LogQuota(checkin.QuotaAwarded), providerUserID))
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

func handleCommunityLottery(ctx context.Context, setting *operation_setting.CommunityBotSetting, message communityMessage, providerId int, userId int, providerUserID string, command string) error {
	now := time.Now()
	baseValues := map[string]string{
		"command":          command,
		"date":             now.Format("2006-01-02"),
		"user_id":          fmt.Sprintf("%d", userId),
		"provider_user_id": providerUserID,
	}

	mode := strings.TrimSpace(setting.LotteryMode)
	if mode == "" {
		mode = "rolling"
	}

	var (
		sessionKey     string
		sessionName    string
		sessionStart   string
		sessionEnd     string
		budgetCents    int
		prizes         []model.CommunityLotteryPrizeCandidate
		nextSessionMsg map[string]string
		inSession      bool
	)

	if mode == "scheduled" {
		sessions, err := operation_setting.ParseCommunityLotterySessions(setting.LotterySessions)
		if err != nil {
			_ = sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.LotteryErrorReply, baseValues))
			return err
		}
		session, nextSession, ok := getActiveCommunityLotterySession(sessions, now)
		if nextSession != nil {
			baseValues["next_session_name"] = nextSession.Name
			baseValues["next_start"] = nextSession.Start
			baseValues["next_end"] = nextSession.End
		}
		if !ok {
			return sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.LotteryOutOfSessionReply, baseValues))
		}
		inSession = true
		sessionKey = session.Key
		sessionName = session.Name
		sessionStart = session.Start
		sessionEnd = session.End
		budgetCents = amountToCents(session.Budget)
		for _, prize := range session.Prizes {
			cents := amountToCents(prize.Amount)
			prizes = append(prizes, model.CommunityLotteryPrizeCandidate{
				Name:           prize.Name,
				Weight:         prize.Weight,
				MinAmountCents: cents,
				MaxAmountCents: cents,
			})
		}
	} else {
		rolling, err := operation_setting.ParseCommunityLotteryRollingPrizes(setting.LotteryRollingPrizes)
		if err != nil {
			_ = sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.LotteryErrorReply, baseValues))
			return err
		}
		if len(rolling) == 0 {
			_ = sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.LotteryErrorReply, baseValues))
			return errors.New("rolling lottery prizes empty")
		}
		key, name, start, end := computeCommunityRollingSession(setting.LotteryRollingIntervalMinutes, now)
		nextKey, nextName, nextStart, nextEnd := computeCommunityRollingNextSession(setting.LotteryRollingIntervalMinutes, now)
		nextSessionMsg = map[string]string{
			"next_session_key":  nextKey,
			"next_session_name": nextName,
			"next_start":        nextStart,
			"next_end":          nextEnd,
		}
		inSession = true
		sessionKey = key
		sessionName = name
		sessionStart = start
		sessionEnd = end
		budgetCents = amountToCents(setting.LotteryRollingBudget)
		for _, prize := range rolling {
			minCents := amountToCents(prize.MinAmount)
			maxCents := amountToCents(prize.MaxAmount)
			if minCents == 0 && maxCents == 0 && prize.Amount > 0 {
				minCents = amountToCents(prize.Amount)
				maxCents = minCents
			}
			prizes = append(prizes, model.CommunityLotteryPrizeCandidate{
				Name:           prize.Name,
				Weight:         prize.Weight,
				MinAmountCents: minCents,
				MaxAmountCents: maxCents,
			})
		}
	}

	if !inSession {
		return sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.LotteryOutOfSessionReply, baseValues))
	}

	baseValues["session_key"] = sessionKey
	baseValues["session_name"] = sessionName
	baseValues["session_start"] = sessionStart
	baseValues["session_end"] = sessionEnd
	for k, v := range nextSessionMsg {
		baseValues[k] = v
	}

	result, err := model.CreateCommunityLotteryDraw(model.CommunityLotteryDrawParams{
		UserId:         userId,
		ProviderId:     providerId,
		ProviderUserId: providerUserID,
		RoomId:         setting.RoomID,
		MessageId:      message.ID,
		DrawDate:       now.Format("2006-01-02"),
		SessionKey:     sessionKey,
		SessionName:    sessionName,
		SessionStart:   sessionStart,
		SessionEnd:     sessionEnd,
		BudgetCents:    budgetCents,
		Prizes:         prizes,
	})
	if err != nil {
		_ = sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.LotteryErrorReply, baseValues))
		return err
	}
	if result.AlreadyDrawn {
		return sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.LotteryAlreadyDrawnReply, baseValues))
	}
	baseValues["remaining_budget"] = formatCommunityAmount(centsToAmount(result.RemainingCents))
	if result.PoolEmpty || result.Draw == nil {
		return sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.LotteryPoolEmptyReply, baseValues))
	}
	draw := result.Draw
	user, err := model.GetUserById(userId, false)
	if err != nil {
		return err
	}
	baseValues["prize_name"] = draw.PrizeName
	baseValues["amount"] = formatCommunityAmount(centsToAmount(draw.AmountCents))
	baseValues["quota"] = fmt.Sprintf("%d", draw.QuotaAwarded)
	baseValues["balance"] = formatCommunityAmount(float64(user.Quota) / common.QuotaPerUnit)
	model.RecordLog(userId, model.LogTypeSystem, fmt.Sprintf("社区群抽奖，场次：%s，奖项：%s，获得额度 %s，社区用户 @%s", draw.SessionName, draw.PrizeName, logger.LogQuota(draw.QuotaAwarded), providerUserID))
	reply := setting.LotteryWinReply
	if draw.AmountCents == 0 {
		reply = setting.LotteryNoPrizeReply
	}
	return sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(reply, baseValues))
}

func computeCommunityRollingSession(intervalMinutes int, now time.Time) (key, name, startStr, endStr string) {
	if intervalMinutes <= 0 {
		intervalMinutes = 60
	}
	minutes := now.Hour()*60 + now.Minute()
	startMin := (minutes / intervalMinutes) * intervalMinutes
	endMin := startMin + intervalMinutes
	if endMin > 24*60 {
		endMin = 24 * 60
	}
	startStr = fmt.Sprintf("%02d:%02d", startMin/60, startMin%60)
	endHour := endMin / 60
	endMinPart := endMin % 60
	if endHour == 24 && endMinPart == 0 {
		endStr = "24:00"
	} else {
		endStr = fmt.Sprintf("%02d:%02d", endHour, endMinPart)
	}
	name = fmt.Sprintf("%s-%s", startStr, endStr)
	key = fmt.Sprintf("%s_%02d%02d", now.Format("2006-01-02"), startMin/60, startMin%60)
	return
}

func computeCommunityRollingNextSession(intervalMinutes int, now time.Time) (key, name, startStr, endStr string) {
	if intervalMinutes <= 0 {
		intervalMinutes = 60
	}
	_, _, _, currentEnd := computeCommunityRollingSession(intervalMinutes, now)
	parts := strings.Split(currentEnd, ":")
	if len(parts) != 2 {
		return "", "", "", ""
	}
	endHour, _ := strconv.Atoi(parts[0])
	endMin, _ := strconv.Atoi(parts[1])
	nextDayOffset := time.Duration(0)
	if endHour >= 24 {
		nextDayOffset = 24 * time.Hour
		endHour = 0
		endMin = 0
	}
	base := time.Date(now.Year(), now.Month(), now.Day(), endHour, endMin, 0, 0, now.Location()).Add(nextDayOffset)
	return computeCommunityRollingSession(intervalMinutes, base)
}

func getActiveCommunityLotterySession(sessions []operation_setting.CommunityLotterySession, now time.Time) (*operation_setting.CommunityLotterySession, *operation_setting.CommunityLotterySession, bool) {
	currentMinute := now.Hour()*60 + now.Minute()
	var next *operation_setting.CommunityLotterySession
	var nextStart int
	for i := range sessions {
		session := &sessions[i]
		start := communityClockToMinute(session.Start)
		end := communityClockToMinute(session.End)
		if currentMinute >= start && currentMinute < end {
			return session, nil, true
		}
		candidateStart := start
		if start <= currentMinute {
			candidateStart += 24 * 60
		}
		if next == nil || candidateStart < nextStart {
			next = session
			nextStart = candidateStart
		}
	}
	return nil, next, false
}

func addCommunityLotterySessionTemplateValues(values map[string]string, session *operation_setting.CommunityLotterySession) {
	values["session_key"] = session.Key
	values["session_name"] = session.Name
	values["session_start"] = session.Start
	values["session_end"] = session.End
}

func communityClockToMinute(clock string) int {
	parts := strings.Split(clock, ":")
	if len(parts) != 2 || len(parts[0]) != 2 || len(parts[1]) != 2 {
		return 0
	}
	return (int(parts[0][0]-'0')*10+int(parts[0][1]-'0'))*60 + int(parts[1][0]-'0')*10 + int(parts[1][1]-'0')
}

func amountToCents(amount float64) int {
	return int(math.Round(amount * 100))
}

func centsToAmount(cents int) float64 {
	return float64(cents) / 100
}

func centsToQuota(cents int) int {
	return int(math.Round(centsToAmount(cents) * common.QuotaPerUnit))
}

func parseCommunityRedPacketCreateArgs(text string, prefix string) (totalAmount float64, totalCount int, ok bool) {
	stripped := strings.TrimSpace(strings.TrimPrefix(text, prefix))
	if stripped == "" {
		return 0, 0, false
	}
	fields := strings.Fields(stripped)
	if len(fields) < 2 {
		return 0, 0, false
	}
	amount, err := strconv.ParseFloat(fields[0], 64)
	if err != nil || amount <= 0 {
		return 0, 0, false
	}
	count, err := strconv.Atoi(fields[1])
	if err != nil || count <= 0 {
		return 0, 0, false
	}
	return amount, count, true
}

func handleCommunityRedPacketCreate(ctx context.Context, setting *operation_setting.CommunityBotSetting, message communityMessage, userId int, providerUserID string, command string, prefix string) error {
	baseValues := map[string]string{
		"command":          command,
		"create_command":   strings.TrimSpace(setting.RedPacketCreateCommand),
		"claim_command":    strings.TrimSpace(setting.RedPacketClaimCommand),
		"date":             time.Now().Format("2006-01-02"),
		"user_id":          fmt.Sprintf("%d", userId),
		"provider_user_id": providerUserID,
		"creator":          providerUserID,
	}
	if !operation_setting.IsCommunityRedPacketCreator(setting, append([]string{providerUserID}, message.ProviderUserIDs...)...) {
		return sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.RedPacketNotAllowedReply, baseValues))
	}
	if err := operation_setting.ValidateCommunityRedPacketSetting(setting); err != nil {
		_ = sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.RedPacketErrorReply, baseValues))
		return err
	}
	totalAmount, totalCount, ok := parseCommunityRedPacketCreateArgs(command, prefix)
	if !ok {
		return sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.RedPacketUsageReply, baseValues))
	}
	if totalAmount < setting.RedPacketMinTotalAmount || totalAmount > setting.RedPacketMaxTotalAmount {
		baseValues["min_amount"] = formatCommunityAmount(setting.RedPacketMinTotalAmount)
		baseValues["max_amount"] = formatCommunityAmount(setting.RedPacketMaxTotalAmount)
		return sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.RedPacketUsageReply, baseValues))
	}
	if totalCount < setting.RedPacketMinCount || totalCount > setting.RedPacketMaxCount {
		baseValues["min_count"] = fmt.Sprintf("%d", setting.RedPacketMinCount)
		baseValues["max_count"] = fmt.Sprintf("%d", setting.RedPacketMaxCount)
		return sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.RedPacketUsageReply, baseValues))
	}
	totalCents := amountToCents(totalAmount)
	if totalCents < totalCount {
		return sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.RedPacketUsageReply, baseValues))
	}
	result, err := model.CreateCommunityRedPacket(model.CreateCommunityRedPacketParams{
		RoomId:                setting.RoomID,
		CreatorProviderUserId: providerUserID,
		CreatorUserId:         userId,
		TotalAmountCents:      totalCents,
		TotalCount:            totalCount,
		SplitMode:             setting.RedPacketSplitMode,
		ExpireMinutes:         setting.RedPacketExpireMinutes,
		SourceMessageId:       message.ID,
		ConcurrencyMode:       setting.RedPacketConcurrencyMode,
	})
	if err != nil {
		_ = sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.RedPacketErrorReply, baseValues))
		return err
	}
	if result.Conflict {
		return sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.RedPacketBusyReply, baseValues))
	}
	if result.Packet == nil {
		_ = sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.RedPacketErrorReply, baseValues))
		return errors.New("create red packet returned empty packet")
	}
	packet := result.Packet
	model.RecordLog(userId, model.LogTypeSystem, fmt.Sprintf("社区群红包发放，总金额 %s，份数 %d，社区用户 @%s", logger.LogQuota(int(float64(packet.TotalAmountCents)/100*common.QuotaPerUnit)), packet.TotalCount, providerUserID))
	baseValues["total_amount"] = formatCommunityAmount(centsToAmount(packet.TotalAmountCents))
	baseValues["total_count"] = fmt.Sprintf("%d", packet.TotalCount)
	if packet.ExpiresAt > 0 {
		baseValues["expires_at"] = time.Unix(packet.ExpiresAt, 0).Format("2006-01-02 15:04:05")
	} else {
		baseValues["expires_at"] = "-"
	}
	return sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.RedPacketCreatedReply, baseValues))
}

func handleCommunityRedPacketClaim(ctx context.Context, setting *operation_setting.CommunityBotSetting, message communityMessage, userId int, providerUserID string, command string) error {
	baseValues := map[string]string{
		"command":          command,
		"create_command":   strings.TrimSpace(setting.RedPacketCreateCommand),
		"claim_command":    strings.TrimSpace(setting.RedPacketClaimCommand),
		"date":             time.Now().Format("2006-01-02"),
		"user_id":          fmt.Sprintf("%d", userId),
		"provider_user_id": providerUserID,
	}
	result, err := model.ClaimCommunityRedPacket(model.ClaimCommunityRedPacketParams{
		RoomId:          setting.RoomID,
		UserId:          userId,
		ProviderUserId:  providerUserID,
		SourceMessageId: message.ID,
	})
	if err != nil {
		_ = sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.RedPacketErrorReply, baseValues))
		return err
	}
	if result.Packet != nil {
		baseValues["creator"] = result.Packet.CreatorProviderUserId
		baseValues["total_amount"] = formatCommunityAmount(centsToAmount(result.Packet.TotalAmountCents))
		baseValues["total_count"] = fmt.Sprintf("%d", result.Packet.TotalCount)
		baseValues["remaining_count"] = fmt.Sprintf("%d", result.Packet.RemainingCount)
		baseValues["remaining_amount"] = formatCommunityAmount(centsToAmount(result.Packet.RemainingAmountCents))
	}
	if result.NoPacket {
		return sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.RedPacketEmptyReply, baseValues))
	}
	if result.Expired {
		return sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.RedPacketExpiredReply, baseValues))
	}
	if result.AlreadyClaimed {
		return sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.RedPacketAlreadyReply, baseValues))
	}
	if result.Claim == nil {
		_ = sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.RedPacketErrorReply, baseValues))
		return errors.New("claim red packet returned empty claim")
	}
	user, err := model.GetUserById(userId, false)
	if err != nil {
		return err
	}
	baseValues["amount"] = formatCommunityAmount(centsToAmount(result.Claim.AmountCents))
	baseValues["quota"] = fmt.Sprintf("%d", result.Claim.QuotaAwarded)
	baseValues["balance"] = formatCommunityAmount(float64(user.Quota) / common.QuotaPerUnit)
	model.RecordLog(userId, model.LogTypeSystem, fmt.Sprintf("社区群红包，抢到金额 %s，社区用户 @%s", logger.LogQuota(result.Claim.QuotaAwarded), providerUserID))
	return sendCommunityReply(ctx, setting, message.ID, renderCommunityBotTemplate(setting.RedPacketClaimedReply, baseValues))
}

func expireCommunityRedPackets(ctx context.Context, setting *operation_setting.CommunityBotSetting) {
	if !setting.RedPacketEnabled {
		return
	}
	packets, err := model.ExpireCommunityRedPackets(setting.RoomID)
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("community bot expire red packets failed: %v", err))
		return
	}
	for _, packet := range packets {
		values := map[string]string{
			"creator":          packet.CreatorProviderUserId,
			"provider_user_id": packet.CreatorProviderUserId,
			"total_amount":     formatCommunityAmount(centsToAmount(packet.TotalAmountCents)),
			"total_count":      fmt.Sprintf("%d", packet.TotalCount),
			"remaining_count":  fmt.Sprintf("%d", packet.RemainingCount),
			"remaining_amount": formatCommunityAmount(centsToAmount(packet.RemainingAmountCents)),
			"date":             time.Now().Format("2006-01-02"),
			"command":          strings.TrimSpace(setting.RedPacketCreateCommand),
			"create_command":   strings.TrimSpace(setting.RedPacketCreateCommand),
			"claim_command":    strings.TrimSpace(setting.RedPacketClaimCommand),
		}
		_ = sendCommunityReply(ctx, setting, packet.SourceMessageId, renderCommunityBotTemplate(setting.RedPacketExpiredReply, values))
	}
}

func remindCommunityLottery(ctx context.Context, setting *operation_setting.CommunityBotSetting) {
	if !setting.LotteryEnabled || !setting.LotteryReminderEnabled {
		return
	}
	interval := setting.LotteryReminderIntervalMinutes
	if interval <= 0 {
		return
	}
	mode := strings.TrimSpace(setting.LotteryMode)
	if mode == "" {
		mode = "rolling"
	}

	now := time.Now()
	var (
		sessionKey   string
		sessionName  string
		sessionStart string
		sessionEnd   string
		budgetCents  int
		budgetAmount float64
	)

	if mode == "scheduled" {
		sessions, err := operation_setting.ParseCommunityLotterySessions(setting.LotterySessions)
		if err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("community bot lottery reminder parse sessions failed: %v", err))
			return
		}
		session, _, ok := getActiveCommunityLotterySession(sessions, now)
		if !ok {
			return
		}
		sessionKey = session.Key
		sessionName = session.Name
		sessionStart = session.Start
		sessionEnd = session.End
		budgetCents = amountToCents(session.Budget)
		budgetAmount = session.Budget
	} else {
		key, name, start, end := computeCommunityRollingSession(setting.LotteryRollingIntervalMinutes, now)
		sessionKey = key
		sessionName = name
		sessionStart = start
		sessionEnd = end
		budgetCents = amountToCents(setting.LotteryRollingBudget)
		budgetAmount = setting.LotteryRollingBudget
	}

	reminder, err := model.GetCommunityLotteryReminder(setting.RoomID, sessionKey)
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("community bot lottery reminder load failed: %v", err))
		return
	}
	nowUnix := now.Unix()
	if reminder != nil && nowUnix-reminder.LastRemindedAt < int64(interval)*60 {
		return
	}

	usedCents, err := model.SumCommunityLotterySessionAmountCents(setting.RoomID, sessionKey, now.Format("2006-01-02"))
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("community bot lottery reminder sum failed: %v", err))
		return
	}
	remainingCents := budgetCents - usedCents
	if remainingCents <= 0 {
		return
	}

	values := map[string]string{
		"command":          strings.TrimSpace(setting.LotteryCommand),
		"date":             now.Format("2006-01-02"),
		"session_key":      sessionKey,
		"session_name":     sessionName,
		"session_start":    sessionStart,
		"session_end":      sessionEnd,
		"budget":           formatCommunityAmount(budgetAmount),
		"remaining_budget": formatCommunityAmount(centsToAmount(remainingCents)),
	}
	if err := sendCommunityReply(ctx, setting, "", renderCommunityBotTemplate(setting.LotteryReminderReply, values)); err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("community bot lottery reminder send failed: %v", err))
		return
	}
	if err := model.UpsertCommunityLotteryReminder(setting.RoomID, sessionKey, nowUnix); err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("community bot lottery reminder upsert failed: %v", err))
	}
}

func remindCommunityRedPackets(ctx context.Context, setting *operation_setting.CommunityBotSetting) {
	if !setting.RedPacketEnabled || !setting.RedPacketReminderEnabled {
		return
	}
	interval := setting.RedPacketReminderIntervalMinutes
	if interval <= 0 {
		return
	}
	packets, err := model.GetCommunityRedPacketsForReminder(setting.RoomID, int64(interval)*60)
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("community bot red packet reminder load failed: %v", err))
		return
	}
	now := time.Now()
	for _, packet := range packets {
		values := map[string]string{
			"creator":          packet.CreatorProviderUserId,
			"provider_user_id": packet.CreatorProviderUserId,
			"total_amount":     formatCommunityAmount(centsToAmount(packet.TotalAmountCents)),
			"total_count":      fmt.Sprintf("%d", packet.TotalCount),
			"remaining_count":  fmt.Sprintf("%d", packet.RemainingCount),
			"remaining_amount": formatCommunityAmount(centsToAmount(packet.RemainingAmountCents)),
			"date":             now.Format("2006-01-02"),
			"create_command":   strings.TrimSpace(setting.RedPacketCreateCommand),
			"claim_command":    strings.TrimSpace(setting.RedPacketClaimCommand),
		}
		if packet.ExpiresAt > 0 {
			values["expires_at"] = time.Unix(packet.ExpiresAt, 0).Format("15:04")
			minutesLeft := (packet.ExpiresAt - now.Unix()) / 60
			if minutesLeft < 0 {
				minutesLeft = 0
			}
			values["minutes_left"] = fmt.Sprintf("%d", minutesLeft)
		} else {
			values["expires_at"] = "-"
			values["minutes_left"] = "-"
		}
		if err := sendCommunityReply(ctx, setting, packet.SourceMessageId, renderCommunityBotTemplate(setting.RedPacketReminderReply, values)); err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("community bot red packet reminder send failed: packet_id=%d error=%v", packet.Id, err))
			continue
		}
		if err := model.UpdateCommunityRedPacketReminder(packet.Id, now.Unix()); err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("community bot red packet reminder upsert failed: packet_id=%d error=%v", packet.Id, err))
		}
	}
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
	} else {
		model.RecordLog(userId, model.LogTypeSystem, fmt.Sprintf("社区群申请创建令牌，已授予创建权限，社区用户 @%s", providerUserID))
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
