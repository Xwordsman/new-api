// Package groupdiscount holds public group promotions independently of dashboard
// visibility. Relay requests capture factors once; no database reads or timers
// are needed on the billing path.
package groupdiscount

import (
	"errors"
	"math"
	"strings"
	"sync/atomic"
	"time"
	_ "time/tzdata"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

const OptionKey = "extension.group_pricing.promotions"
const LegacyOptionKey = "extension.channel_monitor.settings"

type Rule struct {
	Enabled    bool     `json:"enabled"`
	Factor     float64  `json:"factor,omitempty"`
	Ratio      *float64 `json:"ratio,omitempty"`
	Label      string   `json:"label"`
	StartsAt   int64    `json:"starts_at"`
	EndsAt     int64    `json:"ends_at"`
	DailyStart string   `json:"daily_start"`
	DailyEnd   string   `json:"daily_end"`
	Timezone   string   `json:"timezone"`
}

type Offer struct {
	Active    bool    `json:"active"`
	Factor    float64 `json:"factor"`
	Label     string  `json:"label"`
	NextStart int64   `json:"next_start"`
	EndsAt    int64   `json:"ends_at"`
	Timezone  string  `json:"timezone"`
}

type compiledRule struct {
	Rule
	location *time.Location
	start    int
	end      int
}

type configuration struct {
	revision int64
	rules    map[string]compiledRule
}

type Runtime struct {
	current atomic.Pointer[configuration]
}

var Default = &Runtime{}

// Normalize validates disabled drafts too, so enabling a saved promotion cannot
// turn an invalid factor or schedule into an unexpected charge.
func Normalize(rule Rule) (Rule, error) {
	rule.Label = strings.TrimSpace(rule.Label)
	rule.Timezone = strings.TrimSpace(rule.Timezone)
	if rule.Timezone == "" {
		rule.Timezone = "Asia/Shanghai"
	}
	invalidPrice := math.IsNaN(rule.Factor) || math.IsInf(rule.Factor, 0) || rule.Factor <= 0 || rule.Factor > 1
	if rule.Ratio != nil {
		invalidPrice = math.IsNaN(*rule.Ratio) || math.IsInf(*rule.Ratio, 0) || *rule.Ratio <= 0
		rule.Factor = 0
	}
	if invalidPrice || utf8.RuneCountInString(rule.Label) > 80 ||
		rule.StartsAt < 0 || rule.EndsAt < 0 || rule.StartsAt > 253402300799 || rule.EndsAt > 253402300799 ||
		(rule.EndsAt > 0 && rule.StartsAt >= rule.EndsAt) {
		return rule, errors.New("invalid public group discount")
	}
	if _, err := time.LoadLocation(rule.Timezone); err != nil {
		return rule, errors.New("invalid public group discount timezone")
	}
	if rule.DailyStart == "" && rule.DailyEnd == "" {
		return rule, nil
	}
	start, err := time.Parse("15:04", rule.DailyStart)
	if err != nil || start.Format("15:04") != rule.DailyStart {
		return rule, errors.New("invalid public group discount daily start")
	}
	end, err := time.Parse("15:04", rule.DailyEnd)
	if err != nil || end.Format("15:04") != rule.DailyEnd || rule.DailyStart == rule.DailyEnd {
		return rule, errors.New("invalid public group discount daily end")
	}
	return rule, nil
}

// Load publishes an immutable revision. A late periodic options read must never
// undo a newer settings save on this node.
func (r *Runtime) Load(raw string) error {
	var saved struct {
		Revision int64 `json:"revision"`
		Groups   []struct {
			Group     string `json:"group"`
			Promotion *Rule  `json:"promotion"`
		} `json:"groups"`
	}
	if err := common.UnmarshalJsonStr(raw, &saved); err != nil {
		return err
	}
	if saved.Revision < 0 || len(saved.Groups) > 1024 {
		return errors.New("invalid public group discount configuration")
	}
	next := &configuration{revision: saved.Revision, rules: make(map[string]compiledRule)}
	seen := make(map[string]bool, len(saved.Groups))
	for _, group := range saved.Groups {
		if group.Group == "" || group.Group == "auto" || seen[group.Group] {
			return errors.New("invalid public group discount group")
		}
		seen[group.Group] = true
		if group.Promotion == nil {
			continue
		}
		rule, err := Normalize(*group.Promotion)
		if err != nil {
			return err
		}
		location, _ := time.LoadLocation(rule.Timezone)
		entry := compiledRule{Rule: rule, location: location}
		if rule.DailyStart != "" {
			start, _ := time.Parse("15:04", rule.DailyStart)
			end, _ := time.Parse("15:04", rule.DailyEnd)
			entry.start, entry.end = start.Hour()*60+start.Minute(), end.Hour()*60+end.Minute()
		}
		next.rules[group.Group] = entry
	}
	for {
		previous := r.current.Load()
		if previous != nil && previous.revision >= next.revision {
			return nil
		}
		if r.current.CompareAndSwap(previous, next) {
			return nil
		}
	}
}

// Offers evaluates half-open intervals [start, end) using the rule's IANA time
// zone. An overnight daily window belongs to the date on which it starts.
func (r *Runtime) Offers(now time.Time) map[string]Offer {
	offers := make(map[string]Offer)
	state := r.current.Load()
	if state == nil {
		return offers
	}
	bases := ratio_setting.GetGroupRatioCopy()
	for group, rule := range state.rules {
		base, exists := bases[group]
		if !rule.Enabled || !exists {
			continue
		}
		offer := Offer{Factor: 1, Label: rule.Label, Timezone: rule.Timezone}
		factor := rule.Factor
		if rule.Ratio != nil {
			factor = 1
			if base > 0 {
				factor = max(math.SmallestNonzeroFloat64, min(1, *rule.Ratio/base))
			}
		}
		epoch := now.Unix()
		if rule.EndsAt > 0 && epoch >= rule.EndsAt {
			offers[group] = offer
			continue
		}
		if rule.DailyStart == "" {
			offer.Active = epoch >= rule.StartsAt
			offer.EndsAt = rule.EndsAt
			if offer.Active {
				offer.Factor = factor
			} else {
				offer.NextStart = rule.StartsAt
			}
			offers[group] = offer
			continue
		}
		pivot := now
		if epoch < rule.StartsAt {
			pivot = time.Unix(rule.StartsAt, 0)
		}
		local := pivot.In(rule.location)
		for offset := -1; offset <= 1; offset++ {
			date := local.AddDate(0, 0, offset)
			start := time.Date(date.Year(), date.Month(), date.Day(), rule.start/60, rule.start%60, 0, 0, rule.location)
			endDate := date
			if rule.end < rule.start {
				endDate = date.AddDate(0, 0, 1)
			}
			end := time.Date(endDate.Year(), endDate.Month(), endDate.Day(), rule.end/60, rule.end%60, 0, 0, rule.location)
			from, until := max(start.Unix(), rule.StartsAt), end.Unix()
			if rule.EndsAt > 0 {
				until = min(until, rule.EndsAt)
			}
			if from >= until || until <= epoch {
				continue
			}
			if from <= epoch {
				offer.Active, offer.Factor, offer.EndsAt = true, factor, until
				break
			}
			if offer.NextStart == 0 || from < offer.NextStart {
				offer.NextStart = from
				offer.EndsAt = until
			}
		}
		offers[group] = offer
	}
	return offers
}

func (r *Runtime) Capture(now time.Time) map[string]float64 {
	factors := make(map[string]float64)
	for group, offer := range r.Offers(now) {
		if offer.Active {
			factors[group] = offer.Factor
		}
	}
	return factors
}
