package operation_setting

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

type CommunityLotteryPrize struct {
	Name   string  `json:"name"`
	Weight int     `json:"weight"`
	Amount float64 `json:"amount"`
}

type CommunityLotterySession struct {
	Key    string                  `json:"key"`
	Name   string                  `json:"name"`
	Start  string                  `json:"start"`
	End    string                  `json:"end"`
	Budget float64                 `json:"budget"`
	Prizes []CommunityLotteryPrize `json:"prizes"`
}

const defaultCommunityLotterySessions = `[
  {
    "key": "evening",
    "name": "晚间场",
    "start": "20:00",
    "end": "21:00",
    "budget": 100,
    "prizes": [
      { "name": "谢谢参与", "weight": 50, "amount": 0 },
      { "name": "小确幸", "weight": 35, "amount": 0.2 },
      { "name": "好运奖", "weight": 12, "amount": 1 },
      { "name": "欧皇奖", "weight": 3, "amount": 5 }
    ]
  }
]`

var communityLotteryTimePattern = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

type CommunityBotSetting struct {
	Enabled                   bool    `json:"enabled"`
	BaseURL                   string  `json:"base_url"`
	RoomID                    string  `json:"room_id"`
	BotToken                  string  `json:"bot_token"`
	PollIntervalSeconds       int     `json:"poll_interval_seconds"`
	OAuthProviderID           int     `json:"oauth_provider_id"`
	OAuthProviderSlug         string  `json:"oauth_provider_slug"`
	CheckinCommand            string  `json:"checkin_command"`
	TokenRequestCommand       string  `json:"token_request_command"`
	MinAmount                 float64 `json:"min_amount"`
	MaxAmount                 float64 `json:"max_amount"`
	LotteryEnabled            bool    `json:"lottery_enabled"`
	LotteryCommand            string  `json:"lottery_command"`
	LotterySessions           string  `json:"lottery_sessions"`
	LotteryWinReply           string  `json:"lottery_win_reply"`
	LotteryNoPrizeReply       string  `json:"lottery_no_prize_reply"`
	LotteryAlreadyDrawnReply  string  `json:"lottery_already_drawn_reply"`
	LotteryOutOfSessionReply  string  `json:"lottery_out_of_session_reply"`
	LotteryPoolEmptyReply     string  `json:"lottery_pool_empty_reply"`
	LotteryUnboundReply       string  `json:"lottery_unbound_reply"`
	LotteryErrorReply         string  `json:"lottery_error_reply"`
	CheckinSuccessReply       string  `json:"checkin_success_reply"`
	CheckinAlreadyReply       string  `json:"checkin_already_reply"`
	CheckinUnboundReply       string  `json:"checkin_unbound_reply"`
	TokenApprovedReply        string  `json:"token_approved_reply"`
	TokenAlreadyApprovedReply string  `json:"token_already_approved_reply"`
	TokenUnboundReply         string  `json:"token_unbound_reply"`
	UnknownErrorReply         string  `json:"unknown_error_reply"`
	TokenBlockPrompt          string  `json:"token_block_prompt"`
	RedPacketEnabled          bool    `json:"red_packet_enabled"`
	RedPacketCreateCommand    string  `json:"red_packet_create_command"`
	RedPacketClaimCommand     string  `json:"red_packet_claim_command"`
	RedPacketWhitelist        string  `json:"red_packet_whitelist"`
	RedPacketConcurrencyMode  string  `json:"red_packet_concurrency_mode"`
	RedPacketExpireMinutes    int     `json:"red_packet_expire_minutes"`
	RedPacketSplitMode        string  `json:"red_packet_split_mode"`
	RedPacketMinTotalAmount   float64 `json:"red_packet_min_total_amount"`
	RedPacketMaxTotalAmount   float64 `json:"red_packet_max_total_amount"`
	RedPacketMinCount         int     `json:"red_packet_min_count"`
	RedPacketMaxCount         int     `json:"red_packet_max_count"`
	RedPacketCreatedReply     string  `json:"red_packet_created_reply"`
	RedPacketClaimedReply     string  `json:"red_packet_claimed_reply"`
	RedPacketEmptyReply       string  `json:"red_packet_empty_reply"`
	RedPacketAlreadyReply     string  `json:"red_packet_already_reply"`
	RedPacketNotAllowedReply  string  `json:"red_packet_not_allowed_reply"`
	RedPacketExpiredReply     string  `json:"red_packet_expired_reply"`
	RedPacketUsageReply       string  `json:"red_packet_usage_reply"`
	RedPacketUnboundReply     string  `json:"red_packet_unbound_reply"`
	RedPacketErrorReply       string  `json:"red_packet_error_reply"`
}

