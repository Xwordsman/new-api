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
	admin.GET("/channels", channels)
	write := admin.Group("", middleware.StrictSessionCookieOriginGuard(), middleware.UserCriticalRateLimit("request-protection"))
	write.PUT("/settings", putSettings)
	write.POST("/dry-run", dryRun)
	write.POST("/review", review)
	write.POST("/release", release)
	write.POST("/hold", hold)
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
	s := policy.Defaults()
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
		Settings  policy.Settings `json:"settings"`
		Body      string          `json:"body"`
		Protocol  string          `json:"protocol"`
		Model     string          `json:"model"`
		Group     string          `json:"group"`
		ChannelID int             `json:"channel_id"`
		Semantic  bool            `json:"semantic"`
	}
	input.Settings = policy.Defaults()
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024*1024)
	if common.DecodeJson(c.Request.Body, &input) != nil || policy.Validate(input.Settings) != nil || len(input.Body) > 512*1024 || len(input.Protocol) > 40 || len(input.Model) > 191 || len(input.Group) > 191 {
		respond(c, nil, policy.ErrInvalid)
		return
	}
	in := policy.Input{ChannelID: input.ChannelID, UserID: c.GetInt("id"), Model: input.Model, Group: input.Group, Protocol: input.Protocol}
	if len(input.Body) > input.Settings.MaxBodyBytes {
		in.Uninspected = "body_limit"
	} else {
		in.Segments, in.Uninspected = policy.Extract([]byte(input.Body), input.Protocol)
	}
	v := policy.Inspect(input.Settings, in, common.SessionSecret)
	if input.Semantic {
		if !input.Settings.Reviewer.Enabled || input.ChannelID <= 0 {
			respond(c, nil, policy.ErrInvalid)
			return
		}
		channel, err := model.GetChannelById(input.ChannelID, false)
		if err != nil {
			respond(c, nil, err)
			return
		}
		v = service.ReviewRequestProtection(c.Request.Context(), input.Settings, in, v, channel.GetBaseURL())
	}
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
	Matches     []policy.Hit `json:"matches"`
	Username    string       `json:"username"`
	TokenName   string       `json:"token_name"`
	ChannelName string       `json:"channel_name"`
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
	userIDs, tokenIDs, channelIDs := []int{}, []int{}, []int{}
	for _, row := range rows {
		userIDs = append(userIDs, row.UserID)
		tokenIDs = append(tokenIDs, row.TokenID)
		channelIDs = append(channelIDs, row.ChannelID)
	}
	users, tokens, channelRows := []model.User{}, []model.Token{}, []model.Channel{}
	if len(rows) > 0 {
		db := model.DB.WithContext(c.Request.Context())
		for _, lookup := range []struct {
			target  any
			columns []string
			ids     []int
		}{{&users, []string{"id", "username"}, userIDs}, {&tokens, []string{"id", "name"}, tokenIDs}, {&channelRows, []string{"id", "name"}, channelIDs}} {
			if err := db.Unscoped().Select(lookup.columns).Where("id IN ?", lookup.ids).Find(lookup.target).Error; err != nil {
				respond(c, nil, err)
				return
			}
		}
	}
	userNames, tokenNames, channelNames := map[int]string{}, map[int]string{}, map[int]string{}
	for _, row := range users {
		userNames[row.Id] = row.Username
	}
	for _, row := range tokens {
		tokenNames[row.Id] = row.Name
	}
	for _, row := range channelRows {
		channelNames[row.Id] = row.Name
	}
	for _, row := range rows {
		matches := []policy.Hit{}
		if err := common.UnmarshalJsonStr(row.Hits, &matches); err != nil {
			respond(c, nil, err)
			return
		}
		items = append(items, eventView{Event: row, Matches: matches, Username: userNames[row.UserID], TokenName: tokenNames[row.TokenID], ChannelName: channelNames[row.ChannelID]})
	}
	respond(c, gin.H{"items": items, "total": total, "page": page}, nil)
}

func channels(c *gin.Context) {
	// Only safe display fields leave the server; channel credentials remain in
	// the existing operator-managed channel record.
	type choice struct {
		ID     int    `json:"id"`
		Name   string `json:"name"`
		Type   int    `json:"type"`
		Models string `json:"models"`
	}
	rows := []choice{}
	err := model.DB.WithContext(c.Request.Context()).Model(&model.Channel{}).Select("id", "name", "type", "models").Where("status = ?", common.ChannelStatusEnabled).Order("id ASC").Find(&rows).Error
	respond(c, rows, err)
}

func hold(c *gin.Context) {
	var input struct {
		EventID int64  `json:"event_id"`
		Note    string `json:"note"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	if common.DecodeJson(c.Request.Body, &input) != nil || input.EventID <= 0 {
		respond(c, nil, policy.ErrInvalid)
		return
	}
	err := policy.HoldUser(model.DB.WithContext(c.Request.Context()), input.EventID, c.GetInt("id"), input.Note, time.Now().Unix())
	respond(c, nil, err)
}
func restrictions(c *gin.Context) {
	q, page := filteredQuery(c, &policy.Subject{})
	q = q.Where("user_id > ? AND expires_at > ?", 0, time.Now().Unix())
	var total int64
	if err := q.Count(&total).Error; err != nil {
		respond(c, nil, err)
		return
	}
	rows := []policy.Subject{}
	err := q.Order("expires_at DESC").Offset((page - 1) * 20).Limit(20).Find(&rows).Error
	if err != nil {
		respond(c, nil, err)
		return
	}
	type restrictionView struct {
		policy.Subject
		Group        string `json:"group"`
		ManualReview bool   `json:"manual_review"`
	}
	ids := make([]int64, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.CauseEventID)
	}
	causes := []policy.Event{}
	if len(ids) > 0 {
		if err = model.DB.WithContext(c.Request.Context()).Select("id", "group_name").Where("id IN ?", ids).Find(&causes).Error; err != nil {
			respond(c, nil, err)
			return
		}
	}
	groups := map[int64]string{}
	for _, cause := range causes {
		groups[cause.ID] = cause.GroupName
	}
	items := make([]restrictionView, 0, len(rows))
	for _, row := range rows {
		items = append(items, restrictionView{Subject: row, Group: groups[row.CauseEventID], ManualReview: row.Until == policy.ManualHoldUntil})
	}
	respond(c, gin.H{"items": items, "total": total, "page": page}, nil)
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
