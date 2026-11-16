package benchmark

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var errHistoryInvalid = errors.New("Invalid benchmark history operation; refresh the result and check the selection")

// Scope every history action through the same published-group policy as detail
// and regeneration. Knowing a result ID must not grant access to a hidden group.
func historyScope(c *gin.Context) (*gorm.DB, error) {
	db := model.DB.WithContext(c.Request.Context())
	s, _, err := getSettings(db)
	if err != nil {
		return nil, err
	}
	groups := []string{}
	for _, g := range visibleGroups(s, c.GetString("user_group")) {
		groups = append(groups, g.Group)
	}
	return db.Model(&Run{}).Where("group_name IN ?", groups), nil
}

func reviewRun(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.Status(http.StatusNotFound)
		return
	}
	var request struct {
		Quality    string `json:"quality"`
		Reason     string `json:"reason"`
		ReviewedAt int64  `json:"reviewed_at"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8192)
	if common.DecodeJson(c.Request.Body, &request) != nil {
		respond(c, nil, errHistoryInvalid)
		return
	}
	request.Reason = strings.TrimSpace(request.Reason)
	if (request.Quality != "" && request.Quality != "normal" && request.Quality != "suspected" && request.Quality != "abnormal") || len(request.Reason) > 2000 || ((request.Quality == "suspected" || request.Quality == "abnormal") && request.Reason == "") {
		respond(c, nil, errHistoryInvalid)
		return
	}
	scope, err := historyScope(c)
	if err != nil {
		respond(c, nil, err)
		return
	}
	var run Run
	err = scope.Where("id = ?", id).Take(&run).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.Status(http.StatusNotFound)
		return
	}
	if err != nil {
		respond(c, nil, err)
		return
	}
	if run.Kind != "svg" || run.Status != "passed" || run.ReviewedAt != request.ReviewedAt {
		respond(c, nil, errHistoryInvalid)
		return
	}
	now := time.Now().Unix()
	reviewedAt := max(now, run.ReviewedAt+1)
	err = model.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		updated := tx.Model(&Run{}).Where("id = ? AND status = ? AND COALESCE(reviewed_at, 0) = ?", run.ID, "passed", request.ReviewedAt).Updates(map[string]any{
			"quality": request.Quality, "quality_reason": request.Reason, "reviewed_by": c.GetInt("id"), "reviewed_at": reviewedAt,
		})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return errHistoryInvalid
		}
		return tx.Create(&HistoryAudit{ActorID: c.GetInt("id"), RunID: run.ID, RootRunID: run.seriesID(), GroupName: run.GroupName, Action: "review", OldQuality: run.Quality, NewQuality: request.Quality, Reason: request.Reason, CreatedAt: now}).Error
	})
	respond(c, gin.H{"reviewed_at": reviewedAt}, err)
}

// Deletes and audit rows commit together; no task or schedule state is touched.
func deleteHistory(db *gorm.DB, ids []int64, actor int) (int64, error) {
	var deleted int64
	err := db.Transaction(func(tx *gorm.DB) error {
		var runs []Run
		if err := tx.Model(&Run{}).Select("id", "root_run_id", "group_name", "quality").Where("id IN ? AND status <> ?", ids, "running").Find(&runs).Error; err != nil {
			return err
		}
		if len(runs) != len(ids) {
			return errHistoryInvalid
		}
		audits := make([]HistoryAudit, 0, len(runs))
		for _, run := range runs {
			audits = append(audits, HistoryAudit{ActorID: actor, RunID: run.ID, RootRunID: run.seriesID(), GroupName: run.GroupName, Action: "delete", OldQuality: run.Quality, CreatedAt: time.Now().Unix()})
		}
		if err := tx.Model(&HistoryAudit{}).CreateInBatches(&audits, 100).Error; err != nil {
			return err
		}
		result := tx.Model(&Run{}).Where("id IN ? AND status <> ?", ids, "running").Delete(&Run{})
		deleted = result.RowsAffected
		if result.Error != nil {
			return result.Error
		}
		if deleted != int64(len(ids)) {
			return errHistoryInvalid
		}
		return nil
	})
	return deleted, err
}

func deleteRun(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.Status(http.StatusNotFound)
		return
	}
	scope, err := historyScope(c)
	if err != nil {
		respond(c, nil, err)
		return
	}
	var run Run
	err = scope.Where("id = ?", id).Take(&run).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.Status(http.StatusNotFound)
		return
	}
	if err != nil {
		respond(c, nil, err)
		return
	}
	deleted, err := deleteHistory(model.DB.WithContext(c.Request.Context()), []int64{id}, c.GetInt("id"))
	if err != nil {
		respond(c, nil, err)
		return
	}
	var next Run
	err = model.DB.WithContext(c.Request.Context()).Select("id").Where("group_name = ? AND (id = ? OR root_run_id = ?)", run.GroupName, run.seriesID(), run.seriesID()).Order("id DESC").Limit(1).Find(&next).Error
	respond(c, gin.H{"deleted_count": deleted, "next_run_id": next.ID}, err)
}

func cleanupRuns(c *gin.Context) {
	var request struct {
		Group   string  `json:"group"`
		After   int64   `json:"after"`
		Before  int64   `json:"before"`
		Preview bool    `json:"preview"`
		IDs     []int64 `json:"ids"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32768)
	if common.DecodeJson(c.Request.Body, &request) != nil || request.Group == "" || request.After <= 0 || request.Before <= request.After || request.Before > time.Now().Unix() || request.Before-request.After > 90*86400 || len(request.IDs) > 1000 {
		respond(c, nil, errHistoryInvalid)
		return
	}
	scope, err := historyScope(c)
	if err != nil {
		respond(c, nil, err)
		return
	}
	scope = scope.Where("group_name = ? AND created_at >= ? AND created_at < ? AND status <> ?", request.Group, request.After, request.Before, "running")
	if !request.Preview {
		if len(request.IDs) == 0 {
			respond(c, nil, errHistoryInvalid)
			return
		}
		// Delete precisely the previewed IDs, never newly completed probes.
		scope = scope.Where("id IN ?", request.IDs)
	}
	ids := []int64{}
	if err = scope.Order("id").Limit(1001).Pluck("id", &ids).Error; err != nil {
		respond(c, nil, err)
		return
	}
	if len(ids) > 1000 || (!request.Preview && len(ids) != len(request.IDs)) {
		respond(c, nil, errHistoryInvalid)
		return
	}
	if request.Preview {
		respond(c, gin.H{"ids": ids, "count": len(ids)}, nil)
		return
	}
	deleted, err := deleteHistory(model.DB.WithContext(c.Request.Context()), ids, c.GetInt("id"))
	respond(c, gin.H{"deleted_count": deleted}, err)
}