var communityBotSetting = CommunityBotSetting{
	Enabled:                   false,
	BaseURL:                   "https://dc.hhhl.cc",
	RoomID:                    "",
	BotToken:                  "",
	PollIntervalSeconds:       15,
	OAuthProviderID:           0,
	OAuthProviderSlug:         "",
	CheckinCommand:            "签到",
	TokenRequestCommand:       "创建令牌",
	MinAmount:                 1,
	MaxAmount:                 5,
	LotteryEnabled:            false,
	LotteryCommand:            "抽奖",
	LotterySessions:           defaultCommunityLotterySessions,
	LotteryWinReply:           "$[sparkle $[rainbow 🎁 恭喜 @{provider_user_id} 在「{session_name}」抽中了「{prize_name}」：{amount}美元！]] $[sparkle $[rainbow 当前余额：{balance}美刀]]",
	LotteryNoPrizeReply:       "🎲 @{provider_user_id} 在「{session_name}」抽中了「{prize_name}」，这次没有获得奖励，祝你下次好运！",
	LotteryAlreadyDrawnReply:  "🎲 @{provider_user_id} 你已经参加过「{session_name}」啦，请等待下一场",
	LotteryOutOfSessionReply:  "⏰ @{provider_user_id} 当前不在抽奖时间内，下一场：{next_session_name} {next_start}-{next_end}",
	LotteryPoolEmptyReply:     "🎁 「{session_name}」奖池已经被抽完啦，请等待下一场",
	LotteryUnboundReply:       "请先使用社区账号登录并绑定 new-api 账号。",
	LotteryErrorReply:         "抽奖失败，请稍后再试。",
	CheckinSuccessReply:       "$[sparkle $[rainbow 🎉 恭喜 @{provider_user_id} 领到了{amount}美元！]] $[sparkle $[rainbow 当前余额：{balance}美刀]]",
	CheckinAlreadyReply:       "⏰ @{provider_user_id} 你今天已经签到过啦！明天再来领取奖励吧",
	CheckinUnboundReply:       "请先使用社区账号登录并绑定 new-api 账号。",
	TokenApprovedReply:        "$[border.style=solid,width=3,color=0af,radius=5 $[tada $[fg.color=0af 🔑 令牌授权成功！]]] $[fg.color=0af @{provider_user_id} 你现在可以创建令牌了]",
	TokenAlreadyApprovedReply: "你已经拥有令牌创建权限。",
	TokenUnboundReply:         "请先使用社区账号登录并绑定 new-api 账号。",
	UnknownErrorReply:         "处理失败，请稍后再试。",
	TokenBlockPrompt:          "请先在社区群内发送“创建令牌”完成令牌创建授权。",
	RedPacketEnabled:          false,
	RedPacketCreateCommand:    "发红包",
	RedPacketClaimCommand:     "抢红包",
	RedPacketWhitelist:        "",
	RedPacketConcurrencyMode:  "single",
	RedPacketExpireMinutes:    10,
	RedPacketSplitMode:        "random",
	RedPacketMinTotalAmount:   0.5,
	RedPacketMaxTotalAmount:   100,
	RedPacketMinCount:         1,
	RedPacketMaxCount:         100,
	RedPacketCreatedReply:     "🧧 @{provider_user_id} 发了一个 {total_amount} 美元红包，共 {total_count} 份！发送「{claim_command}」领取。",
	RedPacketClaimedReply:     "🧧 @{provider_user_id} 抢到了 {amount} 美元！当前余额：{balance} 美刀。剩余 {remaining_count} 份。",
	RedPacketEmptyReply:       "🧧 「{creator}」的红包已经被抢完啦！",
	RedPacketAlreadyReply:     "🧧 @{provider_user_id} 你已经抢过这个红包啦。",
	RedPacketNotAllowedReply:  "🚫 @{provider_user_id} 你没有发红包的权限。",
	RedPacketExpiredReply:     "🧧 「{creator}」的红包已过期。",
	RedPacketUsageReply:       "🧧 命令格式错误，正确用法：{create_command} 总金额 份数",
	RedPacketUnboundReply:     "请先使用社区账号登录并绑定 new-api 账号。",
	RedPacketErrorReply:       "🧧 红包处理失败，请稍后再试。",
}

