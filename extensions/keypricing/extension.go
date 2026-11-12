package keypricing

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/extensions/keypricing/policy"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func RegisterRoutes(api *gin.RouterGroup) {
	self := api.Group("/extensions/key-price", middleware.UserAuth(), middleware.DisableCache())
	self.GET("/status", statuses)
	self.GET("/keys/:id", detail)
	self.POST("/keys/:id/quote", middleware.StrictSessionCookieOriginGuard(), middleware.UserCriticalRateLimit("key-price-quote"), makeQuote)
	self.POST("/keys/:id/accept", middleware.StrictSessionCookieOriginGuard(), middleware.UserCriticalRateLimit("key-price-accept"), acceptQuote)
	admin := api.Group("/extensions/key-price/admin", middleware.RootAuth(), middleware.DisableCache())
	admin.GET("/settings", getSettings)
	admin.PUT("/settings", middleware.StrictSessionCookieOriginGuard(), middleware.UserCriticalRateLimit("key-price-settings"), putSettings)
	admin.GET("/events", events)
}

func respond(c *gin.Context, data any, err error) {
	if err == nil {
		common.ApiSuccess(c, data)
		return
	}
	if policy.IsPolicyError(err) {
		common.ApiError(c, err)
		return
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		common.ApiErrorT(c, "API key not found")
		return
	}
	common.SysError("key price protection: " + err.Error())
	common.ApiError(c, policy.ErrUnavailable)
}

func ownedToken(c *gin.Context, db *gorm.DB) (*model.Token, error) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		return nil, policy.ErrInvalid
	}
	var token model.Token
	err = db.Where("id = ? AND user_id = ?", id, c.GetInt("id")).Take(&token).Error
	return &token, err
}

func getSettings(c *gin.Context) {
	s, err := policy.GetSettings(model.DB.WithContext(c.Request.Context()))
	respond(c, s, err)
}

func putSettings(c *gin.Context) {
	var s policy.Settings
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16384)
	if common.DecodeJson(c.Request.Body, &s) != nil {
		respond(c, nil, policy.ErrInvalid)
		return
	}
	s, err := policy.SaveSettings(model.DB.WithContext(c.Request.Context()), s, c.GetInt("id"), time.Now().Unix())
	respond(c, s, err)
}

func statuses(c *gin.Context) {
	db := model.DB.WithContext(c.Request.Context())
	ids := []int{}
	for item := range strings.SplitSeq(c.Query("ids"), ",") {
		id, err := strconv.Atoi(item)
		if err != nil || id <= 0 || len(ids) >= 100 {
			respond(c, nil, policy.ErrInvalid)
			return
		}
		ids = append(ids, id)
	}
	var tokens []model.Token
	if err := db.Select("id").Where("user_id = ? AND id IN ?", c.GetInt("id"), ids).Find(&tokens).Error; err != nil {
		respond(c, nil, err)
		return
	}
	owned := make([]int, 0, len(tokens))
	for _, token := range tokens {
		owned = append(owned, token.Id)
	}
	var states []policy.State
	if err := db.Where("user_id = ? AND token_id IN ?", c.GetInt("id"), owned).Find(&states).Error; err != nil {
		respond(c, nil, err)
		return
	}
	s, err := policy.GetSettings(db)
	respond(c, gin.H{"settings": s, "states": states}, err)
}

func detail(c *gin.Context) {
	db := model.DB.WithContext(c.Request.Context())
	token, err := ownedToken(c, db)
	if err != nil {
		respond(c, nil, err)
		return
	}
	s, err := policy.GetSettings(db)
	if err != nil {
		respond(c, nil, err)
		return
	}
	state, exists, err := policy.ReadState(db, token.Id, token.UserId)
	if err != nil {
		respond(c, nil, err)
		return
	}
	_, rates, err := service.CaptureTokenGroupPrices(db, token, time.Now())
	if err != nil {
		respond(c, nil, err)
		return
	}
	var accepted map[string]float64
	if exists {
		err = common.UnmarshalJsonStr(state.Accepted, &accepted)
	}
	if err != nil {
		respond(c, nil, err)
		return
	}
	log := []policy.Event{}
	err = db.Where("token_id = ? AND user_id = ?", token.Id, token.UserId).Order("id DESC").Limit(20).Find(&log).Error
	respond(c, gin.H{"settings": s, "state": state, "tracked": exists, "accepted": accepted, "current": rates, "events": log}, err)
}

