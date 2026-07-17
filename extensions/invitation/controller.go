package invitation

import (
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	maxBatchCount = 100
	maxUsesLimit  = 1000000
)

var codePattern = regexp.MustCompile(`^[A-Z0-9_-]{4,64}$`)
var prefixPattern = regexp.MustCompile(`^[A-Z0-9_-]{0,16}$`)

type settingsRequest struct {
	Enabled *bool `json:"enabled"`
}

type createCodesRequest struct {
	Name      string     `json:"name"`
	Code      string     `json:"code"`
	Prefix    string     `json:"prefix"`
	Count     int        `json:"count"`
	MaxUses   int        `json:"max_uses"`
	ExpiresAt *time.Time `json:"expires_at"`
}

type updateCodeRequest struct {
	Name      string     `json:"name"`
	Status    int        `json:"status"`
	MaxUses   int        `json:"max_uses"`
	ExpiresAt *time.Time `json:"expires_at"`
}

func getSettings(c *gin.Context) {
	enabled, err := RegistrationEnabled(model.DB)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgDatabaseError)
		return
	}
	common.ApiSuccess(c, gin.H{"enabled": enabled})
}

func updateSettings(c *gin.Context) {
	var request settingsRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if request.Enabled == nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if err := UpdateSettings(model.DB, *request.Enabled); err != nil {
		common.ApiErrorI18n(c, i18n.MsgUpdateFailed)
		return
	}
	common.ApiSuccess(c, gin.H{"enabled": *request.Enabled})
}

func listCodes(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	query := model.DB.Model(&Code{})
	if keyword := strings.TrimSpace(c.Query("keyword")); keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("code LIKE ? OR name LIKE ?", like, like)
	}
	if statusValue := strings.TrimSpace(c.Query("status")); statusValue != "" {
		status, err := strconv.Atoi(statusValue)
		if err != nil || (status != CodeStatusDisabled && status != CodeStatusEnabled) {
			common.ApiErrorI18n(c, i18n.MsgInvalidParams)
			return
		}
		query = query.Where("status = ?", status)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		common.ApiErrorI18n(c, i18n.MsgDatabaseError)
		return
	}
	var codes []Code
	if err := query.Order("id DESC").
		Limit(pageInfo.PageSize).
		Offset(pageInfo.GetStartIdx()).
		Find(&codes).Error; err != nil {
		common.ApiErrorI18n(c, i18n.MsgDatabaseError)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(codes)
	common.ApiSuccess(c, pageInfo)
}

func createCodes(c *gin.Context) {
	var request createCodesRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	request.Name = strings.TrimSpace(request.Name)
	request.Code = NormalizeCode(request.Code)
	request.Prefix = NormalizeCode(request.Prefix)
	if request.Count == 0 {
		request.Count = 1
	}
	if request.Count < 1 || request.Count > maxBatchCount || request.MaxUses < 0 || request.MaxUses > maxUsesLimit || len(request.Name) > 100 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if request.ExpiresAt != nil && !request.ExpiresAt.After(time.Now()) {
		common.ApiErrorI18n(c, "invitation.expiry_in_past")
		return
	}
	if request.Code != "" && (request.Count != 1 || !codePattern.MatchString(request.Code)) {
		common.ApiErrorI18n(c, "invitation.code_format_invalid")
		return
	}
	if !prefixPattern.MatchString(request.Prefix) {
		common.ApiErrorI18n(c, "invitation.prefix_format_invalid")
		return
	}

	codes := make([]Code, 0, request.Count)
	seen := make(map[string]struct{}, request.Count)
	for len(codes) < request.Count {
		codeValue := request.Code
		if codeValue == "" {
			randomPart, err := common.GenerateRandomCharsKey(20)
			if err != nil {
				common.ApiErrorI18n(c, i18n.MsgGenerateFailed)
				return
			}
			codeValue = strings.ToUpper(randomPart)
			if request.Prefix != "" {
				codeValue = request.Prefix + "-" + codeValue
			}
		}
		if _, exists := seen[codeValue]; exists {
			continue
		}
		seen[codeValue] = struct{}{}
		codes = append(codes, Code{
			Code:      codeValue,
			Name:      request.Name,
			Status:    CodeStatusEnabled,
			MaxUses:   request.MaxUses,
			UsedCount: 0,
			ExpiresAt: request.ExpiresAt,
		})
	}

	if err := model.DB.Create(&codes).Error; err != nil {
		common.ApiErrorI18n(c, "invitation.code_already_exists")
		return
	}
	common.ApiSuccess(c, codes)
}

func updateCode(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidId)
		return
	}
	var request updateCodeRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	request.Name = strings.TrimSpace(request.Name)
	if len(request.Name) > 100 || request.MaxUses < 0 || request.MaxUses > maxUsesLimit || (request.Status != CodeStatusDisabled && request.Status != CodeStatusEnabled) {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	var code Code
	if err := model.DB.First(&code, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			common.ApiErrorI18n(c, i18n.MsgNotFound)
			return
		}
		common.ApiErrorI18n(c, i18n.MsgDatabaseError)
		return
	}
	if request.MaxUses > 0 && request.MaxUses < code.UsedCount {
		common.ApiErrorI18n(c, "invitation.max_uses_below_used")
		return
	}

	if err := model.DB.Model(&code).Updates(map[string]any{
		"name":       request.Name,
		"status":     request.Status,
		"max_uses":   request.MaxUses,
		"expires_at": request.ExpiresAt,
		"updated_at": time.Now(),
	}).Error; err != nil {
		common.ApiErrorI18n(c, i18n.MsgUpdateFailed)
		return
	}
	if err := model.DB.First(&code, id).Error; err != nil {
		common.ApiErrorI18n(c, i18n.MsgDatabaseError)
		return
	}
	common.ApiSuccess(c, code)
}

func deleteCode(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidId)
		return
	}
	result := model.DB.Delete(&Code{}, id)
	if result.Error != nil {
		common.ApiErrorI18n(c, i18n.MsgDeleteFailed)
		return
	}
	if result.RowsAffected == 0 {
		common.ApiErrorI18n(c, i18n.MsgNotFound)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}
