package policy

import (
	_ "embed"
	"fmt"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

//go:embed keywords.json
var keywordData []byte

type KeywordSettings struct {
	Enabled      bool     `json:"enabled"`
	Combinations bool     `json:"combinations"`
	Block        []string `json:"block"`
	Suspend      []string `json:"suspend"`
}

type KeywordLibrary struct {
	Version  string `json:"version"`
	Keywords []struct {
		ID, Keyword, Category, Action, Origin string
	} `json:"keywords"`
	Combinations []struct {
		ID, Category string
		Groups       [][]string
	} `json:"combinations"`
}

var library = func() KeywordLibrary {
	var result KeywordLibrary
	if err := common.Unmarshal(keywordData, &result); err != nil {
		panic(err)
	}
	return result
}()

var keywordMetadata = func() map[string]struct{ id, category string } {
	metadata := map[string]struct{ id, category string }{}
	for _, item := range library.Keywords {
		metadata[Normalize(item.Keyword)] = struct{ id, category string }{item.ID, item.Category}
	}
	return metadata
}()

func DefaultKeywords() KeywordSettings {
	s := KeywordSettings{Enabled: true, Combinations: true, Block: []string{}, Suspend: []string{}}
	for _, item := range library.Keywords {
		if item.Action == "block_request_and_suspend_user_api" {
			s.Suspend = append(s.Suspend, item.Keyword)
		} else {
			s.Block = append(s.Block, item.Keyword)
		}
	}
	return s
}

func (s KeywordSettings) Validate() error {
	seen := map[string]bool{}
	bytes := 0
	for _, list := range [][]string{s.Block, s.Suspend} {
		for _, word := range list {
			normalized := Normalize(word)
			bytes += len(word)
			if normalized == "" || len(word) > 1000 || strings.TrimSpace(word) != word || strings.ContainsAny(word, "\r\n") || seen[normalized] {
				return ErrInvalid
			}
			seen[normalized] = true
		}
	}
	if len(seen) > 2000 || bytes > 128000 {
		return ErrInvalid
	}
	return nil
}

// Keywords apply only to the latest user input. Historical quotations and tool
// output must not turn an otherwise ordinary follow-up into a new offence.
func inspectKeywords(s Settings, text string, v *Verdict) {
	normalized := Normalize(text)
	safeText := Redact(normalized)
	for listIndex, list := range [][]string{s.Keywords.Block, s.Keywords.Suspend} {
		for index, word := range list {
			match := Normalize(word)
			position := strings.Index(normalized, match)
			if position < 0 {
				continue
			}
			info, known := keywordMetadata[match]
			if !known {
				info.id, info.category = fmt.Sprintf("keyword-%d-%d", listIndex, index), "custom_keyword"
			}
			// Evidence is explicitly normalized text, not a model's assertion of intent.
			evidence := "[REDACTED]"
			if safePosition := strings.Index(safeText, match); safePosition >= 0 {
				evidence = bounded(safeText[safePosition:], min(240, len(match)+160))
			}
			v.Hits = append(v.Hits, Hit{RuleID: info.id, Name: "Keyword match", Source: "current", Action: "block", Category: info.category, Matched: bounded(Redact(word), 400), Evidence: Redact(evidence), CountPenalty: true})
			if listIndex == 1 {
				v.ImmediateSuspend = s.Mode == "enforce"
			}
		}
	}
	if s.Keywords.Combinations {
		sentences := strings.FieldsFunc(text, func(r rune) bool { return strings.ContainsRune("。！？.!?;；\r\n", r) })
		for _, rule := range library.Combinations {
			for _, sentence := range sentences {
				sentence = Normalize(sentence)
				matches := []string{}
				for _, group := range rule.Groups {
					found := slices.IndexFunc(group, func(term string) bool { return strings.Contains(sentence, Normalize(term)) })
					if found < 0 {
						break
					}
					matches = append(matches, group[found])
				}
				if len(matches) != len(rule.Groups) {
					continue
				}
				v.Hits = append(v.Hits, Hit{RuleID: rule.ID, Name: "Combined keyword match", Source: "current", Action: "block", Category: rule.Category, Matched: Redact(strings.Join(matches, " · ")), Evidence: bounded(Redact(sentence), 600), CountPenalty: true})
				break
			}
		}
	}
	if len(v.Hits) == 0 {
		return
	}
	v.Finding, v.Reason, v.Decision = "rule_match", "keyword_match", "observe"
	if s.Mode == "enforce" {
		v.Decision, v.Eligible = "block", true
	}
}
