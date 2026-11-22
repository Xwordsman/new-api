package policy

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"path"
	"regexp"
	"slices"
	"strings"
	"unicode"

	"github.com/QuantumNous/new-api/common"
	"golang.org/x/text/unicode/norm"
)

type Segment struct {
	Source string `json:"source"`
	Text   string `json:"text"`
}
type Input struct {
	ChannelID   int       `json:"channel_id"`
	IP          string    `json:"ip"`
	UserID      int       `json:"user_id"`
	TokenID     int       `json:"token_id"`
	RequestID   string    `json:"request_id"`
	Group       string    `json:"group"`
	Model       string    `json:"model"`
	Protocol    string    `json:"protocol"`
	Segments    []Segment `json:"segments"`
	Uninspected string    `json:"uninspected"`
}
type Hit struct {
	Matched        string `json:"matched,omitempty"`
	Category       string `json:"category,omitempty"`
	Evidence       string `json:"evidence,omitempty"`
	RuleID         string `json:"rule_id"`
	Name           string `json:"name"`
	Source         string `json:"source"`
	Action         string `json:"action"`
	HighConfidence bool   `json:"high_confidence"`
	CountPenalty   bool   `json:"count_penalty"`
}
type Verdict struct {
	ImmediateSuspend bool   `json:"immediate_suspend"`
	Finding          string `json:"finding"`
	Reason           string `json:"reason"`
	Hits             []Hit  `json:"hits"`
	Decision         string `json:"decision"`
	Eligible         bool   `json:"eligible"`
	Digest           string `json:"digest"`
	Uninspected      string `json:"uninspected"`
}

// Normalize deliberately does not decode base64 or execute client content.
func Normalize(text string) string {
	text = norm.NFKC.String(text)
	var b strings.Builder
	space := false
	for _, r := range text {
		if unicode.Is(unicode.Cf, r) {
			continue
		}
		if unicode.IsSpace(r) {
			if b.Len() > 0 {
				space = true
			}
			continue
		}
		if space {
			b.WriteByte(' ')
			space = false
		}
		b.WriteRune(unicode.ToLower(r))
	}
	return b.String()
}

func Digest(secret, purpose, text string) string {
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(purpose))
	h.Write([]byte{0})
	h.Write([]byte(text))
	return hex.EncodeToString(h.Sum(nil))
}

func InScope(s Settings, in Input) bool {
	// Before routing, conservatively inspect requests that could reach a
	// protected channel. A later check binds the result to the selected channel.
	if in.ChannelID > 0 && len(s.ChannelIDs) > 0 && !slices.Contains(s.ChannelIDs, in.ChannelID) {
		return false
	}
	if slices.Contains(s.ExemptUserIDs, in.UserID) {
		return false
	}
	if len(s.Groups) > 0 && !slices.Contains(s.Groups, in.Group) {
		return false
	}
	if len(s.Protocols) > 0 && !slices.Contains(s.Protocols, in.Protocol) {
		return false
	}
	if len(s.Models) == 0 {
		return true
	}
	for _, p := range s.Models {
		if ok, _ := path.Match(p, in.Model); ok {
			return true
		}
	}
	return false
}

