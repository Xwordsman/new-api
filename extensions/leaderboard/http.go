package leaderboard

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func RegisterRoutes(api *gin.RouterGroup) {
	users := api.Group("/extensions/leaderboard", middleware.UserAuth(), middleware.DisableCache(), requestTimeout())
	users.GET("/snapshot", getSnapshot)
	admin := api.Group("/extensions/leaderboard/admin", middleware.RootAuth(), middleware.DisableCache(), requestTimeout())
	admin.GET("/settings", adminSettings)
	admin.PUT("/settings", middleware.SessionCookieOriginGuard(), middleware.UserCriticalRateLimit("leaderboard-settings"), updateSettings)
	admin.POST("/refresh", middleware.SessionCookieOriginGuard(), middleware.UserCriticalRateLimit("leaderboard-refresh"), refresh)
}

func requestTimeout() gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
		defer cancel()
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	}
}

func respond(c *gin.Context, data any, err error) {
	if err == nil {
		common.ApiSuccess(c, data)
		return
	}
	if errors.Is(err, errInvalid) || errors.Is(err, errConflict) {
		common.ApiError(c, err)
		return
	}
	common.SysError("leaderboard: " + err.Error())
	common.ApiErrorT(c, "Unable to load leaderboard")
}

func adminSettings(c *gin.Context) {
	db := model.DB.WithContext(c.Request.Context())
	s, _, err := getSettings(db)
	if err != nil {
		respond(c, nil, err)
		return
	}
	var last Snapshot
	err = db.First(&last, 1).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = nil
	}
	respond(c, gin.H{"settings": s, "updated_at": last.UpdatedAt}, err)
}

func updateSettings(c *gin.Context) {
	var settings Settings
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32768)
	if common.DecodeJson(c.Request.Body, &settings) != nil {
		respond(c, nil, errInvalid)
		return
	}
	s, err := saveSettings(model.DB.WithContext(c.Request.Context()), settings)
	if err == nil {
		_, _, enqueueErr := service.EnqueueSystemTask(taskType, struct{}{})
		if enqueueErr != nil {
			// A committed configuration remains saved. The periodic scheduler
			// retries publication; clients will see an explicit pending state.
			common.SysError("leaderboard enqueue: " + enqueueErr.Error())
		}
	}
	respond(c, s, err)
}

func refresh(c *gin.Context) {
	_, created, err := service.EnqueueSystemTask(taskType, struct{}{})
	respond(c, gin.H{"queued": created}, err)
}

type publicRank struct {
	Rank  int    `json:"rank"`
	Name  string `json:"name"`
	Value int64  `json:"value"`
	IsMe  bool   `json:"is_me"`
}

type publicSnapshot struct {
	Enabled        bool                               `json:"enabled"`
	Pending        bool                               `json:"pending"`
	Stale          bool                               `json:"stale"`
	UpdatedAt      int64                              `json:"updated_at"`
	DayStart       int64                              `json:"day_start"`
	RefreshMinutes int                                `json:"refresh_minutes"`
	TopN           int                                `json:"top_n"`
	WarningDays    int                                `json:"warning_retention_days"`
	PaidOnly       bool                               `json:"invitation_paid_only"`
	Boards         map[string]map[string][]publicRank `json:"boards"`
}

type publicUser struct {
	ID          int
	Username    string
	DisplayName string
}

// Presentation applies live eligibility and current privacy settings so a
// disabled account or a newly excluded ID never leaks through an old snapshot.
func present(ctx context.Context, db *gorm.DB, viewer int, now time.Time) (publicSnapshot, error) {
	db = db.WithContext(ctx)
	s, _, err := getSettings(db)
	result := publicSnapshot{Enabled: s.Enabled, RefreshMinutes: s.IntervalMinutes, TopN: s.TopN,
		WarningDays: s.WarningRetention, PaidOnly: s.InvitationPaidOnly, Boards: map[string]map[string][]publicRank{}}
	if err != nil || !s.Enabled {
		return result, err
	}
	for board, enabled := range s.boards() {
		if enabled {
			result.Boards[board] = map[string][]publicRank{"today": {}, "yesterday": {}, "all": {}}
		}
	}
	var snap Snapshot
	err = db.First(&snap, 1).Error
	if errors.Is(err, gorm.ErrRecordNotFound) || err == nil && (snap.Revision != s.Revision || snap.DayStart != dayStart(now)) {
		result.Pending = true
		return result, nil
	}
	if err != nil {
		return result, err
	}
	var data rankings
	if err := common.UnmarshalJsonStr(snap.Payload, &data); err != nil {
		return result, err
	}
	ids := []int{}
	for _, periods := range data {
		for _, rows := range periods {
			for _, row := range rows {
				ids = append(ids, row.UserID)
			}
		}
	}
	slices.Sort(ids)
	ids = slices.Compact(ids)
	users := []publicUser{}
	if len(ids) > 0 {
		q := db.Model(&model.User{}).Select("id, username, display_name").Where("id IN ? AND status = ?", ids, common.UserStatusEnabled)
		if s.ExcludeAdmins {
			q = q.Where("role < ?", common.RoleAdminUser)
		}
		if len(s.ExcludedUserIDs) > 0 {
			q = q.Where("id NOT IN ?", s.ExcludedUserIDs)
		}
		if err := q.Find(&users).Error; err != nil {
			return result, err
		}
	}
	names := make(map[int]string, len(users))
	for _, user := range users {
		name := user.DisplayName
		if name == "" {
			name = user.Username
		}
		if s.MaskNames && user.ID != viewer {
			runes := []rune(name)
			if len(runes) > 0 {
				name = string(runes[:1]) + "***"
			} else {
				name = "***"
			}
		}
		names[user.ID] = name
	}
	for board, periods := range data {
		if _, enabled := result.Boards[board]; !enabled {
			continue
		}
		for period, rows := range periods {
			for _, row := range rows {
				name, exists := names[row.UserID]
				if !exists {
					continue
				}
				public := publicRank{Rank: len(result.Boards[board][period]) + 1, Name: name, Value: row.Value, IsMe: row.UserID == viewer}
				result.Boards[board][period] = append(result.Boards[board][period], public)
			}
		}
	}
	result.UpdatedAt, result.DayStart = snap.UpdatedAt, snap.DayStart
	result.Stale = now.Unix()-snap.UpdatedAt > int64(s.IntervalMinutes)*60+120
	return result, nil
}

func getSnapshot(c *gin.Context) {
	snapshot, err := present(c.Request.Context(), model.DB, c.GetInt("id"), time.Now())
	respond(c, snapshot, err)
}
