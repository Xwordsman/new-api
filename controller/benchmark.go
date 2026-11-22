package controller

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/extensions/benchmark"
	"github.com/QuantumNous/new-api/extensions/channelmonitor"
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
	if selectionErr != nil || channel == nil {
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
	response := executeChannelTest(ctx, channel, userID, modelName, endpoint, true, &channelProbeOptions{group: group, prompt: prompt, maxTokens: uint(maxTokens)})
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
	output, truncated, err := benchmarkStreamOutput(response.body, endpoint == string(constant.EndpointTypeOpenAIResponse))
	result.Output, result.Truncated = output, truncated
	return result, err
}

// RunChannelMonitorProbe uses normal group selection without retries or wallet
// settlement. Only text generation endpoints are allowed for this tiny probe.
func RunChannelMonitorProbe(ctx context.Context, group, modelName string) (channelmonitor.ProbeResult, error) {
	result := channelmonitor.ProbeResult{}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	path := "/v1/chat/completions"
	if strings.Contains(strings.ToLower(modelName), "codex") {
		path = "/v1/responses"
	}
	c.Request = httptest.NewRequestWithContext(ctx, http.MethodPost, path, nil)
	common.SetContextKey(c, constant.ContextKeyUsingGroup, group)
	channel, _, selectionErr := service.SelectChannelForRequest(c, modelName, &service.RetryParam{Ctx: c, TokenGroup: group, ModelName: modelName, RequestPath: path})
	if selectionErr != nil || channel == nil {
		return result, errors.New("monitor route unavailable")
	}
	result.ChannelID = channel.Id
	userID, err := resolveChannelTestUserID(nil)
	if err != nil {
		return result, errors.New("monitor test account unavailable")
	}
	endpoint := string(constant.EndpointTypeOpenAI)
	if path == "/v1/responses" || channel.Type == constant.ChannelTypeCodex {
		endpoint = string(constant.EndpointTypeOpenAIResponse)
	}
	response := executeChannelTest(ctx, channel, userID, modelName, endpoint, true, &channelProbeOptions{
		group: group, prompt: channelmonitor.ProbePrompt, maxTokens: channelmonitor.ProbeMaxTokens, monitor: true,
	})
	if response.localErr != nil || response.newAPIError != nil {
		return result, errors.New("monitor upstream request failed")
	}
	output, _, err := benchmarkStreamOutput(response.body, endpoint == string(constant.EndpointTypeOpenAIResponse))
	if err != nil || strings.TrimSpace(output) == "" {
		return result, errors.New("monitor empty or interrupted response")
	}
	if response.usage != nil {
		result.InputTokens = response.usage.PromptTokens
		result.OutputTokens = response.usage.CompletionTokens
	}
	result.TTFTMS = response.ttftMS
	return result, nil
}

// benchmarkStreamOutput grades only user-visible output, never reasoning or
// tool deltas. A protocol terminal is required even if an adaptor emitted DONE
// after an interrupted stream. Responses terminal output replaces deltas so
// the same answer is not concatenated twice.
func benchmarkStreamOutput(body []byte, responses bool) (string, bool, error) {
	var output strings.Builder
	terminal, truncated := false, false
	scanner := bufio.NewScanner(bytes.NewReader(body))
	scanner.Buffer(make([]byte, 4096), 8<<20)
	for scanner.Scan() {
		line, ok := strings.CutPrefix(scanner.Text(), "data:")
		if !ok {
			continue
		}
		line = strings.TrimSpace(line)
		if line == "" || line == "[DONE]" {
			continue
		}
		var event struct {
			Type    string `json:"type"`
			Delta   string `json:"delta"`
			Error   any    `json:"error"`
			Choices []struct {
				Index int `json:"index"`
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
			Response *struct {
				Status string `json:"status"`
				Output []struct {
					Type    string `json:"type"`
					Content []struct {
						Type string `json:"type"`
						Text string `json:"text"`
					} `json:"content"`
				} `json:"output"`
			} `json:"response"`
		}
		if common.UnmarshalJsonStr(line, &event) != nil || event.Error != nil || event.Type == "error" || event.Type == "response.failed" || event.Type == "response.cancelled" {
			return "", false, errors.New("benchmark stream failed")
		}
		if responses {
			switch event.Type {
			case "response.output_text.delta":
				output.WriteString(event.Delta)
			case "response.completed", "response.incomplete":
				terminal = true
				truncated = event.Type == "response.incomplete"
				if event.Response != nil && event.Response.Output != nil {
					output.Reset()
					for _, item := range event.Response.Output {
						if item.Type != "message" {
							continue
						}
						for _, part := range item.Content {
							if part.Type == "output_text" {
								output.WriteString(part.Text)
							}
						}
					}
				}
			}
		} else {
			for _, choice := range event.Choices {
				if choice.Index != 0 {
					continue
				}
				output.WriteString(choice.Delta.Content)
				if choice.FinishReason != nil && *choice.FinishReason != "" {
					terminal = true
					truncated = *choice.FinishReason != "stop"
				}
			}
		}
		if output.Len() > 512<<10 {
			return "", false, errors.New("benchmark output too large")
		}
	}
	if scanner.Err() != nil || !terminal {
		return "", false, errors.New("benchmark stream interrupted")
	}
	return output.String(), truncated, nil
}
