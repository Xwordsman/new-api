package redemptionshop

import (
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func RegisterRoutes(api *gin.RouterGroup) {
	admin := api.Group("/extensions/redemption-stores/admin", middleware.RootAuth(), middleware.DisableCache())
	admin.GET("/settings", getSettings)
	admin.PUT("/settings", middleware.StrictSessionCookieOriginGuard(), middleware.UserCriticalRateLimit("redemption-store-settings"), putSettings)
}

func respond(c *gin.Context, data any, err error) {
	if err == nil {
		common.ApiSuccess(c, data)
		return
	}
	var message *common.Message
	if errors.As(err, &message) {
		common.ApiError(c, message)
		return
	}
	common.SysError("redemption stores: settings operation failed")
	common.ApiErrorT(c, "Redemption stores are temporarily unavailable")
}

func getSettings(c *gin.Context) {
	s, _, err := readSettings(model.DB.WithContext(c.Request.Context()))
	respond(c, s, err)
}

func putSettings(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxSettingsSize)
	body, err := io.ReadAll(c.Request.Body)
	var s Settings
	if err != nil || common.Unmarshal(body, &s) != nil {
		respond(c, nil, errInvalid)
		return
	}
	s, err = saveSettings(model.DB.WithContext(c.Request.Context()), s)
	if err == nil {
		common.SysLog(fmt.Sprintf("redemption stores updated by user %d (revision %d, enabled %t, stores %d)", c.GetInt("id"), s.Revision, s.Enabled, len(s.Stores)))
	}
	respond(c, s, err)
}