func Inspect(s Settings, in Input, secret string) Verdict {
	v := Verdict{Decision: "allow", Finding: "clear", Hits: []Hit{}, Uninspected: in.Uninspected}
	// Aggregate content parts of one source without mixing trustedness levels.
	texts := map[string]string{}
	var canonical strings.Builder
	remaining := s.MaxTextBytes
	// Check current input first even when history precedes it in the protocol.
	segments := slices.Clone(in.Segments)
	slices.SortStableFunc(segments, func(a, b Segment) int {
		order := []string{"current", "system", "history", "tool"}
		return slices.Index(order, a.Source) - slices.Index(order, b.Source)
	})
	builders := map[string]*strings.Builder{}
	for i, segment := range segments {
		text := segment.Text
		if len(text) > remaining {
			text = bounded(text, remaining)
			v.Uninspected = "text_limit"
		}
		remaining -= len(text)
		if text != "" {
			if builders[segment.Source] == nil {
				builders[segment.Source] = &strings.Builder{}
			}
			builders[segment.Source].WriteByte('\n')
			builders[segment.Source].WriteString(text)
		}
		if remaining == 0 {
			if i+1 < len(segments) {
				v.Uninspected = "text_limit"
			}
			break
		}
	}
	for _, source := range []string{"current", "system", "history", "tool"} {
		if builders[source] != nil {
			texts[source] = Normalize(builders[source].String())
		}
		canonical.WriteString(source)
		canonical.WriteByte(0)
		canonical.WriteString(texts[source])
		canonical.WriteByte(0)
	}
	canonical.WriteString(v.Uninspected)
	v.Digest = Digest(secret, "request-content", canonical.String())
	if !s.Enabled || !InScope(s, in) {
		return v
	}
	if s.Keywords.Enabled && builders["current"] != nil {
		inspectKeywords(s, builders["current"].String(), &v)
	}
	for _, r := range s.Rules {
		if !r.Enabled {
			continue
		}
		for _, source := range r.Sources {
			text := texts[source]
			if text == "" {
				continue
			}
			matched := r.Kind == "all"
			matchedText := []string{}
			for _, p := range r.Patterns {
				found := false
				if r.Kind == "regex" {
					re, err := regexp.Compile(p)
					found = err == nil && re.MatchString(text)
					if found {
						matchedText = append(matchedText, re.FindString(text))
					}
				} else {
					found = strings.Contains(text, Normalize(p))
					if found {
						matchedText = append(matchedText, Normalize(p))
					}
				}
				if r.Kind == "all" {
					matched = matched && found
				} else {
					matched = matched || found
				}
			}
			if !matched {
				continue
			}
			// Context is normalized and redacted before it is bounded or stored.
			evidence := "[REDACTED]"
			safeText := Redact(text)
			if len(matchedText) > 0 {
				if position := strings.Index(safeText, matchedText[0]); position >= 0 {
					evidence = bounded(safeText[position:], 320)
				}
			}
			h := Hit{RuleID: r.ID, Name: r.Name, Category: r.Category, Evidence: evidence, Source: source, Action: r.Action, HighConfidence: r.HighConfidence, CountPenalty: r.CountPenalty, Matched: bounded(Redact(strings.Join(matchedText, " · ")), 1200)}
			v.Hits = append(v.Hits, h)
			v.Finding, v.Reason = "rule_match", "custom_rule"
			if v.Decision == "allow" {
				v.Decision = "observe"
			}
			if s.Mode == "enforce" && r.Action == "block" {
				v.Decision = "block"
				// Quoted history and tool output never accrue automatic penalties.
				v.Eligible = v.Eligible || (r.HighConfidence && r.CountPenalty && (source == "current" || source == "system"))
			}
		}
	}
	if v.Uninspected != "" && s.UninspectedAction != "allow" {
		v.Finding, v.Reason = "check_failed", "incomplete_input"
		if v.Decision == "allow" {
			v.Decision = "observe"
		}
		if s.Mode == "enforce" && s.UninspectedAction == "block" {
			v.Decision = "block"
		}
	}
	if s.Mode == "enforce" && s.RequireCompleteText && slices.Contains([]string{"body_limit", "text_limit", "nested_content_limit", "unsupported_payload", "realtime_uninspected"}, v.Uninspected) {
		v.Decision = "block"
		// Incomplete inspection is a protective rejection, never a penalty.
		v.Eligible = false
		v.Finding, v.Reason = "check_failed", "incomplete_input"
	}
	// Bound persisted matching evidence independently of the request text.
	if len(v.Hits) > 40 {
		v.Hits = append(v.Hits[:40], Hit{RuleID: "more-matches", Name: "Additional matches omitted", Source: "current", Action: "observe"})
	}
	return v
}

