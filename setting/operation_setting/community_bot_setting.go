package operation_setting

import (
	"strings"
	"time"

	"github.com/QuantumNous/new-api/setting/config"
)

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
	CheckinSuccessReply       string  `json:"checkin_success_reply"`
	CheckinAlreadyReply       string  `json:"checkin_already_reply"`
	CheckinUnboundReply       string  `json:"checkin_unbound_reply"`
	TokenApprovedReply        string  `json:"token_approved_reply"`
	TokenAlreadyApprovedReply string  `json:"token_already_approved_reply"`
	TokenUnboundReply         string  `json:"token_unbound_reply"`
	UnknownErrorReply         string  `json:"unknown_error_reply"`
	TokenBlockPrompt          string  `json:"token_block_prompt"`
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
	CheckinSuccessReply:       "$[sparkle $[rainbow 🎉 恭喜 @{provider_user_id} 领到了{amount}美元！]] $[sparkle $[rainbow 当前余额：{balance}美刀]]",
	CheckinAlreadyReply:       "⏰ @{provider_user_id} 你今天已经签到过啦！明天再来领取奖励吧",
	CheckinUnboundReply:       "请先使用社区账号登录并绑定 new-api 账号。",
	TokenApprovedReply:        "$[border.style=solid,width=3,color=0af,radius=5 $[tada $[fg.color=0af 🔑 令牌授权成功！]]] $[fg.color=0af @{provider_user_id} 你现在可以创建令牌了]",
	TokenAlreadyApprovedReply: "你已经拥有令牌创建权限。",
	TokenUnboundReply:         "请先使用社区账号登录并绑定 new-api 账号。",
	UnknownErrorReply:         "处理失败，请稍后再试。",
	TokenBlockPrompt:          "请先在社区群内发送“创建令牌”完成令牌创建授权。",
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
