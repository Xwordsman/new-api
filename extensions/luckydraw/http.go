package luckydraw

import (
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/extensions/luckydraw/policy"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func respond(c *gin.Context, data any, err error) {
	if err == nil {
		common.ApiSuccess(c, data)
		return
	}
	if policy.IsPolicyError(err) {
		common.ApiError(c, err)
		return
	}
	common.SysError("lucky draw: " + err.Error())
	common.ApiError(c, policy.ErrUnavailable)
}

func dashboard(c *gin.Context) {
	data, err := policy.Dashboard(model.DB.WithContext(c.Request.Context()), c.GetInt("id"), time.Now())
	respond(c, data, err)
}

func result(c *gin.Context) {
	data, err := policy.ResultFor(model.DB.WithContext(c.Request.Context()), c.GetInt("id"), c.Param("key"))
	respond(c, data, err)
}

func draw(c *gin.Context) {
	var input struct {
		RequestKey string `json:"request_key"`
		Version    int    `json:"version"`
		Turnstile  string `json:"turnstile"`
	}
	if common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 4096), &input) != nil {
		respond(c, nil, policy.ErrInvalid)
		return
	}
	db := model.DB.WithContext(c.Request.Context())
	previous, err := policy.ResultFor(db, c.GetInt("id"), input.RequestKey)
	if err != nil || previous != nil {
		respond(c, previous, err)
		return
	}
	s, err := policy.GetSettings(db)
	if err != nil {
		respond(c, nil, err)
		return
	}
	if !s.Enabled {
		respond(c, nil, policy.ErrDisabled)
		return
	}
	verified := false
	if s.RequireTurnstile || common.TurnstileCheckEnabled {
		if !common.TurnstileCheckEnabled || common.TurnstileSiteKey == "" || common.TurnstileSecretKey == "" {
			respond(c, nil, policy.ErrVerifyConfig)
			return
		}
		if input.Turnstile == "" || len(input.Turnstile) > 2048 {
			respond(c, nil, policy.ErrVerify)
			return
		}
		form := url.Values{"secret": {common.TurnstileSecretKey}, "response": {input.Turnstile}, "remoteip": {c.ClientIP()}}
		request, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, "https://challenges.cloudflare.com/turnstile/v0/siteverify", strings.NewReader(form.Encode()))
		if err != nil {
			respond(c, nil, policy.ErrVerify)
			return
		}
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		client := http.Client{Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		response, err := client.Do(request)
		if err != nil {
			respond(c, nil, policy.ErrVerify)
			return
		}
		defer response.Body.Close()
		var proof struct {
			Success bool `json:"success"`
		}
		if response.StatusCode != http.StatusOK || common.DecodeJson(io.LimitReader(response.Body, 16<<10), &proof) != nil || !proof.Success {
			respond(c, nil, policy.ErrVerify)
			return
		}
		verified = true
	}
	data, err := model.UserLuckyDraw(c.Request.Context(), c.GetInt("id"), input.RequestKey, input.Version, verified)
	respond(c, data, err)
}

func getSettings(c *gin.Context) {
	data, err := policy.GetSettings(model.DB.WithContext(c.Request.Context()))
	respond(c, data, err)
}

func putSettings(c *gin.Context) {
	var input policy.Settings
	if common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 24<<10), &input) != nil {
		respond(c, nil, policy.ErrInvalid)
		return
	}
	data, err := policy.UpdateSettings(model.DB.WithContext(c.Request.Context()), input, c.GetInt("id"))
	respond(c, data, err)
}

func paginated(c *gin.Context, query *gorm.DB, rows any) {
	page, err := strconv.Atoi(c.DefaultQuery("p", "1"))
	size, sizeErr := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	user, userErr := strconv.Atoi(c.DefaultQuery("user_id", "0"))
	if err != nil || sizeErr != nil || userErr != nil || page < 1 || page > 1000000 || size < 1 || size > 100 || user < 0 {
		respond(c, nil, policy.ErrInvalid)
		return
	}
	if user > 0 {
		query = query.Where("user_id = ?", user)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		respond(c, nil, err)
		return
	}
	err = query.Order("created_at DESC, id DESC").Offset((page - 1) * size).Limit(size).Find(rows).Error
	respond(c, gin.H{"items": rows, "total": total, "page": page, "page_size": size}, err)
}

