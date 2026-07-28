package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestFormatUserLogsStripsQuotaSaturation verifies the admin-only quota
// saturation marker (nested under other.admin_info) is removed for non-admin
// log views, since formatUserLogs strips the whole admin_info object.
func TestFormatUserLogsStripsQuotaSaturation(t *testing.T) {
	other := common.MapToJsonStr(map[string]interface{}{
		"model_price": 0.004,
		"admin_info": map[string]interface{}{
			"quota_saturation": map[string]interface{}{
				"op":      "QuotaFromDecimal",
				"kind":    "overflow",
				"clamped": common.MaxQuota,
			},
		},
	})
	logs := []*Log{{
		Other:          other,
		ChannelName:    "private-channel",
		ChannelStatus:  common.ChannelStatusEnabled,
		ChannelBaseURL: "https://private.example.com",
	}}

	formatUserLogs(logs, 0)

	assert.Empty(t, logs[0].ChannelName)
	assert.Zero(t, logs[0].ChannelStatus)
	assert.Empty(t, logs[0].ChannelBaseURL)

	parsed, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	_, hasAdminInfo := parsed["admin_info"]
	require.False(t, hasAdminInfo, "admin_info (and nested quota_saturation) must be stripped for non-admin views")
	// Non-admin billing fields remain visible.
	require.Contains(t, parsed, "model_price")
}

func TestGetAllLogsIncludesCurrentChannelDetails(t *testing.T) {
	truncateTables(t)
	previousMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = false
	t.Cleanup(func() {
		common.MemoryCacheEnabled = previousMemoryCacheEnabled
	})

	baseURL := "https://upstream.example.com/v1"
	channel := &Channel{
		Name:    "upstream",
		Key:     "test-key",
		Status:  common.ChannelStatusEnabled,
		BaseURL: &baseURL,
	}
	require.NoError(t, DB.Create(channel).Error)
	require.NoError(t, LOG_DB.Create(&Log{
		Type:      LogTypeConsume,
		CreatedAt: 100,
		ChannelId: channel.Id,
	}).Error)

	logs, total, err := GetAllLogs(
		LogTypeUnknown,
		0,
		0,
		"",
		"",
		"",
		0,
		10,
		0,
		"",
		"",
		"",
	)
	require.NoError(t, err)
	require.EqualValues(t, 1, total)
	require.Len(t, logs, 1)
	assert.Equal(t, channel.Name, logs[0].ChannelName)
	assert.Equal(t, channel.Status, logs[0].ChannelStatus)
	assert.Equal(t, baseURL, logs[0].ChannelBaseURL)
}
