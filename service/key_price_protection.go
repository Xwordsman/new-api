package service

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math"
	"net/http"
	"slices"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/extensions/keypricing/policy"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/groupdiscount"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// CaptureTokenGroupPrices captures all concrete Auto groups at one instant.
// The fingerprint binds consent to routing and the account's user group.
func CaptureTokenGroupPrices(db *gorm.DB, token *model.Token, now time.Time) (string, map[string]float64, error) {
	var user model.User
	if err := db.Select("id", "group").Where("id = ?", token.UserId).Take(&user).Error; err != nil {
		return "", nil, err
	}
	routeHash, err := TokenPriceRouteHash(token, user.Group)
	if err != nil {
		return "", nil, err
	}
	groups := []string{token.Group}
	if token.Group == "" {
		groups = []string{user.Group}
	}
	if token.Group == "auto" {
		groups, err = token.GetAutoGroups()
		if err != nil {
			return "", nil, err
		}
		if len(groups) == 0 {
			groups = GetUserAutoGroup(user.Group)
		} else {
			groups = FilterUserTokenAutoGroups(user.Group, groups)
		}
	}
	rates := make(map[string]float64, len(groups))
	discounts := groupdiscount.Default.Capture(now)
	for _, group := range groups {
		if !IsUserSelectableGroup(user.Group, group) {
			continue
		}
		ratio, ok := ratio_setting.GetGroupGroupRatio(user.Group, group)
		if !ok {
			ratio = ratio_setting.GetGroupRatio(group)
		}
		if factor, ok := discounts[group]; ok {
			ratio *= factor
		}
		if ratio < 0 || math.IsNaN(ratio) || math.IsInf(ratio, 0) {
			return "", nil, policy.ErrUnavailable
		}
		rates[group] = ratio
	}
	return routeHash, rates, nil
}

func TokenPriceRouteHash(token *model.Token, userGroup string) (string, error) {
	data, err := common.Marshal([]any{userGroup, token.Group, token.AutoGroups, token.CrossGroupRetry})
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:]), nil
}

// InstallKeyPriceProtection runs once at startup, after extension migrations.
// Both hooks participate in the host token transaction.
func InstallKeyPriceProtection() {
	model.TokenCreatedHook = func(tx *gorm.DB, token *model.Token) error {
		s, err := policy.GetSettings(tx)
		if err != nil {
			return err
		}
		now := time.Now()
		routeHash, rates, err := CaptureTokenGroupPrices(tx, token, now)
		if err != nil {
			return err
		}
		encoded, err := common.Marshal(rates)
		if err != nil {
			return err
		}
		return tx.Create(&policy.State{TokenID: token.Id, UserID: token.UserId, Version: 1, Protected: s.DefaultProtect || !s.AllowOptOut, RouteHash: routeHash, Accepted: string(encoded), AcceptedAt: now.Unix()}).Error
	}
	model.TokenUpdatedHook = func(tx *gorm.DB, previous, token *model.Token) error {
		if previous.Group == token.Group && previous.AutoGroups == token.AutoGroups && previous.CrossGroupRetry == token.CrossGroupRetry {
			return nil
		}
		s, err := policy.GetSettings(tx)
		if err != nil {
			return err
		}
		now := time.Now()
		routeHash, rates, err := CaptureTokenGroupPrices(tx, token, now)
		if err != nil {
			return err
		}
		encoded, err := common.Marshal(rates)
		if err != nil {
			return err
		}
		state, exists, err := policy.ReadState(tx, token.Id, token.UserId)
		if err != nil {
			return err
		}
		protected := s.DefaultProtect || !s.AllowOptOut
		if exists {
			protected = state.Protected
		}
		// An explicit routing edit accepts the selected groups at today's prices.
		// Name/status saves never reach here, so they cannot bypass a price pause.
		updated := policy.State{TokenID: token.Id, UserID: token.UserId, Version: state.Version + 1, Protected: protected, RouteHash: routeHash, Accepted: string(encoded), AcceptedAt: now.Unix()}
		if exists {
			r := tx.Model(&policy.State{}).Where("token_id = ? AND user_id = ? AND version = ?", token.Id, token.UserId, state.Version).Select("*").Updates(&updated)
			if r.Error != nil {
				return r.Error
			}
			if r.RowsAffected != 1 {
				return policy.ErrConflict
			}
		} else if err = tx.Create(&updated).Error; err != nil {
			return err
		}
		return tx.Create(&policy.Event{TokenID: token.Id, UserID: token.UserId, ActorID: token.UserId, CreatedAt: now.Unix(), Action: "accepted", Reason: "group_changed", Revision: s.Revision}).Error
	}
}

// CheckTokenGroupPrice is called before each upstream attempt, including free
// models, tasks and cross-group retries. Admitted streams/tasks settle normally.
func CheckTokenGroupPrice(c *gin.Context, info *relaycommon.RelayInfo, ratio float64) *types.NewAPIError {
	if model.TokenCreatedHook == nil || info.TokenId <= 0 || info.IsChannelTest || info.IsPlayground {
		return nil
	}
	db := model.DB.WithContext(c.Request.Context())
	s, err := policy.GetSettings(db)
	if err == nil && !s.Enabled {
		return nil
	}
	if err == nil {
		var result error
		err = db.Transaction(func(tx *gorm.DB) error {
			token, err := model.GetTokenRouteForUpdate(tx, info.TokenId, info.UserId)
			if err != nil {
				return err
			}
			// A request may have authenticated just before its owner edited the
			// route. Reject that stale attempt without pausing the newly saved Key.
			if group, present := common.GetContextKey(c, constant.ContextKeyTokenGroup); present {
				groups, err := token.GetAutoGroups()
				if err != nil {
					return err
				}
				if group != token.Group || common.GetContextKeyBool(c, constant.ContextKeyTokenCrossGroupRetry) != token.CrossGroupRetry ||
					!slices.Equal(c.GetStringSlice(string(constant.ContextKeyTokenAutoGroups)), groups) {
					return policy.ErrConflict
				}
			}
			routeHash, err := TokenPriceRouteHash(token, info.UserGroup)
			if err != nil {
				return err
			}
			result = policy.Check(tx, s, token.Id, token.UserId, routeHash, info.UsingGroup, ratio, time.Now().Unix())
			if errors.Is(result, policy.ErrPaused) {
				return nil // Commit the pause and its audit event.
			}
			return result
		})
		if err == nil {
			err = result
		}
	}
	if err == nil {
		return nil
	}
	if errors.Is(err, policy.ErrPaused) {
		return types.NewErrorWithStatusCode(errors.New(i18n.T(c, policy.ErrPaused.Key)), types.ErrorCode("key_group_price_paused"), http.StatusForbidden, types.ErrOptionWithSkipRetry())
	}
	common.SysError("key price protection check failed: " + err.Error())
	return types.NewErrorWithStatusCode(errors.New(i18n.T(c, policy.ErrUnavailable.Key)), types.ErrorCode("key_group_price_unavailable"), http.StatusServiceUnavailable, types.ErrOptionWithSkipRetry())
}
