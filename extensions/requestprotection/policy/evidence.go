package policy

import (
	"regexp"
	"strings"
)

var credentialPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)\b(?:sk|sess|ghp|gho|ghu|ghs|github_pat)[-_][a-z0-9_-]{12,}`),
	regexp.MustCompile(`(?i)\b(?:Bearer|Basic)\s+[a-z0-9_./+=:-]+`),
	regexp.MustCompile(`(?i)((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|authorization|cookie|密码|密钥)["']?\s*[:=]\s*["']?)[^\s,"';&}]+`),
	regexp.MustCompile(`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)`),
	regexp.MustCompile(`\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+`),
	regexp.MustCompile(`(https?://)[^\s/@]+:[^\s/@]+@`),
}

// Redact masks recognizable credentials in request text and matched evidence.
// Headers and the original transport body are never copied to the event.
func Redact(text string) string {
	for index, pattern := range credentialPatterns {
		replacement := "[REDACTED]"
		if index == 2 {
			replacement = "${1}[REDACTED]"
		}
		if index == 5 {
			replacement = "${1}[REDACTED]@"
		}
		text = pattern.ReplaceAllString(text, replacement)
	}
	return text
}

// RequestEvidence stores protocol-extracted text with source labels, bounded to
// fit a MySQL TEXT column as well as SQLite/PostgreSQL. Redact before truncating
// so cutting a token cannot expose a formerly recognizable credential prefix.
func RequestEvidence(in Input) (content, preview string, truncated, redacted bool) {
	var b strings.Builder
	remaining := 60000
	segments := append([]Segment(nil), in.Segments...)
	// Keep current input visible even when a very long history fills the budget.
	for _, source := range []string{"current", "system", "history", "tool"} {
		for _, segment := range segments {
			if segment.Source != source || segment.Text == "" {
				continue
			}
			// PostgreSQL TEXT cannot contain NUL. Keep its visible escaped form.
			text := strings.ReplaceAll(segment.Text, "\x00", `\u0000`)
			safeText := Redact(text)
			redacted = redacted || safeText != text
			text = safeText
			if preview == "" {
				preview = bounded(text, 500)
			}
			part := "[" + source + "]\n" + text + "\n\n"
			if len(part) > remaining {
				truncated = true
				part = bounded(part, remaining)
			}
			b.WriteString(part)
			remaining -= len(part)
		}
	}
	return b.String(), preview, truncated || in.Uninspected != "", redacted
}
