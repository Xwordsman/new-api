package channelmonitor

import (
	"math"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const sampleLimit = 10000
const bucketCount = 48

type Metrics struct {
	Outcomes           int      `json:"outcomes"`
	Successes          int      `json:"successes"`
	SuccessRate        *float64 `json:"success_rate"`
	TTFTSeconds        *float64 `json:"ttft_seconds"`
	TokensPerSecond    *float64 `json:"tokens_per_second"`
	CacheHitRate       *float64 `json:"cache_hit_rate"`
	TTFTSamples        int      `json:"ttft_samples"`
	SpeedSamples       int      `json:"speed_samples"`
	CacheSamples       int      `json:"cache_samples"`
	LatencySeconds     *float64 `json:"latency_seconds"`
	FastestTTFT        *float64 `json:"fastest_ttft_seconds"`
	MaxTokensPerSecond *float64 `json:"max_tokens_per_second"`
	LatencySamples     int      `json:"latency_samples"`
	latencySeconds     float64
	frtMS              float64
	generationMS       float64
	outputTokens       float64
	inputTokens        float64
	cacheTokens        float64
}

type Bucket struct {
	Start       int64    `json:"start"`
	End         int64    `json:"end"`
	Outcomes    int      `json:"outcomes"`
	Successes   int      `json:"successes"`
	SuccessRate *float64 `json:"success_rate"`
	Status      string   `json:"status"`
}

type ModelStats struct {
	Model   string `json:"model"`
	Enabled bool   `json:"enabled"`
	Metrics
}

type GroupStats struct {
	Metrics
	Timeline      []Bucket     `json:"timeline"`
	Models        []ModelStats `json:"models"`
	SampleLimited bool         `json:"sample_limited"`
	ObservedFrom  int64        `json:"observed_from"`
}

// Only these fields are decoded. Neither raw metadata nor routing diagnostics
// are ever included in the user-facing response.
type logMetadata struct {
	FRT              *float64 `json:"frt"`
	CacheTokens      *float64 `json:"cache_tokens"`
	CacheWriteTokens float64  `json:"cache_write_tokens"`
	CacheCreation    float64  `json:"cache_creation_tokens"`
	InputTokensTotal float64  `json:"input_tokens_total"`
	UsageSemantic    string   `json:"usage_semantic"`
	StreamStatus     *struct {
		Status string `json:"status"`
	} `json:"stream_status"`
	AdminInfo struct {
		RequestPolicy []struct {
			ChannelID   int    `json:"channel_id"`
			ErrorSource string `json:"error_source"`
		} `json:"request_policy"`
	} `json:"admin_info"`
}

func (m *Metrics) observe(log model.Log, metadata logMetadata, success bool) {
	m.Outcomes++
	if !success {
		return
	}
	m.Successes++
	if log.UseTime > 0 {
		m.latencySeconds += float64(log.UseTime)
		m.LatencySamples++
	}
	// UseTime is stored in whole seconds. Throughput is therefore an estimate;
	// only stream records with a usable generation interval contribute to it.
	if log.IsStream && metadata.FRT != nil && *metadata.FRT >= 0 && *metadata.FRT <= float64(log.UseTime+1)*1000 {
		m.frtMS += *metadata.FRT
		m.TTFTSamples++
		seconds := *metadata.FRT / 1000
		if m.FastestTTFT == nil || seconds < *m.FastestTTFT {
			m.FastestTTFT = &seconds
		}
		generationMS := float64(log.UseTime)*1000 - *metadata.FRT
		if generationMS > 0 && log.CompletionTokens > 0 {
			m.generationMS += generationMS
			m.outputTokens += float64(log.CompletionTokens)
			m.SpeedSamples++
			speed := float64(log.CompletionTokens) / generationMS * 1000
			if m.MaxTokensPerSecond == nil || speed > *m.MaxTokensPerSecond {
				m.MaxTokensPerSecond = &speed
			}
		}
	}
	if metadata.CacheTokens == nil || *metadata.CacheTokens < 0 || *metadata.CacheTokens > math.MaxInt64 || log.PromptTokens < 0 ||
		metadata.InputTokensTotal < 0 || metadata.InputTokensTotal > math.MaxInt64 || metadata.CacheWriteTokens < 0 || metadata.CacheWriteTokens > math.MaxInt64 || metadata.CacheCreation < 0 || metadata.CacheCreation > math.MaxInt64 {
		return
	}
	input := float64(log.PromptTokens)
	if metadata.InputTokensTotal > 0 {
		input = metadata.InputTokensTotal
	} else if metadata.UsageSemantic == "anthropic" {
		// Anthropic input_tokens excludes cache reads and writes. Prefer the
		// already normalized input total when the gateway supplies one.
		input += *metadata.CacheTokens + max(metadata.CacheWriteTokens, metadata.CacheCreation)
	}
	if input > 0 && *metadata.CacheTokens <= input {
		m.inputTokens += input
		m.cacheTokens += *metadata.CacheTokens
		m.CacheSamples++
	}
}

func (m *Metrics) finish(completeLogs bool) {
	if m.LatencySamples > 0 {
		seconds := m.latencySeconds / float64(m.LatencySamples)
		m.LatencySeconds = &seconds
	}
	if completeLogs && m.Outcomes > 0 {
		rate := float64(m.Successes) / float64(m.Outcomes) * 100
		m.SuccessRate = &rate
	}
	if m.TTFTSamples > 0 {
		seconds := m.frtMS / float64(m.TTFTSamples) / 1000
		m.TTFTSeconds = &seconds
	}
	if m.generationMS > 0 {
		speed := m.outputTokens / m.generationMS * 1000
		m.TokensPerSecond = &speed
	}
	if m.inputTokens > 0 {
		rate := m.cacheTokens / m.inputTokens * 100
		m.CacheHitRate = &rate
	}
}

func healthStatus(outcomes int, rate *float64) string {
	if outcomes == 0 {
		return "idle"
	}
	if rate == nil {
		return "unknown"
	}
	if *rate >= 80 {
		return "healthy"
	}
	if *rate >= 60 {
		return "degraded"
	}
	return "unhealthy"
}

func collectStats(db *gorm.DB, group string, window time.Duration, now int64, completeLogs bool) (GroupStats, error) {
	start := now - int64(window.Seconds())
	stats := GroupStats{Timeline: make([]Bucket, bucketCount), Models: []ModelStats{}, ObservedFrom: start}
	step := int64(window.Seconds()) / bucketCount
	for i := range stats.Timeline {
		stats.Timeline[i] = Bucket{Start: start + int64(i)*step, End: start + int64(i+1)*step, Status: "unknown"}
	}
	var logs []model.Log
	// The timestamp bounds and row cap keep scans bounded in memory. This also
	// works on a separately configured log database (no cross-database joins).
	err := db.Model(&model.Log{}).
		Select("created_at", "type", "model_name", "prompt_tokens", "completion_tokens", "use_time", "is_stream", "channel_id", "other").
		Where(clause.Eq{Column: "group", Value: group}).
		Where("created_at >= ? AND created_at <= ? AND type IN ? AND channel_id > ?", start, now, []int{model.LogTypeConsume, model.LogTypeError}, 0).
		Order("created_at DESC").Order("request_id DESC").Limit(sampleLimit + 1).Find(&logs).Error
	if err != nil {
		return stats, err
	}
	if len(logs) > sampleLimit {
		logs = logs[:sampleLimit]
		stats.SampleLimited = true
		stats.ObservedFrom = logs[len(logs)-1].CreatedAt
	}
	models := make(map[string]*ModelStats)
	for _, log := range logs {
		metadata := logMetadata{}
		// A malformed/legacy record still contributes its known outcome, but
		// cannot manufacture latency or cache measurements.
		if common.UnmarshalJsonStr(log.Other, &metadata) != nil {
			metadata = logMetadata{}
		}
		local := false
		if log.Type == model.LogTypeError {
			for i := len(metadata.AdminInfo.RequestPolicy) - 1; i >= 0; i-- {
				event := metadata.AdminInfo.RequestPolicy[i]
				if event.ChannelID == log.ChannelId && event.ErrorSource != "" {
					local = event.ErrorSource == "local"
					break
				}
			}
		}
		if local {
			continue
		}
		success := log.Type == model.LogTypeConsume && (metadata.StreamStatus == nil || metadata.StreamStatus.Status == "ok")
		stats.Metrics.observe(log, metadata, success)
		entry := models[log.ModelName]
		if entry == nil {
			entry = &ModelStats{Model: log.ModelName}
			models[log.ModelName] = entry
		}
		entry.Metrics.observe(log, metadata, success)
		index := min(int((log.CreatedAt-start)/step), bucketCount-1)
		stats.Timeline[index].Outcomes++
		if success {
			stats.Timeline[index].Successes++
		}
	}
	stats.Metrics.finish(completeLogs)
	for _, entry := range models {
		entry.Metrics.finish(completeLogs)
		stats.Models = append(stats.Models, *entry)
	}
	slices.SortFunc(stats.Models, func(a, b ModelStats) int { return strings.Compare(a.Model, b.Model) })
	for i := range stats.Timeline {
		bucket := &stats.Timeline[i]
		if completeLogs && bucket.Outcomes > 0 {
			rate := float64(bucket.Successes) / float64(bucket.Outcomes) * 100
			bucket.SuccessRate = &rate
			bucket.Status = healthStatus(bucket.Outcomes, bucket.SuccessRate)
		}
	}
	return stats, nil
}