func makeQuote(c *gin.Context) {
	db := model.DB.WithContext(c.Request.Context())
	token, err := ownedToken(c, db)
	if err != nil {
		respond(c, nil, err)
		return
	}
	s, err := policy.GetSettings(db)
	if err != nil {
		respond(c, nil, err)
		return
	}
	state, exists, err := policy.ReadState(db, token.Id, token.UserId)
	if err != nil {
		respond(c, nil, err)
		return
	}
	now := time.Now()
	routeHash, rates, err := service.CaptureTokenGroupPrices(db, token, now)
	if err != nil {
		respond(c, nil, err)
		return
	}
	if len(rates) == 0 {
		respond(c, nil, policy.ErrUnavailable)
		return
	}
	encoded, err := common.Marshal(rates)
	if err != nil {
		respond(c, nil, err)
		return
	}
	nonce := make([]byte, 32)
	if _, err = rand.Read(nonce); err != nil {
		respond(c, nil, err)
		return
	}
	raw := hex.EncodeToString(nonce)
	digest := sha256.Sum256([]byte(raw))
	quote := policy.Quote{Hash: hex.EncodeToString(digest[:]), TokenID: token.Id, UserID: token.UserId, StateVersion: state.Version, SettingsRevision: s.Revision, RouteHash: routeHash, Rates: string(encoded), ExpiresAt: now.Unix() + int64(s.QuoteTTLSeconds)}
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("expires_at <= ?", now.Unix()).Delete(&policy.Quote{}).Error; err != nil {
			return err
		}
		// One active quote per Key bounds storage and invalidates stale dialogs.
		if err := tx.Where("token_id = ? AND user_id = ?", token.Id, token.UserId).Delete(&policy.Quote{}).Error; err != nil {
			return err
		}
		return tx.Create(&quote).Error
	})
	protected := state.Protected
	if !exists {
		protected = s.DefaultProtect
	}
	respond(c, gin.H{"quote": raw, "rates": rates, "expires_at": quote.ExpiresAt, "settings": s, "protected": protected || !s.AllowOptOut}, err)
}

func acceptQuote(c *gin.Context) {
	var input struct {
		Quote     string `json:"quote"`
		Protected *bool  `json:"protected"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	if common.DecodeJson(c.Request.Body, &input) != nil || len(input.Quote) != 64 || input.Protected == nil {
		respond(c, nil, policy.ErrInvalid)
		return
	}
	digest := sha256.Sum256([]byte(input.Quote))
	var result policy.State
	err := model.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		token, err := ownedToken(c, tx)
		if err != nil {
			return err
		}
		s, err := policy.GetSettings(tx)
		if err != nil {
			return err
		}
		if !*input.Protected && !s.AllowOptOut {
			return policy.ErrOptOut
		}
		var quote policy.Quote
		err = tx.Where("hash = ? AND token_id = ? AND user_id = ?", hex.EncodeToString(digest[:]), token.Id, token.UserId).Take(&quote).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return policy.ErrConflict
		}
		if err != nil {
			return err
		}
		now := time.Now()
		if quote.ExpiresAt <= now.Unix() || quote.SettingsRevision != s.Revision {
			return policy.ErrConflict
		}
		state, exists, err := policy.ReadState(tx, token.Id, token.UserId)
		if err != nil {
			return err
		}
		if quote.StateVersion != state.Version {
			return policy.ErrConflict
		}
		routeHash, rates, err := service.CaptureTokenGroupPrices(tx, token, now)
		if err != nil {
			return err
		}
		encoded, err := common.Marshal(rates)
		if err != nil {
			return err
		}
		if routeHash != quote.RouteHash || string(encoded) != quote.Rates {
			return policy.ErrConflict
		}
		consumed := tx.Where("hash = ?", quote.Hash).Delete(&policy.Quote{})
		if consumed.Error != nil {
			return consumed.Error
		}
		if consumed.RowsAffected != 1 {
			return policy.ErrConflict
		}
		result = policy.State{TokenID: token.Id, UserID: token.UserId, Version: state.Version + 1, Protected: *input.Protected, RouteHash: routeHash, Accepted: quote.Rates, AcceptedAt: now.Unix()}
		if exists {
			r := tx.Model(&policy.State{}).Where("token_id = ? AND user_id = ? AND version = ?", token.Id, token.UserId, state.Version).Select("*").Updates(&result)
			if r.Error != nil {
				return r.Error
			}
			if r.RowsAffected != 1 {
				return policy.ErrConflict
			}
		} else if err = tx.Create(&result).Error; err != nil {
			return err
		}
		action := "accepted"
		if !result.Protected {
			action = "opted_out"
		}
		return tx.Create(&policy.Event{TokenID: token.Id, UserID: token.UserId, ActorID: token.UserId, CreatedAt: now.Unix(), Action: action, Revision: s.Revision}).Error
	})
	respond(c, result, err)
}

func events(c *gin.Context) {
	db := model.DB.WithContext(c.Request.Context())
	page, _ := strconv.Atoi(c.Query("page"))
	page = max(1, min(page, 100000))
	q := db.Model(&policy.Event{})
	if id, _ := strconv.Atoi(c.Query("token_id")); id > 0 {
		q = q.Where("token_id = ?", id)
	}
	if id, _ := strconv.Atoi(c.Query("user_id")); id > 0 {
		q = q.Where("user_id = ?", id)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		respond(c, nil, err)
		return
	}
	rows := []policy.Event{}
	err := q.Order("id DESC").Offset((page - 1) * 20).Limit(20).Find(&rows).Error
	respond(c, gin.H{"items": rows, "total": total, "page": page}, err)
}
