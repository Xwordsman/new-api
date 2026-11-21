package policy

import (
	"slices"
	"strings"
)

// Assessment is a narrow contract: model-generated explanations are not stored.
// Evidence must be an exact quote from an explicitly identified input source.
type Assessment struct {
	Verdict  string `json:"verdict"`
	Category string `json:"category"`
	Source   string `json:"source"`
	Evidence string `json:"evidence"`
}

func (c Categories) Includes(category string) bool {
	switch category {
	case "jailbreak":
		return c.Jailbreak
	case "theft":
		return c.Theft
	case "attack":
		return c.Attack
	case "sexual":
		return c.Sexual
	}
	return false
}

func ReviewFailure(s Settings, v Verdict, reason string) Verdict {
	// Preserve an independently established local block, but inspection failure
	// itself must never become evidence for automatic account suspension.
	v.Finding, v.Reason, v.Eligible = "check_failed", reason, false
	if v.Decision == "allow" {
		v.Decision = "observe"
	}
	if s.Mode == "enforce" && s.Reviewer.FailureAction == "block" {
		v.Decision = "block"
	}
	return v
}

func ApplyAssessment(s Settings, in Input, v Verdict, a Assessment) Verdict {
	if !slices.Contains([]string{"allow", "unsafe", "uncertain"}, a.Verdict) {
		return ReviewFailure(s, v, "invalid_review")
	}
	if a.Verdict == "allow" {
		if a.Category != "" || a.Source != "" || a.Evidence != "" {
			return ReviewFailure(s, v, "invalid_review")
		}
		return v
	}
	if (a.Category != "" && !slices.Contains([]string{"jailbreak", "theft", "attack", "sexual"}, a.Category)) || (a.Verdict == "unsafe" && a.Category == "") ||
		(a.Source != "" && !slices.Contains([]string{"current", "system", "history", "tool"}, a.Source)) {
		return ReviewFailure(s, v, "invalid_review")
	}
	if a.Category != "" && !s.Categories.Includes(a.Category) {
		return v
	}
	// A quoted historical/tool passage alone cannot establish current intent.
	quoted := false
	if strings.TrimSpace(a.Evidence) != "" && len(a.Evidence) <= 1200 {
		for _, segment := range in.Segments {
			if segment.Source == a.Source && strings.Contains(segment.Text, a.Evidence) {
				quoted = true
				break
			}
		}
	}
	if a.Verdict == "unsafe" && !quoted {
		return ReviewFailure(s, v, "invalid_review")
	}
	confirmed := a.Verdict == "unsafe" && (a.Source == "current" || a.Source == "system")
	v.Finding, v.Reason = "review_needed", "ambiguous_intent"
	if confirmed {
		v.Finding, v.Reason = "violation", "harmful_"+a.Category
	}
	action := "observe"
	if s.Mode == "enforce" && (confirmed || s.Reviewer.FailureAction == "block") {
		action, v.Decision = "block", "block"
	} else if v.Decision == "allow" {
		v.Decision = "observe"
	}
	hit := Hit{RuleID: "semantic_review", Name: "Semantic review", Category: a.Category, Source: a.Source, Action: action, HighConfidence: confirmed, CountPenalty: confirmed}
	// Evidence storage is opt-in. Never include model-generated free text.
	if s.StoreEvidence && quoted {
		hit.Evidence = bounded(a.Evidence, 240)
	}
	v.Hits = append(v.Hits, hit)
	v.Eligible = confirmed && s.Mode == "enforce" && v.Uninspected == ""
	if v.Uninspected != "" {
		return ReviewFailure(s, v, "incomplete_input")
	}
	return v
}
