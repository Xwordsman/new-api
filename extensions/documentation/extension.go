package documentationcenter

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
	public := api.Group("/extensions/docs", middleware.DisableCache())
	public.GET("", getCatalog)
	public.GET("/articles/:slug", getArticle)
	public.GET("/articles/:slug/markdown", downloadMarkdown)
	public.GET("/search", searchArticles)
	public.GET("/llms-full.txt", ExportLLMs)
	admin := api.Group("/extensions/docs/admin", middleware.RootAuth(), middleware.DisableCache())
	admin.GET("/settings", getSettings)
	admin.PUT("/settings", middleware.StrictSessionCookieOriginGuard(), middleware.UserCriticalRateLimit("documentation-settings"), putSettings)
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
	// Content can contain private drafts; never include it or a database error
	// that might echo an option value in logs or public responses.
	common.SysError("documentation: settings operation failed")
	common.ApiErrorT(c, "Documentation is temporarily unavailable")
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
		common.SysLog(fmt.Sprintf("documentation updated by user %d (revision %d, categories %d, articles %d)", c.GetInt("id"), s.Revision, len(s.Categories), len(s.Articles)))
	}
	respond(c, s, err)
}
