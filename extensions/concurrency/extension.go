package concurrency

import (
	"errors"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/extensions/concurrency/policy"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func RegisterRoutes(api *gin.RouterGroup) {
	admin := api.Group("/extensions/concurrency/admin", middleware.RootAuth(), middleware.DisableCache())
	admin.GET("/settings", getSettings)
	admin.PUT("/settings", middleware.StrictSessionCookieOriginGuard(), middleware.UserCriticalRateLimit("concurrency-settings"), putSettings)
	admin.GET("/status", status)
}

func respond(c *gin.Context, data any, err error) {
	if err == nil {
		common.ApiSuccess(c, data)
		return
	}
	if errors.Is(err, policy.ErrInvalid) || errors.Is(err, policy.ErrConflict) {
		common.ApiError(c, err)
		return
	}
	common.SysError("concurrency management: " + err.Error())
	common.ApiError(c, policy.ErrUnavailable)
}

func getSettings(c *gin.Context) {
	s, err := policy.ReadSettings(model.DB.WithContext(c.Request.Context()))
	respond(c, s, err)
}

func putSettings(c *gin.Context) {
	var s policy.Settings
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	if common.DecodeJson(c.Request.Body, &s) != nil {
		respond(c, nil, policy.ErrInvalid)
		return
	}
	s, err := policy.SaveSettings(model.DB.WithContext(c.Request.Context()), s)
	respond(c, s, err)
}

func status(c *gin.Context) {
	store, err := policy.CurrentStore()
	if err != nil {
		respond(c, nil, err)
		return
	}
	rows, err := store.Snapshot(c.Request.Context())
	mode := "memory"
	if common.RedisEnabled {
		mode = "redis"
	}
	respond(c, gin.H{"mode": mode, "items": rows, "max_items": 1000}, err)
}
