package benchmark

import (
	"cmp"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// The first supported upstream is deliberately origin-bound. Channel API keys
// and browser sessions are never reused as management credentials. Operators
// supply a dedicated, revocable read credential in the deployment environment.
const apiznOrigin = "https://ai.apizn.com"

func syncTokenName(channel int) string {
	return "BENCHMARK_UPSTREAM_TOKEN_" + strconv.Itoa(channel)
}

func syncSource(g GroupSettings) string {
	data, _ := common.Marshal([]any{apiznOrigin, g.UpstreamChannel, g.UpstreamGroup, g.Model, g.CandyEnabled, g.SVGEnabled})
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func supportsSync(channel model.Channel) bool {
	if channel.BaseURL == nil {
		return false
	}
	u, err := url.Parse(*channel.BaseURL)
	return err == nil && u.Scheme == "https" && u.Host == "ai.apizn.com" && u.User == nil && u.RawQuery == "" && u.Fragment == "" && (strings.TrimRight(u.Path, "/") == "" || strings.TrimRight(u.Path, "/") == "/v1")
}

func syncChannel(db *gorm.DB, g GroupSettings) (model.Channel, error) {
	var channel model.Channel
	err := db.Select("id", "name", "base_url", "status", "group").Where("id = ?", g.UpstreamChannel).Take(&channel).Error
	if err != nil {
		return channel, err
	}
	if !supportsSync(channel) || channel.Status != common.ChannelStatusEnabled || !slices.Contains(strings.Split(channel.Group, ","), g.Group) {
		return channel, errInvalid
	}
	return channel, nil
}

type upstreamRun struct {
	ID                int64  `json:"id"`
	Group             string `json:"group"`
	Model             string `json:"model"`
	StartedAt         int64  `json:"started_at"`
	FinishedAt        int64  `json:"finished_at"`
	Status            string `json:"status"`
	SVGStatus         string `json:"svg_status"`
	DurationMS        int64  `json:"duration_ms"`
	InputTokens       int    `json:"input_tokens"`
	OutputTokens      int    `json:"output_tokens"`
	Scene             string `json:"scene"`
	HTML              string `json:"html"`
	Prompt            string `json:"prompt"`
	CandyStatus       string `json:"candy_status"`
	CandyPrompt       string `json:"candy_prompt"`
	CandyAnswer       string `json:"candy_answer"`
	CandyDurationMS   int64  `json:"candy_duration_ms"`
	CandyInputTokens  int    `json:"candy_input_tokens"`
	CandyOutputTokens int    `json:"candy_output_tokens"`
}

type upstreamTimeline struct {
	Items     []upstreamRun    `json:"items"`
	Targets   []upstreamTarget `json:"targets"`
	Truncated bool             `json:"truncated"`
}

type upstreamTarget struct {
	Group     string `json:"group"`
	Model     string `json:"model"`
	Available bool   `json:"available"`
	Enabled   bool   `json:"enabled"`
}

type upstreamClient struct {
	http  *http.Client
	token string
}

func (client upstreamClient) get(ctx context.Context, path string, dst any, limit int64) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiznOrigin+path, nil)
	if err != nil {
		return errors.New("upstream_request_failed")
	}
	req.Header.Set("Authorization", "Bearer "+client.token)
	req.Header.Set("Accept", "application/json")
	response, err := client.http.Do(req)
	if err != nil {
		return errors.New("upstream_request_failed")
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		return errors.New("upstream_unauthorized")
	}
	if response.StatusCode != http.StatusOK {
		return errors.New("upstream_request_failed")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil || int64(len(data)) > limit {
		return errors.New("upstream_invalid_response")
	}
	var envelope struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
	}
	if common.Unmarshal(data, &envelope) != nil || !envelope.Success || len(envelope.Data) == 0 || string(envelope.Data) == "null" || common.Unmarshal(envelope.Data, dst) != nil {
		return errors.New("upstream_invalid_response")
	}
	return nil
}

