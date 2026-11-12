package requestprotection

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/extensions/requestprotection/policy"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func RegisterRoutes(api *gin.RouterGroup) {
	admin := api.Group("/extensions/request-protection/admin", middleware.RootAuth(), middleware.DisableCache())
	admin.GET("/settings", getSettings)
	admin.GET("/events", events)
	admin.GET("/restrictions", restrictions)
	admin.GET("/audit", audit)
	write := admin.Group("", middleware.StrictSessionCookieOriginGuard(), middleware.UserCriticalRateLimit("request-protection"))
	write.PUT("/settings", putSettings)
	write.POST("/dry-run", dryRun)
	write.POST("/review", review)
	write.POST("/release", release)
	write.POST("/check-alerts", checkAlerts)
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
	if errors.Is(err, gorm.ErrRecordNotFound) {
		common.ApiErrorT(c, "Request protection record not found")
		return
	}
	common.SysError("request protection admin: " + err.Error())
	common.ApiError(c, policy.ErrUnavailable)
}
func getSettings(c *gin.Context) {
	s, err := policy.GetSettings(model.DB.WithContext(c.Request.Context()))
	respond(c, s, err)
}
func putSettings(c *gin.Context) {
	var s policy.Settings
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256*1024)
	if common.DecodeJson(c.Request.Body, &s) != nil {
		respond(c, nil, policy.ErrInvalid)
		return
	}
	s, err := policy.SaveSettings(model.DB.WithContext(c.Request.Context()), s, c.GetInt("id"), time.Now().Unix())
	respond(c, s, err)
}
func dryRun(c *gin.Context) {
	var input struct {
		Settings policy.Settings `json:"settings"`
		Body     string          `json:"body"`
		Protocol string          `json:"protocol"`
		Model    string          `json:"model"`
		Group    string          `json:"group"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024*1024)
	if common.DecodeJson(c.Request.Body, &input) != nil || policy.Validate(input.Settings) != nil || len(input.Body) > 512*1024 || len(input.Protocol) > 40 || len(input.Model) > 191 || len(input.Group) > 191 {
		respond(c, nil, policy.ErrInvalid)
		return
	}
	in := policy.Input{UserID: c.GetInt("id"), Model: input.Model, Group: input.Group, Protocol: input.Protocol}
	if len(input.Body) > input.Settings.MaxBodyBytes {
		in.Uninspected = "body_limit"
	} else {
		in.Segments, in.Uninspected = policy.Extract([]byte(input.Body), input.Protocol)
	}
	v := policy.Inspect(input.Settings, in, common.SessionSecret)
	// Dry runs have no event, score, restriction or notification side effects.
	respond(c, v, nil)
}
func filteredQuery(c *gin.Context, table any) (*gorm.DB, int) {
	page, _ := strconv.Atoi(c.Query("page"))
	page = max(1, min(100000, page))
	q := model.DB.WithContext(c.Request.Context()).Model(table)
	if id, _ := strconv.Atoi(c.Query("user_id")); id > 0 {
		q = q.Where("user_id = ?", id)
	}
	if id, _ := strconv.Atoi(c.Query("token_id")); id > 0 {
		q = q.Where("token_id = ?", id)
	}
	return q, page
}

type eventView struct {
	policy.Event
	Matches []policy.Hit `json:"matches"`
}

func events(c *gin.Context) {
	q, page := filteredQuery(c, &policy.Event{})
	if value := c.Query("decision"); value != "" {
		q = q.Where("decision = ?", value)
	}
	if value := c.Query("review"); value != "" {
		q = q.Where("review = ?", value)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		respond(c, nil, err)
		return
	}
	rows := []policy.Event{}
	if err := q.Order("id DESC").Offset((page - 1) * 20).Limit(20).Find(&rows).Error; err != nil {
		respond(c, nil, err)
		return
	}
	items := make([]eventView, 0, len(rows))
	for _, row := range rows {
		matches := []policy.Hit{}
		if err := common.UnmarshalJsonStr(row.Hits, &matches); err != nil {
			respond(c, nil, err)
			return
		}
		items = append(items, eventView{Event: row, Matches: matches})
	}
	respond(c, gin.H{"items": items, "total": total, "page": page}, nil)
}
func restrictions(c *gin.Context) {
	q, page := filteredQuery(c, &policy.Subject{})
	q = q.Where("expires_at > ?", time.Now().Unix())
	var total int64
	if err := q.Count(&total).Error; err != nil {
		respond(c, nil, err)
		return
	}
	rows := []policy.Subject{}
	err := q.Order("expires_at DESC").Offset((page - 1) * 20).Limit(20).Find(&rows).Error
	respond(c, gin.H{"items": rows, "total": total, "page": page}, err)
}
func audit(c *gin.Context) {
	page, _ := strconv.Atoi(c.Query("page"))
	page = max(1, min(page, 100000))
	q := model.DB.WithContext(c.Request.Context()).Model(&policy.Audit{})
	var total int64
	if err := q.Count(&total).Error; err != nil {
		respond(c, nil, err)
		return
	}
	rows := []policy.Audit{}
	err := q.Order("id DESC").Offset((page - 1) * 20).Limit(20).Find(&rows).Error
	respond(c, gin.H{"items": rows, "total": total, "page": page}, err)
}
func review(c *gin.Context) {
	var input struct {
		EventID int64  `json:"event_id"`
		Verdict string `json:"verdict"`
		Note    string `json:"note"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	if common.DecodeJson(c.Request.Body, &input) != nil || input.EventID <= 0 {
		respond(c, nil, policy.ErrInvalid)
		return
	}
	err := policy.Review(model.DB.WithContext(c.Request.Context()), input.EventID, c.GetInt("id"), input.Verdict, input.Note, time.Now().Unix())
	respond(c, nil, err)
}
func release(c *gin.Context) {
	var input struct {
		SubjectID string `json:"subject_id"`
		Note      string `json:"note"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	if common.DecodeJson(c.Request.Body, &input) != nil || len(input.SubjectID) > 64 {
		respond(c, nil, policy.ErrInvalid)
		return
	}
	err := policy.Release(model.DB.WithContext(c.Request.Context()), input.SubjectID, c.GetInt("id"), input.Note, time.Now().Unix())
	respond(c, nil, err)
}
func checkAlerts(c *gin.Context) {
	_, _, err := service.EnqueueSystemTask(taskType, struct{}{})
	respond(c, nil, err)
}
