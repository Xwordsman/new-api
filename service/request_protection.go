package service

import (
	"context"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/extensions/requestprotection/policy"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
)

var requestProtectionInstalled atomic.Bool

// Retain uncommitted provider evidence across client disconnects and transient
// storage failures. A process with pending evidence cannot forward new calls.
var pendingProtectionSafety sync.Map

type pendingSafety struct {
	settings     policy.Settings
	input        policy.Input
	code, secret string
	now          int64
}

func InstallRequestProtection() { requestProtectionInstalled.Store(true) }

// CheckRequestProtection never changes billing or credential state. The marker
// is bound to the logical request/model/group, not a connection or retry index.
func CheckRequestProtection(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	if !requestProtectionInstalled.Load() || model.DB == nil || info.UserId <= 0 || info.IsChannelTest {
		return nil
	}
	db := model.DB.WithContext(c.Request.Context())
	s, err := policy.GetSettings(db)
	if err != nil {
		return requestProtectionUnavailable(c, true, err)
	}
	c.Set("request-protection-settings", s)
	if !s.Enabled {
		return nil
	}
	channelID, businessBase := info.GetChannelID(), ""
	if info.ChannelMeta != nil {
		businessBase = info.ChannelBaseUrl
	}
	if selected := common.GetContextKeyInt(c, constant.ContextKeyChannelId); selected > 0 {
		channelID, businessBase = selected, common.GetContextKeyString(c, constant.ContextKeyChannelBaseUrl)
	}
	marker := "request-protection:" + info.RequestId + ":" + info.OriginModelName + ":" + info.UsingGroup + ":" + strconv.Itoa(channelID) + ":" + strconv.FormatInt(s.Revision, 10)
	var pendingErr error
	pendingProtectionSafety.Range(func(key, value any) bool {
		item := value.(pendingSafety)
		_, pendingErr = policy.RecordSafety(db, item.settings, item.input, item.code, item.secret, item.now)
		if pendingErr == nil {
			pendingProtectionSafety.Delete(key)
		}
		return pendingErr == nil
	})
	if pendingErr != nil {
		return requestProtectionUnavailable(c, true, pendingErr)
	}
	now := time.Now().Unix()
	in := policy.Input{ChannelID: channelID, IP: c.ClientIP(), UserID: info.UserId, TokenID: info.TokenId, RequestID: info.RequestId, Group: info.UsingGroup, Model: info.OriginModelName, Protocol: string(info.RelayFormat)}
	if in.RequestID == "" {
		in.RequestID = c.GetString(common.RequestIdKey)
	}
	if s.Mode == "enforce" && !slices.Contains(s.ExemptUserIDs, in.UserID) {
		until, e := policy.ActiveRestriction(db, in.UserID, in.TokenID, now)
		if e != nil {
			return requestProtectionUnavailable(c, s.FailClosed, e)
		}
		if until > now {
			if until != policy.ManualHoldUntil {
				c.Header("Retry-After", strconv.FormatInt(until-now, 10))
			}
			return types.NewErrorWithStatusCode(errors.New(i18n.T(c, "request_protection.restricted")), types.ErrorCode("request_protection_restricted"), http.StatusForbidden, types.ErrOptionWithSkipRetry())
		}
	}
	// Restrictions are deliberately checked again even after this request's
	// content was inspected: another in-flight call may have created a hold.
	if done, _ := c.Get(marker); done == true {
		return nil
	}
	// Channel-scoped requests are checked after routing, before the selected
	// channel is invoked. Do not apply a protected channel's policy to others.
	if in.ChannelID == 0 && (len(s.ChannelIDs) > 0 || s.Reviewer.Enabled) {
		return nil
	}
	// Auto routing is checked conservatively against any selectable scoped
	// group before a channel can be selected or any credit can be reserved.
	if in.Group == "auto" && len(s.Groups) > 0 {
		groups := GetUserAutoGroup(info.UserGroup)
		for _, group := range groups {
			if slices.Contains(s.Groups, group) {
				in.Group = group
				break
			}
		}
	}
	if !policy.InScope(s, in) {
		c.Set(marker, true)
		return nil
	}
	if info.RelayFormat == types.RelayFormatOpenAIRealtime {
		in.Uninspected = "realtime_uninspected"
	} else {
		storage, e := common.GetBodyStorage(c)
		if e != nil {
			return requestProtectionUnavailable(c, s.FailClosed, e)
		}
		if storage.Size() > int64(s.MaxBodyBytes) {
			in.Uninspected = "body_limit"
		} else {
			reader, e := storage.NewReader()
			if e != nil {
				return requestProtectionUnavailable(c, s.FailClosed, e)
			}
			defer reader.Close()
			media, params, _ := mime.ParseMediaType(c.Request.Header.Get("Content-Type"))
			if media == "multipart/form-data" {
				parts := multipart.NewReader(reader, params["boundary"])
				remaining := int64(s.MaxTextBytes)
				for {
					part, e := parts.NextPart()
					if e == io.EOF {
						break
					}
					if e != nil {
						in.Uninspected = "unsupported_payload"
						break
					}
					if part.FileName() != "" {
						if in.Uninspected == "" {
							in.Uninspected = "binary_media"
						}
						part.Close()
						continue
					}
					if !slices.Contains([]string{"prompt", "negative_prompt", "input", "text"}, part.FormName()) {
						part.Close()
						continue
					}
					text, e := io.ReadAll(io.LimitReader(part, remaining+1))
					part.Close()
					if e != nil {
						return requestProtectionUnavailable(c, s.FailClosed, e)
					}
					if int64(len(text)) > remaining {
						in.Uninspected = "text_limit"
						break
					}
					remaining -= int64(len(text))
					in.Segments = append(in.Segments, policy.Segment{Source: "current", Text: string(text)})
				}
			} else {
				body, e := io.ReadAll(io.LimitReader(reader, int64(s.MaxBodyBytes)+1))
				if e != nil {
					return requestProtectionUnavailable(c, s.FailClosed, e)
				}
				in.Segments, in.Uninspected = policy.Extract(body, in.Protocol)
			}
		}
	}
	v := policy.Inspect(s, in, common.SessionSecret)
	c.Set("request-protection-input", in)
	if in.ChannelID > 0 {
		v = ReviewRequestProtection(c.Request.Context(), s, in, v, businessBase)
	}
	result, err := policy.Record(db, s, in, v, common.SessionSecret, now)
	if err != nil {
		return requestProtectionUnavailable(c, s.FailClosed, err)
	}
	if result.EventID > 0 {
		c.Set("request-protection-event:"+info.RequestId, result.EventID)
	}
	if result.Decision == "block" {
		if result.Finding == "check_failed" || result.Finding == "review_needed" {
			return types.NewErrorWithStatusCode(errors.New(i18n.T(c, "request_protection.review_required")), types.ErrorCode("request_protection_review_required"), http.StatusServiceUnavailable, types.ErrOptionWithSkipRetry())
		}
		RequestPolicy(c).AddEvent(PolicyEvent{ErrorCode: "request_protection_blocked", ErrorSource: "local", Decision: PolicyDecision{Action: "stop", Reason: "local_rejection", Source: "request_protection"}, Health: "unchanged"})
		return types.NewErrorWithStatusCode(errors.New(i18n.T(c, "request_protection.blocked")), types.ErrorCode("request_protection_blocked"), http.StatusForbidden, types.ErrOptionWithSkipRetry())
	}
	c.Set(marker, true)
	return nil
}