// A sync has the same system-task lease as scheduled local probes. Failures
// persist a separate health state; they never invoke ProbeExecutor or create
// fake failed model answers. Already imported records remain available.
func syncGroup(ctx context.Context, db *gorm.DB, s Settings, g GroupSettings, now int64) error {
	var state GroupState
	if err := db.WithContext(ctx).Where("group_name = ?", g.Group).Take(&state).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if state.SyncSource != syncSource(g) {
		state.LastSyncAt, state.UpstreamAt = 0, 0
	}
	state.GroupName, state.SyncSource, state.LastAutoAt = g.Group, syncSource(g), now
	state.SyncError = ""
	token := strings.TrimSpace(os.Getenv(syncTokenName(g.UpstreamChannel)))
	if _, err := syncChannel(db.WithContext(ctx), g); err != nil {
		state.SyncError = "upstream_channel_unavailable"
	} else if token == "" || len(token) > 8192 || strings.ContainsAny(token, "\r\n") {
		state.SyncError = "upstream_token_missing"
	} else {
		base := service.GetSSRFProtectedHTTPClient()
		if base == nil {
			return errors.New("benchmark HTTP client unavailable")
		}
		client := *base
		transport, ok := client.Transport.(*http.Transport)
		if !ok {
			return errors.New("benchmark HTTP transport unavailable")
		}
		transport = transport.Clone()
		if transport.TLSClientConfig != nil {
			transport.TLSClientConfig = transport.TLSClientConfig.Clone()
			transport.TLSClientConfig.InsecureSkipVerify = false
		}
		client.Transport = transport
		defer transport.CloseIdleConnections()
		client.Jar = nil
		client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
		syncCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
		latest, err := (upstreamClient{http: &client, token: token}).importRuns(syncCtx, db, s, g, now)
		cancel()
		state.UpstreamAt = max(state.UpstreamAt, latest)
		if err != nil {
			state.SyncError = err.Error() // Only fixed, non-secret codes cross this boundary.
		} else {
			state.LastSyncAt = now
		}
	}
	writeCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return db.WithContext(writeCtx).Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "group_name"}}, DoUpdates: clause.AssignmentColumns([]string{"last_auto_at", "sync_source", "last_sync_at", "sync_error", "upstream_at"})}).Create(&state).Error
}