func init() {
	config.GlobalConfig.Register("community_bot", &communityBotSetting)
}

func GetCommunityBotSetting() *CommunityBotSetting {
	return &communityBotSetting
}

func IsCommunityBotEnabled() bool {
	return communityBotSetting.Enabled
}

func GetCommunityBotPollInterval() time.Duration {
	seconds := communityBotSetting.PollIntervalSeconds
	if seconds < 5 {
		seconds = 5
	}
	return time.Duration(seconds) * time.Second
}

func (setting *CommunityBotSetting) NormalizedBaseURL() string {
	return strings.TrimRight(strings.TrimSpace(setting.BaseURL), "/")
}

func ParseCommunityLotterySessions(raw string) ([]CommunityLotterySession, error) {
	var sessions []CommunityLotterySession
	if strings.TrimSpace(raw) == "" {
		return sessions, nil
	}
	if err := common.UnmarshalJsonStr(raw, &sessions); err != nil {
		return nil, err
	}
	if err := ValidateCommunityLotterySessions(sessions); err != nil {
		return nil, err
	}
	return sessions, nil
}

func ValidateCommunityLotterySessions(sessions []CommunityLotterySession) error {
	seenKeys := make(map[string]struct{})
	type timeRange struct {
		key   string
		start int
		end   int
	}
	ranges := make([]timeRange, 0, len(sessions))
	for i := range sessions {
		session := &sessions[i]
		session.Key = strings.TrimSpace(session.Key)
		session.Name = strings.TrimSpace(session.Name)
		session.Start = strings.TrimSpace(session.Start)
		session.End = strings.TrimSpace(session.End)
		if session.Key == "" {
			return fmt.Errorf("第 %d 个抽奖场次缺少 key", i+1)
		}
		if _, ok := seenKeys[session.Key]; ok {
			return fmt.Errorf("抽奖场次 key 重复: %s", session.Key)
		}
		seenKeys[session.Key] = struct{}{}
		if session.Name == "" {
			return fmt.Errorf("抽奖场次 %s 缺少名称", session.Key)
		}
		startMinute, err := parseCommunityLotteryClock(session.Start)
		if err != nil {
			return fmt.Errorf("抽奖场次 %s 开始时间无效", session.Key)
		}
		endMinute, err := parseCommunityLotteryClock(session.End)
		if err != nil {
			return fmt.Errorf("抽奖场次 %s 结束时间无效", session.Key)
		}
		if startMinute >= endMinute {
			return fmt.Errorf("抽奖场次 %s 暂不支持跨天或空时间段", session.Key)
		}
		if session.Budget < 0 {
			return fmt.Errorf("抽奖场次 %s 预算不能小于 0", session.Key)
		}
		if len(session.Prizes) == 0 {
			return fmt.Errorf("抽奖场次 %s 至少需要一个奖项", session.Key)
		}
		hasAffordablePrize := false
		for j := range session.Prizes {
			prize := &session.Prizes[j]
			prize.Name = strings.TrimSpace(prize.Name)
			if prize.Name == "" {
				return fmt.Errorf("抽奖场次 %s 第 %d 个奖项缺少名称", session.Key, j+1)
			}
			if prize.Weight <= 0 {
				return fmt.Errorf("抽奖场次 %s 奖项 %s 权重必须大于 0", session.Key, prize.Name)
			}
			if prize.Amount < 0 {
				return fmt.Errorf("抽奖场次 %s 奖项 %s 金额不能小于 0", session.Key, prize.Name)
			}
			if prize.Amount <= session.Budget {
				hasAffordablePrize = true
			}
		}
		if !hasAffordablePrize {
			return fmt.Errorf("抽奖场次 %s 没有预算内可发放奖项", session.Key)
		}
		ranges = append(ranges, timeRange{key: session.Key, start: startMinute, end: endMinute})
	}
	for i := 0; i < len(ranges); i++ {
		for j := i + 1; j < len(ranges); j++ {
			if ranges[i].start < ranges[j].end && ranges[j].start < ranges[i].end {
				return fmt.Errorf("抽奖场次 %s 与 %s 时间重叠", ranges[i].key, ranges[j].key)
			}
		}
	}
	return nil
}