// Extract recognizes text-bearing protocol fields only. Unknown fields and
// binary media are never turned into strings (or mistaken for safe text).
func Extract(body []byte, protocol string) ([]Segment, string) {
	var root map[string]any
	if common.Unmarshal(body, &root) != nil {
		return nil, "unsupported_payload"
	}
	segments := []Segment{}
	partial := ""
	if system, ok := root["system"]; ok {
		segments, partial = appendContent(segments, "system", system, partial, 0)
	}
	if system, ok := root["systemInstruction"].(map[string]any); ok {
		segments, partial = appendContent(segments, "system", system["parts"], partial, 0)
	}
	if system, ok := root["system_instruction"].(map[string]any); ok {
		segments, partial = appendContent(segments, "system", system["parts"], partial, 0)
	}
	if instruction, ok := root["instructions"]; ok {
		segments, partial = appendContent(segments, "system", instruction, partial, 0)
	}
	var messages []any
	if values, ok := root["messages"].([]any); ok {
		messages = values
	}
	if values, ok := root["contents"].([]any); ok {
		messages = values
	}
	if input, ok := root["input"]; ok {
		if values, ok := input.([]any); ok {
			messages = values
		} else {
			segments, partial = appendContent(segments, "current", input, partial, 0)
		}
	}
	lastUser := -1
	for i, value := range messages {
		if message, ok := value.(map[string]any); ok {
			role, _ := message["role"].(string)
			kind, _ := message["type"].(string)
			if role == "user" || (role == "" && slices.Contains([]string{"", "message", "input_text", "input_image", "input_file"}, kind)) {
				lastUser = i
			}
		}
	}
	for i, value := range messages {
		message, ok := value.(map[string]any)
		if !ok {
			segments, partial = appendContent(segments, "current", value, partial, 0)
			continue
		}
		role, _ := message["role"].(string)
		source := "history"
		switch role {
		case "system", "developer":
			source = "system"
		case "tool", "function":
			source = "tool"
		default:
			if i == lastUser {
				source = "current"
			}
		}
		kind, _ := message["type"].(string)
		if isMediaContent(message) && partial == "" {
			partial = "binary_media"
		}
		if slices.Contains([]string{"function_call", "function_call_output", "custom_tool_call", "custom_tool_call_output", "tool_result"}, kind) {
			source = "tool"
		}
		if content, ok := message["content"]; ok {
			segments, partial = appendContent(segments, source, content, partial, 0)
		}
		if parts, ok := message["parts"]; ok {
			segments, partial = appendContent(segments, source, parts, partial, 0)
		}
		if output, ok := message["output"]; ok {
			segments, partial = appendToolData(segments, "tool", output, partial, false, 0)
		}
		if text, ok := message["text"]; ok {
			segments, partial = appendContent(segments, source, text, partial, 0)
		}
		if calls, ok := message["tool_calls"]; ok {
			segments, partial = appendContent(segments, "tool", calls, partial, 0)
		}
		if call, ok := message["function_call"]; ok {
			segments, partial = appendContent(segments, "tool", call, partial, 0)
		}
		if kind == "function_call" {
			segments, partial = appendToolData(segments, "tool", message["arguments"], partial, false, 0)
		}
		if kind == "custom_tool_call" {
			segments, partial = appendToolData(segments, "tool", message["input"], partial, false, 0)
		}
		if kind == "reasoning" {
			// Summaries are readable history; encrypted provider state is not
			// user-authored text and must not replace the latest user turn.
			segments, partial = appendContent(segments, "history", message["summary"], partial, 0)
		}
	}
	for _, key := range []string{"tools", "functions"} {
		if value, ok := root[key]; ok {
			// Definitions describe tools, including built-in and custom tools. Their
			// schema property names are text, not actual attachment fields.
			segments, partial = appendToolData(segments, "tool", value, partial, true, 0)
		}
	}
	for _, key := range []string{"prompt", "negative_prompt", "query", "text", "content"} {
		if value, ok := root[key]; ok {
			if key == "text" && protocol == "openai_responses" {
				if config, ok := value.(map[string]any); ok {
					// Responses.text describes the output format, not user input.
					// Inspect schema descriptions without treating them as media.
					segments, partial = appendToolData(segments, "tool", config, partial, true, 0)
					continue
				}
			}
			segments, partial = appendContent(segments, "current", value, partial, 0)
		}
	}
	if metadata, ok := root["metadata"].(map[string]any); ok {
		for _, key := range []string{"prompt", "negative_prompt"} {
			if value, ok := metadata[key]; ok {
				segments, partial = appendContent(segments, "current", value, partial, 0)
			}
		}
	}
	for _, key := range []string{"image", "images", "audio", "file", "files", "image_url", "image_urls", "base64", "base64Array", "maskBase64"} {
		if value, ok := root[key]; ok {
			switch value := value.(type) {
			case nil:
				continue
			case string:
				if value == "" {
					continue
				}
			case []any:
				if len(value) == 0 {
					continue
				}
			case map[string]any:
				if len(value) == 0 {
					continue
				}
			}
			if partial == "" {
				partial = "binary_media"
			}
		}
	}
	if len(segments) == 0 && partial == "" {
		partial = "unsupported_payload"
	}
	if protocol == "openai_realtime" {
		partial = "realtime_uninspected"
	}
	return segments, partial
}

