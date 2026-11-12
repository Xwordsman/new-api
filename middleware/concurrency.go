package middleware

import (
	"context"
	"errors"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/extensions/concurrency/policy"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const concurrencyRequestKey = "extension_concurrency_request"

func concurrencyError(c *gin.Context, err error) *types.NewAPIError {
	status, code, message := http.StatusServiceUnavailable, "concurrency_unavailable", i18n.MsgConcurrencyUnavailable
	switch {
	case errors.Is(err, policy.ErrUserBusy):
		status, code, message = http.StatusTooManyRequests, "user_concurrency_exceeded", i18n.MsgConcurrencyUserLimit
	case errors.Is(err, policy.ErrChannelBusy):
		status, code, message = http.StatusTooManyRequests, "channel_concurrency_exceeded", i18n.MsgConcurrencyChannelLimit
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		status, code, message = http.StatusRequestTimeout, "request_cancelled", i18n.MsgConcurrencyRequestCanceled
	}
	if status == http.StatusTooManyRequests {
		c.Header("Retry-After", "1")
	}
	return types.NewErrorWithStatusCode(errors.New(i18n.T(c, message)), types.ErrorCode(code), status, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
}

// AdmitConcurrency is invoked after authentication and before channel selection
// or pre-consumption. The returned cleanup must span the entire relay handler.
func AdmitConcurrency(c *gin.Context) (func(), *types.NewAPIError) {
	if _, exists := c.Get(concurrencyRequestKey); exists {
		return func() {}, nil
	}
	s, err := policy.CachedSettings()
	if err != nil {
		return nil, concurrencyError(c, err)
	}
	if !s.Enabled {
		return func() {}, nil
	}
	userID := common.GetContextKeyInt(c, constant.ContextKeyUserId)
	if userID <= 0 {
		return nil, concurrencyError(c, policy.ErrUnavailable)
	}
	store, err := policy.CurrentStore()
	if err != nil {
		return nil, concurrencyError(c, err)
	}
	r, err := policy.Admit(c.Request.Context(), store, s, userID, common.GetContextKeyString(c, constant.ContextKeyUserGroup))
	if err != nil {
		return nil, concurrencyError(c, err)
	}
	c.Set(concurrencyRequestKey, r)
	c.Request = c.Request.WithContext(r.Context())
	return r.Close, nil
}

// Responses WebSocket runs this once per response.create, rather than charging
// an idle connection against the account's active generation limit.
func ConcurrencyRequest() gin.HandlerFunc {
	return func(c *gin.Context) {
		closeRequest, err := AdmitConcurrency(c)
		if err != nil {
			abortWithOpenAiMessage(c, err.StatusCode, err.Error(), err.GetErrorCode())
			return
		}
		defer closeRequest()
		c.Next()
	}
}

func ReserveChannelConcurrency(c *gin.Context, channel *model.Channel, key string) *types.NewAPIError {
	value, exists := c.Get(concurrencyRequestKey)
	if !exists {
		return nil
	}
	if err := value.(*policy.Request).ReserveChannel(channel.Id, key, channel.ChannelInfo.IsMultiKey); err != nil {
		return concurrencyError(c, err)
	}
	return nil
}

func concurrencyKey(c *gin.Context, channel *model.Channel) (string, int, *types.NewAPIError) {
	key, index, err := channel.GetNextEnabledKey()
	if err != nil {
		return "", 0, err
	}
	admissionErr := ReserveChannelConcurrency(c, channel, key)
	if admissionErr == nil {
		return key, index, nil
	}
	if admissionErr.GetErrorCode() != "channel_concurrency_exceeded" || !channel.ChannelInfo.IsMultiKey {
		return "", 0, admissionErr
	}
	lock := model.GetChannelPollingLock(channel.Id)
	lock.Lock()
	keys := channel.GetKeys()
	enabled := make([]int, 0, len(keys))
	for offset := 1; offset < len(keys); offset++ {
		next := (index + offset) % len(keys)
		status, exists := channel.ChannelInfo.MultiKeyStatusList[next]
		if !exists || status == common.ChannelStatusEnabled {
			enabled = append(enabled, next)
		}
	}
	lock.Unlock()
	for _, next := range enabled {
		admissionErr = ReserveChannelConcurrency(c, channel, keys[next])
		if admissionErr == nil {
			return keys[next], next, nil
		}
		if admissionErr.GetErrorCode() != "channel_concurrency_exceeded" {
			return "", 0, admissionErr
		}
	}
	return "", 0, admissionErr
}

// SelectAndSetupChannel keeps all existing pin, model, protocol, and affinity
// restrictions. Temporary capacity exclusions are local to this selection;
// saturation neither disables channels nor consumes an upstream retry.
func SelectAndSetupChannel(c *gin.Context, modelName string, retry *service.RetryParam, first *model.Channel) (*model.Channel, string, *types.NewAPIError) {
	constraints := service.GetChannelConstraints(c)
	original := constraints.Filters
	defer func() { constraints.Filters = original }()
	excluded := []int{}
	group := retry.TokenGroup
	for range 1000 {
		channel := first
		first = nil
		if channel == nil {
			var selectErr *service.ChannelSelectError
			channel, group, selectErr = service.SelectChannelForRequest(c, modelName, retry)
			if selectErr != nil {
				if selectErr.FilterKind == dto.FilterTaskPluginIdentity {
					logTaskPluginChannelDecision(c, selectErr.Channel, modelName, "channel_rejected", "identity_mismatch")
				}
				if len(excluded) > 0 && selectErr.NoAvailableChannel {
					return nil, group, concurrencyError(c, policy.ErrChannelBusy)
				}
				message := selectErr.Message
				if selectErr.NoAvailableChannel {
					message = noAvailableChannelMessage(c, retry.TokenGroup, modelName)
				} else if selectErr.MessageID != "" {
					message = i18n.T(c, selectErr.MessageID, selectErr.Params)
				}
				code := selectErr.Code
				if code == "" {
					code = types.ErrorCodeGetChannelFailed
				}
				return nil, group, types.NewErrorWithStatusCode(errors.New(message), code, selectErr.StatusCode, types.ErrOptionWithSkipRetry())
			}
		}
		setupErr := SetupContextForSelectedChannel(c, channel, modelName)
		if setupErr == nil {
			return channel, group, nil
		}
		if setupErr.GetErrorCode() != "channel_concurrency_exceeded" {
			return nil, group, setupErr
		}
		_, pinned, _ := constraints.ResolvedPin()
		if pinned || service.RequestPolicy(c).SessionMode == "strict" {
			return nil, group, setupErr
		}
		excluded = append(excluded, channel.Id)
		constraints.Filters = append(append([]dto.ChannelFilter{}, original...), dto.ChannelFilter{Kind: dto.FilterExcludedChannels, ChannelIDs: excluded})
	}
	return nil, group, concurrencyError(c, policy.ErrChannelBusy)
}