func requestProtectionUnavailable(c *gin.Context, failClosed bool, err error) *types.NewAPIError {
	common.SysError("request protection check failed: " + err.Error())
	if !failClosed {
		return nil
	}
	return types.NewErrorWithStatusCode(errors.New(i18n.T(c, "request_protection.unavailable")), types.ErrorCode("request_protection_unavailable"), http.StatusServiceUnavailable, types.ErrOptionWithSkipRetry())
}

// Attempted means the transport was invoked, not that a provider received bytes.
func MarkRequestProtectionForwarded(c *gin.Context, info *relaycommon.RelayInfo) {
	if !requestProtectionInstalled.Load() || model.DB == nil || info == nil {
		return
	}
	value, ok := c.Get("request-protection-event:" + info.RequestId)
	if !ok {
		return
	}
	id, ok := value.(int64)
	if !ok || id <= 0 {
		return
	}
	if err := model.DB.WithContext(c.Request.Context()).Model(&policy.Event{}).Where("id = ?", id).Updates(map[string]any{"upstream": "attempted", "channel_id": info.GetChannelID()}).Error; err != nil {
		common.SysError("request protection forwarding audit failed: " + err.Error())
	}
}

// Structured upstream codes may trigger a protective manual hold. Refusal
// prose, generic statuses and client-supplied safety fields are not evidence.
func RecordRequestProtectionSafety(c *gin.Context, info *relaycommon.RelayInfo, code string) {
	if !requestProtectionInstalled.Load() || model.DB == nil || info == nil || info.UserId <= 0 || info.IsChannelTest {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(c.Request.Context()), 5*time.Second)
	defer cancel()
	db := model.DB.WithContext(ctx)
	// Preserve the policy that admitted the request, including when storage
	// becomes unavailable before its upstream response arrives.
	value, _ := c.Get("request-protection-settings")
	s, ok := value.(policy.Settings)
	var err error
	if !ok {
		s, err = policy.GetSettings(db)
	}
	if err != nil {
		common.SysError("request protection upstream policy unavailable: " + err.Error())
		return
	}
	if !s.Enabled {
		return
	}
	code = policy.SafetyCode(s, code)
	if code == "" {
		return
	}
	in := policy.Input{ChannelID: info.GetChannelID(), IP: c.ClientIP(), UserID: info.UserId, TokenID: info.TokenId, RequestID: info.RequestId + ":upstream:" + code, Model: info.OriginModelName, Group: info.UsingGroup, Protocol: string(info.RelayFormat)}
	if value, exists := c.Get("request-protection-input"); exists {
		if inspected, valid := value.(policy.Input); valid {
			in.Segments, in.Uninspected = inspected.Segments, inspected.Uninspected
		}
	}
	if !policy.InScope(s, in) {
		return
	}
	item := pendingSafety{settings: s, input: in, code: code, secret: common.SessionSecret, now: time.Now().Unix()}
	key := policy.Digest(item.secret, "pending-upstream", in.RequestID+":"+strconv.Itoa(in.UserID))
	pendingProtectionSafety.Store(key, item)
	_, err = policy.RecordSafety(db, s, in, code, item.secret, item.now)
	if err != nil {
		common.SysError("request protection upstream audit failed: " + err.Error())
	} else {
		pendingProtectionSafety.Delete(key)
	}
}

