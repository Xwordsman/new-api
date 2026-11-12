package service

import (
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/extensions/requestprotection/policy"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
)

var requestProtectionInstalled atomic.Bool

func InstallRequestProtection() { requestProtectionInstalled.Store(true) }

// CheckRequestProtection never changes billing or credential state. The marker
// is bound to the logical request/model/group, not a connection or retry index.
func CheckRequestProtection(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	if !requestProtectionInstalled.Load() || model.DB == nil || info.UserId <= 0 || info.IsChannelTest {
		return nil
	}
	marker := "request-protection:" + info.RequestId + ":" + info.OriginModelName + ":" + info.UsingGroup
	if done, _ := c.Get(marker); done == true {
		return nil
	}
	db := model.DB.WithContext(c.Request.Context())
	s, err := policy.GetSettings(db)
	if err != nil {
		return requestProtectionUnavailable(c, true, err)
	}
	if !s.Enabled {
		return nil
	}
	now := time.Now().Unix()
	in := policy.Input{UserID: info.UserId, TokenID: info.TokenId, RequestID: info.RequestId, Group: info.UsingGroup, Model: info.OriginModelName, Protocol: string(info.RelayFormat)}
	if in.RequestID == "" {
		in.RequestID = c.GetString(common.RequestIdKey)
	}
	if s.Mode == "enforce" && !slices.Contains(s.ExemptUserIDs, in.UserID) {
		until, e := policy.ActiveRestriction(db, in.UserID, in.TokenID, now)
		if e != nil {
			return requestProtectionUnavailable(c, s.FailClosed, e)
		}
		if until > now {
			c.Header("Retry-After", strconv.FormatInt(until-now, 10))
			return types.NewErrorWithStatusCode(errors.New(i18n.T(c, "request_protection.restricted")), types.ErrorCode("request_protection_restricted"), http.StatusForbidden, types.ErrOptionWithSkipRetry())
		}
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
						in.Uninspected = "binary_media"
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
	result, err := policy.Record(db, s, in, v, common.SessionSecret, now)
	if err != nil {
		return requestProtectionUnavailable(c, s.FailClosed, err)
	}
	if result.EventID > 0 {
		c.Set("request-protection-event:"+info.RequestId, result.EventID)
	}
	if result.Decision == "block" {
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
	if err := model.DB.WithContext(c.Request.Context()).Model(&policy.Event{}).Where("id = ? AND upstream = ?", id, "not_sent").Update("upstream", "attempted").Error; err != nil {
		common.SysError("request protection forwarding audit failed: " + err.Error())
	}
}

// Structured upstream codes are review evidence only. Refusal prose, generic
// HTTP statuses and client-supplied safety fields never increment penalties.
func RecordRequestProtectionSafety(c *gin.Context, info *relaycommon.RelayInfo, code string) {
	if !requestProtectionInstalled.Load() || model.DB == nil || info == nil || info.UserId <= 0 || info.IsChannelTest {
		return
	}
	s, err := policy.GetSettings(model.DB)
	if err != nil || !s.Enabled || !slices.Contains(s.UpstreamCodes, code) {
		return
	}
	in := policy.Input{UserID: info.UserId, TokenID: info.TokenId, RequestID: info.RequestId + ":upstream:" + code, Model: info.OriginModelName, Group: info.UsingGroup, Protocol: string(info.RelayFormat)}
	if !policy.InScope(s, in) {
		return
	}
	v := policy.Verdict{Decision: "observe", Digest: policy.Digest(common.SessionSecret, "upstream-code", fmt.Sprintf("%d:%s:%s", in.UserID, info.RequestId, code)), Hits: []policy.Hit{{RuleID: "upstream_safety", Name: code, Source: "upstream", Action: "observe"}}}
	result, err := policy.Record(model.DB.WithContext(c.Request.Context()), s, in, v, common.SessionSecret, time.Now().Unix())
	if err == nil && result.EventID > 0 {
		err = model.DB.Model(&policy.Event{}).Where("id = ?", result.EventID).Update("upstream", "responded").Error
	}
	if err != nil {
		common.SysError("request protection upstream audit failed: " + err.Error())
	}
}

func ObserveRequestProtectionSafety(c *gin.Context, info *relaycommon.RelayInfo, data string) {
	// The fast path avoids decoding every normal streaming token.
	if !requestProtectionInstalled.Load() || (!strings.Contains(data, `"error"`) && !strings.Contains(data, `"content_filter_results"`)) {
		return
	}
	var event struct {
		Error *struct {
			Code string `json:"code"`
			Type string `json:"type"`
		} `json:"error"`
	}
	if common.UnmarshalJsonStr(data, &event) != nil || event.Error == nil {
		return
	}
	if event.Error.Code != "" {
		RecordRequestProtectionSafety(c, info, event.Error.Code)
	} else {
		RecordRequestProtectionSafety(c, info, event.Error.Type)
	}
}