func (client upstreamClient) importRuns(ctx context.Context, db *gorm.DB, s Settings, g GroupSettings, now int64) (int64, error) {
	var timeline upstreamTimeline
	if err := client.get(ctx, "/api/benchmark/runs?timeline=1", &timeline, 4<<20); err != nil {
		return 0, err
	}
	if len(timeline.Items) > 2000 || len(timeline.Targets) > 100 {
		return 0, errors.New("upstream_invalid_response")
	}
	available := slices.ContainsFunc(timeline.Targets, func(target upstreamTarget) bool {
		return target.Group == g.UpstreamGroup && target.Model == g.Model && target.Available && target.Enabled
	})
	if !available {
		return 0, errors.New("upstream_target_missing")
	}
	slices.SortFunc(timeline.Items, func(a, b upstreamRun) int { return cmp.Compare(b.ID, a.ID) })
	var latestCandy, latestSVG int64
	details := 0
	for _, item := range timeline.Items {
		if item.SVGStatus == "" {
			item.SVGStatus = item.Status
		}
		if item.ID <= 0 || item.Group != g.UpstreamGroup || item.Model != g.Model || item.FinishedAt <= 0 || item.StartedAt < now-int64(s.RetentionDays)*86400 {
			continue
		}
		if item.FinishedAt > now+300 || item.StartedAt <= 0 || item.StartedAt > item.FinishedAt {
			return 0, errors.New("upstream_invalid_response")
		}
		if g.CandyEnabled && upstreamTerminal(item.CandyStatus) {
			latestCandy = max(latestCandy, item.FinishedAt)
		}
		if g.SVGEnabled && upstreamTerminal(item.SVGStatus) {
			latestSVG = max(latestSVG, item.FinishedAt)
		}
		var kinds []string
		for _, kind := range []string{"candy", "svg"} {
			if kind == "candy" && (!g.CandyEnabled || !upstreamTerminal(item.CandyStatus)) || kind == "svg" && (!g.SVGEnabled || !upstreamTerminal(item.SVGStatus)) {
				continue
			}
			var count int64
			if err := db.WithContext(ctx).Model(&SyncReceipt{}).Where(clause.Eq{Column: "key", Value: importKey(g, item.ID, kind)}).Count(&count).Error; err != nil {
				return 0, errors.New("upstream_storage_failed")
			}
			if count == 0 {
				kinds = append(kinds, kind)
			}
		}
		if len(kinds) == 0 {
			continue
		}
		if details >= 48 {
			return 0, errors.New("upstream_backlog")
		}
		details++
		var detail upstreamRun
		if err := client.get(ctx, "/api/benchmark/runs/"+strconv.FormatInt(item.ID, 10), &detail, 2<<20); err != nil {
			return 0, err
		}
		if detail.ID != item.ID || detail.Group != g.UpstreamGroup || detail.Model != g.Model || detail.StartedAt != item.StartedAt || detail.FinishedAt != item.FinishedAt || len(detail.HTML) > maxOutputBytes || len(detail.CandyAnswer) > maxOutputBytes || len(detail.Prompt) > 32000 || len(detail.CandyPrompt) > 32000 || utf8.RuneCountInString(detail.Scene) > 160 || detail.InputTokens < 0 || detail.OutputTokens < 0 || detail.CandyInputTokens < 0 || detail.CandyOutputTokens < 0 || detail.DurationMS < 0 || detail.CandyDurationMS < 0 {
			return 0, errors.New("upstream_invalid_response")
		}
		for _, kind := range kinds {
			run := Run{GroupName: g.Group, Model: detail.Model, Kind: kind, Origin: "apizn", UpstreamID: detail.ID, UpstreamGroup: detail.Group, UpstreamURL: apiznOrigin + "/pelican/" + strconv.FormatInt(detail.ID, 10), SyncedAt: now, CreatedAt: detail.StartedAt, FinishedAt: detail.FinishedAt, ChannelID: g.UpstreamChannel}
			status := detail.SVGStatus
			if status == "" {
				status = detail.Status
			}
			run.Output, run.Prompt, run.PromptName = model.LongText(detail.HTML), detail.Prompt, detail.Scene
			run.LatencyMS, run.InputTokens, run.OutputTokens = detail.DurationMS, detail.InputTokens, detail.OutputTokens
			if kind == "candy" {
				status = detail.CandyStatus
				run.Output, run.Prompt, run.PromptName = model.LongText(detail.CandyAnswer), detail.CandyPrompt, ""
				run.LatencyMS, run.InputTokens, run.OutputTokens = detail.CandyDurationMS, detail.CandyInputTokens, detail.CandyOutputTokens
			}
			if !upstreamTerminal(status) {
				return 0, errors.New("upstream_invalid_response")
			}
			run.Status, run.ErrorCode = upstreamVerdict(status)
			if run.Status == "passed" && kind == "svg" {
				run.Status, run.ErrorCode = evaluate(run, ProbeResult{Output: detail.HTML}, nil)
			}
			if run.Status == "passed" && kind == "candy" && strings.TrimSpace(detail.CandyAnswer) == "" {
				run.Status, run.ErrorCode = "invalid", "upstream_invalid_response"
			}
			err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
				receipt := SyncReceipt{Key: importKey(g, item.ID, kind)}
				insert := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&receipt)
				if insert.Error != nil {
					return insert.Error
				}
				if insert.RowsAffected == 0 {
					return nil
				}
				return tx.Create(&run).Error
			})
			if err != nil {
				return 0, errors.New("upstream_storage_failed")
			}
		}
	}
	// Fresh SVG output cannot make an older or missing candy check look current.
	latest := latestCandy
	if !g.CandyEnabled {
		latest = latestSVG
	} else if g.SVGEnabled {
		latest = min(latestCandy, latestSVG)
	}
	if timeline.Truncated {
		return latest, errors.New("upstream_history_truncated")
	}
	if latest == 0 {
		return 0, errors.New("upstream_no_results")
	}
	return latest, nil
}

func importKey(g GroupSettings, id int64, kind string) string {
	data, _ := common.Marshal([]any{apiznOrigin, g.Group, g.UpstreamGroup, g.Model, id, kind})
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func upstreamTerminal(status string) bool {
	return slices.Contains([]string{"passed", "succeeded", "wrong_answer", "failed", "error", "invalid", "timeout", "truncated", "skipped"}, status)
}

func upstreamVerdict(status string) (string, string) {
	switch status {
	case "passed", "succeeded":
		return "passed", ""
	case "wrong_answer", "invalid", "timeout", "truncated":
		return status, status
	default:
		return "request_failed", "upstream_reported_failure"
	}
}