func requestProtectionErrorCode(err *types.NewAPIError) string {
	if err == nil || RelayErrorSource(err) != "upstream" {
		return ""
	}
	codes := []string{string(err.GetErrorCode())}
	switch upstream := err.RelayError.(type) {
	case types.OpenAIError:
		code, _ := upstream.Code.(string)
		codes = append(codes, code, upstream.Type)
	case types.ClaudeError:
		codes = append(codes, upstream.Type)
	}
	s := policy.Defaults()
	if requestProtectionInstalled.Load() && model.DB != nil {
		if saved, e := policy.GetSettings(model.DB); e == nil {
			s = saved
		}
	}
	return policy.SafetyCode(s, codes...)
}

func ObserveRequestProtectionSafety(c *gin.Context, info *relaycommon.RelayInfo, data string) {
	// The fast path avoids decoding every normal streaming token.
	if !requestProtectionInstalled.Load() || (!strings.Contains(data, `"error"`) && !strings.Contains(data, `"finish_reason"`)) {
		return
	}
	type upstreamError struct {
		Code string `json:"code"`
		Type string `json:"type"`
	}
	var event struct {
		Type     string         `json:"type"`
		Code     string         `json:"code"`
		Error    *upstreamError `json:"error"`
		Response *struct {
			Error *upstreamError `json:"error"`
		} `json:"response"`
		Choices []struct {
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
	}
	if common.UnmarshalJsonStr(data, &event) != nil {
		return
	}
	if event.Error != nil {
		RecordRequestProtectionSafety(c, info, event.Error.Code)
		RecordRequestProtectionSafety(c, info, event.Error.Type)
	}
	if event.Response != nil && event.Response.Error != nil {
		RecordRequestProtectionSafety(c, info, event.Response.Error.Code)
		RecordRequestProtectionSafety(c, info, event.Response.Error.Type)
	}
	if event.Type == "error" {
		RecordRequestProtectionSafety(c, info, event.Code)
	}
	for _, choice := range event.Choices {
		if choice.FinishReason == "content_filter" {
			RecordRequestProtectionSafety(c, info, "content_filter")
		}
	}
}