func appendContent(out []Segment, source string, content any, partial string, depth int) ([]Segment, string) {
	if depth > 12 {
		return out, "nested_content_limit"
	}
	switch v := content.(type) {
	case string:
		if v != "" {
			out = append(out, Segment{Source: source, Text: v})
		}
	case []any:
		for _, item := range v {
			out, partial = appendContent(out, source, item, partial, depth+1)
		}
	case map[string]any:
		kind, _ := v["type"].(string)
		media := isMediaContent(v)
		if media && partial == "" {
			partial = "binary_media"
		}
		if kind == "tool_result" || kind == "function_call_output" {
			source = "tool"
		}
		// Claude replays signed thinking blocks in assistant history. Inspect
		// readable thinking, but never turn signatures or redacted state into text.
		textFound := kind == "redacted_thinking" && source == "history"
		if kind == "thinking" {
			if thinking, ok := v["thinking"]; ok {
				out, partial = appendContent(out, source, thinking, partial, depth+1)
				textFound = true
			}
		}
		if kind == "tool_use" || kind == "server_tool_use" {
			out, partial = appendToolData(out, "tool", v["input"], partial, false, depth+1)
			textFound = true
		}
		for _, key := range []string{"text", "content", "output", "description", "arguments"} {
			if value, ok := v[key]; ok {
				if key == "arguments" || key == "output" {
					out, partial = appendToolData(out, source, value, partial, false, depth+1)
				} else {
					out, partial = appendContent(out, source, value, partial, depth+1)
				}
				textFound = true
			}
		}
		for _, key := range []string{"function", "functionCall", "functionResponse", "tool_calls", "functionDeclarations"} {
			if value, ok := v[key]; ok {
				out, partial = appendContent(out, "tool", value, partial, depth+1)
				textFound = true
			}
		}
		for _, key := range []string{"parameters", "input_schema", "args", "response"} {
			if value, ok := v[key]; ok {
				out, partial = appendToolData(out, "tool", value, partial, key == "parameters" || key == "input_schema", depth+1)
				textFound = true
			}
		}
		if !textFound && !media && partial == "" {
			partial = "binary_or_unknown_content"
		}
	case nil:
	default:
		partial = "unsupported_payload"
	}
	return out, partial
}

func isMediaContent(content map[string]any) bool {
	kind, _ := content["type"].(string)
	if slices.Contains([]string{"image", "image_url", "input_image", "audio", "input_audio", "video", "input_video", "file", "input_file", "document"}, kind) {
		return true
	}
	for _, key := range []string{"inline_data", "inlineData", "file_data", "fileData"} {
		if _, ok := content[key].(map[string]any); ok {
			return true
		}
	}
	return false
}

// Tool arguments, output and JSON schemas contain arbitrary keys. Inspect
// their string leaves deterministically without decoding binary attachments.
// Schema definitions (including examples) are metadata, not media instances.
func appendToolData(out []Segment, source string, value any, partial string, schema bool, depth int) ([]Segment, string) {
	if depth > 32 {
		return out, "nested_content_limit"
	}
	switch v := value.(type) {
	case map[string]any:
		if !schema && isMediaContent(v) {
			return appendContent(out, source, v, partial, depth+1)
		}
		keys := make([]string, 0, len(v))
		for key := range v {
			keys = append(keys, key)
		}
		slices.Sort(keys)
		for _, key := range keys {
			out = append(out, Segment{Source: source, Text: key})
			out, partial = appendToolData(out, source, v[key], partial, schema, depth+1)
		}
	case []any:
		for _, item := range v {
			out, partial = appendToolData(out, source, item, partial, schema, depth+1)
		}
	case string:
		metadata, _, dataURL := strings.Cut(strings.TrimSpace(v), ",")
		if !schema && dataURL && strings.HasPrefix(metadata, "data:") && (strings.Contains(metadata, ";base64") || strings.HasPrefix(metadata, "data:image/") || strings.HasPrefix(metadata, "data:audio/") || strings.HasPrefix(metadata, "data:video/")) {
			if partial == "" {
				partial = "binary_media"
			}
			return out, partial
		}
		out = append(out, Segment{Source: source, Text: v})
	}
	return out, partial
}
