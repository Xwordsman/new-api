package registrationrisk

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/extensions/registrationrisk/guard"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func Initialize(db *gorm.DB) {
	service.EnablePromotionalFunding()
	model.RegistrationPaymentHook = func(tx *gorm.DB, userID int, provider, payer string) error {
		return guard.MarkSharedPayer(tx, userID, provider, payer, time.Now())
	}
}

func RegisterRoutes(api *gin.RouterGroup) {
	self := api.Group("/extensions/registration-risk", middleware.UserAuth(), middleware.DisableCache())
	self.GET("/credit", selfCredit)
	admin := api.Group("/extensions/registration-risk/admin", middleware.RootAuth(), middleware.DisableCache())
	admin.GET("/settings", getSettings)
	admin.PUT("/settings", middleware.SessionCookieOriginGuard(), middleware.UserCriticalRateLimit("registration-risk-settings"), putSettings)
	admin.GET("/records", records)
	admin.POST("/review", middleware.SessionCookieOriginGuard(), middleware.UserCriticalRateLimit("registration-risk-review"), review)
	admin.POST("/check-alerts", middleware.SessionCookieOriginGuard(), middleware.UserCriticalRateLimit("registration-risk-alerts"), checkAlerts)
}
func respond(c *gin.Context, data any, err error) {
	if err == nil {
		common.ApiSuccess(c, data)
		return
	}
	if guard.IsPolicyError(err) {
		common.ApiError(c, err)
		return
	}
	common.SysError("registration risk: " + err.Error())
	common.ApiErrorT(c, "Registration protection is temporarily unavailable")
}
func getSettings(c *gin.Context) {
	s, err := guard.GetSettings(model.DB.WithContext(c.Request.Context()))
	respond(c, s, err)
}
func putSettings(c *gin.Context) {
	var s guard.Settings
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 131072)
	if common.DecodeJson(c.Request.Body, &s) != nil {
		respond(c, nil, guard.ErrInvalid)
		return
	}
	err := model.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var err error
		s, err = guard.SaveSettings(tx, s)
		if err != nil {
			return err
		}
		return tx.Create(&guard.Audit{CreatedAt: time.Now().Unix(), ActorID: c.GetInt("id"), Action: "settings", Reason: "Policy revision " + strconv.FormatInt(s.Revision, 10)}).Error
	})
	respond(c, s, err)
}
func selfCredit(c *gin.Context) {
	db := model.DB.WithContext(c.Request.Context())
	s, err := guard.GetSettings(db)
	if err != nil {
		respond(c, nil, err)
		return
	}
	var grant guard.Grant
	err = db.Where("user_id = ?", c.GetInt("id")).Take(&grant).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		respond(c, gin.H{"enabled": s.BonusEnabled, "grant": nil}, nil)
		return
	}
	if grant.ExpiresAt <= time.Now().Unix() {
		grant.State = "expired"
	}
	respond(c, gin.H{"enabled": s.BonusEnabled, "grant": grant, "models": s.BonusModels, "rpm": s.BonusRPM, "concurrency": s.BonusConcurrency}, err)
}
func records(c *gin.Context) {
	db := model.DB.WithContext(c.Request.Context())
	page, _ := strconv.Atoi(c.Query("page"))
	page = max(1, min(page, 100000))
	size := 20
	kind := c.DefaultQuery("kind", "events")
	var target any
	switch kind {
	case "events":
		target = &[]guard.Event{}
	case "accounts":
		target = &[]guard.Account{}
	case "grants":
		target = &[]guard.Grant{}
	case "alerts":
		target = &[]guard.Alert{}
	case "audit":
		target = &[]guard.Audit{}
	default:
		respond(c, nil, guard.ErrInvalid)
		return
	}
	q := db.Model(target)
	if id, _ := strconv.Atoi(c.Query("user_id")); id > 0 && kind != "alerts" {
		q = q.Where("user_id = ?", id)
	}
	if state := c.Query("state"); state != "" {
		if kind == "events" {
			q = q.Where("action = ?", state)
		} else if kind == "grants" || kind == "accounts" {
			q = q.Where("state = ?", state)
		}
	}
	if kind == "events" {
		if source := c.Query("source"); source != "" {
			q = q.Where("source = ?", source)
		}
		// Related signals are deliberately restricted to keyed digests and admins.
		for _, key := range []string{"device_hash", "network_hash", "email_hash"} {
			if value := c.Query(key); len(value) == 64 {
				q = q.Where(key+" = ?", value)
			}
		}
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		respond(c, nil, err)
		return
	}
	order := "id DESC"
	if kind == "grants" || kind == "accounts" {
		order = "user_id DESC"
	}
	err := q.Order(order).Limit(size).Offset((page - 1) * size).Find(target).Error
	respond(c, gin.H{"items": target, "total": total, "page": page}, err)
}
func review(c *gin.Context) {
	var body struct {
		UserID  int    `json:"user_id"`
		Approve bool   `json:"approve"`
		Reason  string `json:"reason"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	if common.DecodeJson(c.Request.Body, &body) != nil || body.UserID <= 0 {
		respond(c, nil, guard.ErrInvalid)
		return
	}
	err := guard.Review(model.DB.WithContext(c.Request.Context()), c.GetInt("id"), body.UserID, body.Approve, body.Reason, time.Now())
	respond(c, nil, err)
}
