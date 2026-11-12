package emailtemplate

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func RegisterRoutes(api *gin.RouterGroup) {
	admin := api.Group("/extensions/email-templates/admin", middleware.RootAuth(), middleware.DisableCache())
	admin.GET("/settings", getSettings)
	admin.PUT("/settings", middleware.StrictSessionCookieOriginGuard(), middleware.UserCriticalRateLimit("email-template-settings"), putSettings)
	admin.POST("/preview", middleware.StrictSessionCookieOriginGuard(), middleware.UserCriticalRateLimit("email-template-preview"), preview)
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
	// Never log templates, codes, recovery URLs or rendered mail.
	common.SysError("email templates: settings operation failed")
	common.ApiErrorT(c, "Email templates are temporarily unavailable")
}

func getSettings(c *gin.Context) {
	s, _, err := readSettings(model.DB.WithContext(c.Request.Context()))
	respond(c, gin.H{"settings": s, "catalog": catalog()}, err)
}

func putSettings(c *gin.Context) {
	var s Settings
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2*1024*1024)
	if common.DecodeJson(c.Request.Body, &s) != nil {
		respond(c, nil, errInvalid)
		return
	}
	s, err := saveSettings(model.DB.WithContext(c.Request.Context()), s)
	if err == nil {
		common.SysLog(fmt.Sprintf("email templates updated by user %d (revision %d, enabled %t)", c.GetInt("id"), s.Revision, s.Enabled))
	}
	respond(c, s, err)
}

func preview(c *gin.Context) {
	var source Template
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 128*1024)
	if common.DecodeJson(c.Request.Body, &source) != nil {
		respond(c, nil, errInvalid)
		return
	}
	compiled, err := compileTemplate(source)
	if err != nil {
		respond(c, nil, err)
		return
	}
	subject, body, err := compiled.render(sampleVariables(source.Type, source.Language))
	respond(c, gin.H{"subject": subject, "html": body}, err)
}
