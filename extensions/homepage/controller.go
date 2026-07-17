package homepage

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

type settingsRequest struct {
	Enabled     *bool  `json:"enabled"`
	Mode        string `json:"mode"`
	Title       string `json:"title"`
	Description string `json:"description"`
	ButtonText  string `json:"button_text"`
	ButtonURL   string `json:"button_url"`
}

func getSettings(c *gin.Context) {
	settings, err := GetSettings(model.DB)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgDatabaseError)
		return
	}
	common.ApiSuccess(c, settings)
}

func updateSettings(c *gin.Context) {
	var request settingsRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil || request.Enabled == nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}

	settings, err := UpdateSettings(model.DB, Settings{
		Enabled:     *request.Enabled,
		Mode:        request.Mode,
		Title:       request.Title,
		Description: request.Description,
		ButtonText:  request.ButtonText,
		ButtonURL:   request.ButtonURL,
	})
	if errors.Is(err, ErrInvalidSettings) {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgUpdateFailed)
		return
	}
	common.ApiSuccess(c, settings)
}