func history(c *gin.Context) {
	rows := make([]policy.Record, 0)
	paginated(c, model.DB.WithContext(c.Request.Context()).Model(&policy.Record{}).Where("user_id = ?", c.GetInt("id")), &rows)
}

func records(c *gin.Context) {
	rows := make([]policy.Record, 0)
	paginated(c, model.DB.WithContext(c.Request.Context()).Model(&policy.Record{}), &rows)
}

func audit(c *gin.Context) {
	rows := make([]policy.Audit, 0)
	paginated(c, model.DB.WithContext(c.Request.Context()).Model(&policy.Audit{}), &rows)
}

func snapshot(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id < 1 {
		respond(c, nil, policy.ErrInvalid)
		return
	}
	var record policy.Record
	if err := model.DB.WithContext(c.Request.Context()).First(&record, id).Error; err != nil {
		respond(c, nil, policy.ErrInvalid)
		return
	}
	var s policy.Settings
	err = common.UnmarshalJsonStr(record.Snapshot, &s)
	respond(c, gin.H{"record": record, "settings": s}, err)
}

func accounts(c *gin.Context) {
	// The paginated audit/record helper orders by creation time; accounts use
	// their user key and expose only the administrator's requested account.
	page, err := strconv.Atoi(c.DefaultQuery("p", "1"))
	size, sizeErr := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	user, userErr := strconv.Atoi(c.DefaultQuery("user_id", "0"))
	if err != nil || sizeErr != nil || userErr != nil || page < 1 || page > 1000000 || size < 1 || size > 100 || user < 0 {
		respond(c, nil, policy.ErrInvalid)
		return
	}
	query := model.DB.WithContext(c.Request.Context()).Model(&policy.Account{})
	if user > 0 {
		query = query.Where("user_id = ?", user)
	}
	if state := c.Query("state"); state != "" {
		if state != "active" && state != "paused" {
			respond(c, nil, policy.ErrInvalid)
			return
		}
		query = query.Where("state = ?", state)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		respond(c, nil, err)
		return
	}
	rows := make([]policy.Account, 0)
	err = query.Order("user_id DESC").Offset((page - 1) * size).Limit(size).Find(&rows).Error
	respond(c, gin.H{"items": rows, "total": total, "page": page, "page_size": size}, err)
}

func updateAccount(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	var input struct {
		State  string `json:"state"`
		Reason string `json:"reason"`
	}
	if err != nil || common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 4096), &input) != nil {
		respond(c, nil, policy.ErrInvalid)
		return
	}
	data, err := policy.UpdateAccount(model.DB.WithContext(c.Request.Context()), id, c.GetInt("id"), input.State, input.Reason)
	respond(c, data, err)
}

func summary(c *gin.Context) {
	db := model.DB.WithContext(c.Request.Context())
	var pool policy.Pool
	if err := db.First(&pool, 1).Error; err != nil {
		respond(c, nil, err)
		return
	}
	if time.Now().Unix() >= pool.NextResetAt {
		pool.DailyQuota = 0
	}
	stock := make([]policy.Stock, 0)
	err := db.Order("prize_id ASC").Find(&stock).Error
	respond(c, gin.H{"pool": pool, "stock": stock}, err)
}

func winners(c *gin.Context) {
	db := model.DB.WithContext(c.Request.Context())
	s, err := policy.GetSettings(db)
	if err != nil {
		respond(c, nil, err)
		return
	}
	data := make([]map[string]any, 0)
	if !s.Enabled || !s.ShowWinners {
		respond(c, data, nil)
		return
	}
	var rows []policy.Record
	if err := db.Where("quota_awarded > ?", 0).Order("id DESC").Limit(12).Find(&rows).Error; err != nil {
		respond(c, nil, err)
		return
	}
	for _, row := range rows {
		// An event pseudonym conveys activity without publishing user IDs,
		// usernames, payment facts or a stable cross-event account identifier.
		data = append(data, map[string]any{"id": row.ID, "participant": "***" + strconv.Itoa(row.ID%10000), "prize_name": row.PrizeName, "quota_awarded": row.QuotaAwarded, "created_at": row.CreatedAt})
	}
	respond(c, data, nil)
}