func parseCommunityLotteryClock(clock string) (int, error) {
	if !communityLotteryTimePattern.MatchString(clock) {
		return 0, errors.New("invalid clock")
	}
	parts := strings.Split(clock, ":")
	if len(parts) != 2 {
		return 0, errors.New("invalid clock")
	}
	hour := int(parts[0][0]-'0')*10 + int(parts[0][1]-'0')
	minute := int(parts[1][0]-'0')*10 + int(parts[1][1]-'0')
	return hour*60 + minute, nil
}

func ParseCommunityRedPacketWhitelist(raw string) []string {
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		switch r {
		case ',', '，', ' ', '\n', '\r', '\t', ';', '；':
			return true
		}
		return false
	})
	result := make([]string, 0, len(parts))
	seen := make(map[string]struct{})
	for _, part := range parts {
		name := strings.TrimSpace(part)
		if name == "" {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		result = append(result, name)
	}
	return result
}

func IsCommunityRedPacketCreator(setting *CommunityBotSetting, providerUserIDs ...string) bool {
	whitelist := ParseCommunityRedPacketWhitelist(setting.RedPacketWhitelist)
	if len(whitelist) == 0 {
		return false
	}
	allowed := make(map[string]struct{}, len(whitelist))
	for _, name := range whitelist {
		allowed[strings.ToLower(name)] = struct{}{}
	}
	for _, id := range providerUserIDs {
		key := strings.ToLower(strings.TrimSpace(id))
		if key == "" {
			continue
		}
		if _, ok := allowed[key]; ok {
			return true
		}
	}
	return false
}

func ValidateCommunityRedPacketSetting(setting *CommunityBotSetting) error {
	if setting.RedPacketSplitMode != "random" && setting.RedPacketSplitMode != "average" {
		return errors.New("拆分模式必须是 random 或 average")
	}
	if setting.RedPacketConcurrencyMode != "single" && setting.RedPacketConcurrencyMode != "multiple" {
		return errors.New("并发模式必须是 single 或 multiple")
	}
	if setting.RedPacketExpireMinutes < 0 {
		return errors.New("有效分钟数必须为非负数，0 表示无限期")
	}
	if setting.RedPacketMinTotalAmount < 0 || setting.RedPacketMaxTotalAmount < 0 {
		return errors.New("红包金额上下限必须为非负数")
	}
	if setting.RedPacketMaxTotalAmount < setting.RedPacketMinTotalAmount {
		return errors.New("红包最大总金额不能小于最小总金额")
	}
	if setting.RedPacketMinCount < 1 {
		return errors.New("红包最小份数不能小于 1")
	}
	if setting.RedPacketMaxCount < setting.RedPacketMinCount {
		return errors.New("红包最大份数不能小于最小份数")
	}
	return nil
}
