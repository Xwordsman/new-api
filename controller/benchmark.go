package controller

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/extensions/benchmark"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// RunBenchmarkProbe samples the same group routing pool as an API request and
// uses the channel-test executor (platform expense; no user wallet deduction).
func RunBenchmarkProbe(ctx context.Context, group, modelName, prompt string, maxTokens int) (benchmark.ProbeResult, error) {
	result := benchmark.ProbeResult{}
	if maxTokens < 16 || maxTokens > 32768 {
		return result, errors.New("invalid benchmark token limit")
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	path := "/v1/chat/completions"
	if strings.Contains(strings.ToLower(modelName), "codex") {
		path = "/v1/responses"
	}
	c.Request = httptest.NewRequestWithContext(ctx, http.MethodPost, path, nil)
	common.SetContextKey(c, constant.ContextKeyUsingGroup, group)
	channel, _, selectionErr := service.SelectChannelForRequest(c, modelName, &service.RetryParam{Ctx: c, TokenGroup: group, ModelName: modelName, RequestPath: path})
	if selectionErr != nil {
		return result, errors.New("benchmark route unavailable")
	}
	result.ChannelID = channel.Id
	userID, err := resolveChannelTestUserID(nil)
	if err != nil {
		return result, err
	}
	endpoint := string(constant.EndpointTypeOpenAI)
	if path == "/v1/responses" || channel.Type == constant.ChannelTypeCodex {
		endpoint = string(constant.EndpointTypeOpenAIResponse)
	}
	response := executeChannelTest(ctx, channel, userID, modelName, endpoint, false, &channelProbeOptions{group: group, prompt: prompt, maxTokens: uint(maxTokens)})
	if response.localErr != nil {
		return result, errors.New("benchmark upstream request failed")
	}
	if response.newAPIError != nil {
		return result, errors.New("benchmark upstream response failed")
	}
	if response.usage != nil {
		result.InputTokens = response.usage.PromptTokens
		result.OutputTokens = response.usage.CompletionTokens
	}
	// Ignore reasoning/tool output: only the final user-visible text is graded.
	if endpoint == string(constant.EndpointTypeOpenAIResponse) {
		var body struct {
			Status string `json:"status"`
			Output []struct {
				Type    string `json:"type"`
				Content []struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"content"`
			} `json:"output"`
		}
		if err := common.Unmarshal(response.body, &body); err != nil {
			return result, err
		}
		result.Truncated = body.Status != "completed"
		var output strings.Builder
		for _, item := range body.Output {
			if item.Type != "message" {
				continue
			}
			for _, part := range item.Content {
				if part.Type == "output_text" {
					output.WriteString(part.Text)
				}
			}
		}
		result.Output = output.String()
	} else {
		var body dto.OpenAITextResponse
		if err := common.Unmarshal(response.body, &body); err != nil {
			return result, err
		}
		if len(body.Choices) == 0 {
			return result, errors.New("benchmark response has no choices")
		}
		result.Output = body.Choices[0].StringContent()
		result.Truncated = body.Choices[0].FinishReason != "stop"
	}
	return result, nil
}
