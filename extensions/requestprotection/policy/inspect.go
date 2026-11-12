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
	RuleID         string `json:"rule_id"`
	Name           string `json:"name"`
	Source         string `json:"source"`
	Action         string `json:"action"`
	HighConfidence bool   `json:"high_confidence"`
	CountPenalty   bool   `json:"count_penalty"`
}
type Verdict struct {
	Hits        []Hit  `json:"hits"`
	Decision    string `json:"decision"`
	Eligible    bool   `json:"eligible"`
	Digest      string `json:"digest"`
	Uninspected string `json:"uninspected"`
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
	v := Verdict{Decision: "allow", Hits: []Hit{}, Uninspected: in.Uninspected}
	// Aggregate content parts of one source without mixing trustedness levels.
	texts := map[string]string{}
	var canonical strings.Builder
	remaining := s.MaxTextBytes
	for i, segment := range in.Segments {
		text := segment.Text
		if len(text) > remaining {
			text = bounded(text, remaining)
			v.Uninspected = "text_limit"
		}
		remaining -= len(text)
		if text != "" {
			texts[segment.Source] += "\n" + text
		}
		if remaining == 0 {
			if i+1 < len(in.Segments) {
				v.Uninspected = "text_limit"
			}
			break
		}
	}
	for _, source := range []string{"current", "system", "history", "tool"} {
		texts[source] = Normalize(texts[source])
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
			for _, p := range r.Patterns {
				found := false
				if r.Kind == "regex" {
					re, err := regexp.Compile(p)
					found = err == nil && re.MatchString(text)
				} else {
					found = strings.Contains(text, Normalize(p))
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
			h := Hit{RuleID: r.ID, Name: r.Name, Source: source, Action: r.Action, HighConfidence: r.HighConfidence, CountPenalty: r.CountPenalty}
			v.Hits = append(v.Hits, h)
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
		if v.Decision == "allow" {
			v.Decision = "observe"
		}
		if s.Mode == "enforce" && s.UninspectedAction == "block" {
			v.Decision = "block"
		}
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
			if role == "user" || (role == "" && message["type"] != "function_call_output" && message["type"] != "function_call") {
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
		if kind == "function_call_output" || kind == "tool_result" {
			source = "tool"
		}
		if content, ok := message["content"]; ok {
			segments, partial = appendContent(segments, source, content, partial, 0)
		}
		if parts, ok := message["parts"]; ok {
			segments, partial = appendContent(segments, source, parts, partial, 0)
		}
		if output, ok := message["output"]; ok {
			segments, partial = appendContent(segments, "tool", output, partial, 0)
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
			segments, partial = appendContent(segments, "tool", message["arguments"], partial, 0)
		}
	}
	for _, key := range []string{"tools", "functions"} {
		if value, ok := root[key]; ok {
			segments, partial = appendContent(segments, "tool", value, partial, 0)
		}
	}
	for _, key := range []string{"prompt", "negative_prompt", "query", "text", "content"} {
		if value, ok := root[key]; ok {
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
		if _, ok := root[key]; ok {
			partial = "binary_media"
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
		if kind == "tool_result" || kind == "function_call_output" {
			source = "tool"
		}
		textFound := false
		for _, key := range []string{"text", "content", "output", "description", "arguments"} {
			if value, ok := v[key]; ok {
				out, partial = appendContent(out, source, value, partial, depth+1)
				textFound = true
			}
		}
		for _, key := range []string{"function", "functionCall", "functionResponse", "tool_calls", "functionDeclarations"} {
			if value, ok := v[key]; ok {
				out, partial = appendContent(out, "tool", value, partial, depth+1)
				textFound = true
			}
		}
		// Schemas and binary parts can affect a model even when they appear
		// beside ordinary text. Do not label these as fully inspected.
		for _, key := range []string{"parameters", "input_schema", "args", "response", "image_url", "input_audio", "inline_data", "inlineData", "file_data", "fileData", "source", "file_id", "file_url"} {
			if _, ok := v[key]; ok {
				partial = "binary_or_unknown_content"
			}
		}
		if !textFound {
			partial = "binary_or_unknown_content"
		}
	case nil:
	default:
		partial = "unsupported_payload"
	}
	return out, partial
}
