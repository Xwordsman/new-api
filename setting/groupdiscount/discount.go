// Package groupdiscount holds public group promotions independently of dashboard
// visibility. Relay requests capture factors once; no database reads or timers
// are needed on the billing path.
package groupdiscount

import (
	"errors"
	"math"
	"slices"
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
	Enabled      bool          `json:"enabled"`
	Factor       float64       `json:"factor,omitempty"`
	Ratio        *float64      `json:"ratio,omitempty"`
	Label        string        `json:"label"`
	StartsAt     int64         `json:"starts_at"`
	EndsAt       int64         `json:"ends_at"`
	DailyStart   string        `json:"daily_start"`
	DailyEnd     string        `json:"daily_end"`
	Timezone     string        `json:"timezone"`
	DailyPeriods []DailyPeriod `json:"daily_periods,omitempty"`
}

// DailyPeriod is a recurring half-open window with its own final multiplier.
// An end earlier than the start belongs to the following civil day.
type DailyPeriod struct {
	Start string  `json:"start"`
	End   string  `json:"end"`
	Ratio float64 `json:"ratio"`
}

type Offer struct {
	Active    bool      `json:"active"`
	Factor    float64   `json:"factor"`
	Label     string    `json:"label"`
	NextStart int64     `json:"next_start"`
	EndsAt    int64     `json:"ends_at"`
	Timezone  string    `json:"timezone"`
	Schedule  *Schedule `json:"schedule,omitempty"`
}

// Schedule separates campaign bounds from the current daily pricing period.
// PeriodEnd is the next transition; zero means no further pricing change.
type Schedule struct {
	EvaluatedAt  int64           `json:"evaluated_at"`
	StartsAt     int64           `json:"starts_at"`
	EndsAt       int64           `json:"ends_at"`
	DailyStart   string          `json:"daily_start"`
	DailyEnd     string          `json:"daily_end"`
	PeriodStart  int64           `json:"period_start"`
	PeriodEnd    int64           `json:"period_end"`
	NextFactor   float64         `json:"next_factor"`
	DailyPeriods []DailyPeriod   `json:"daily_periods,omitempty"`
	NextOffer    *ScheduledOffer `json:"next_offer,omitempty"`
}

// ScheduledOffer describes the next actual offer, which can follow a gap at
// regular price. PeriodEnd/NextFactor still describe the next price transition.
type ScheduledOffer struct {
	StartsAt int64   `json:"starts_at"`
	EndsAt   int64   `json:"ends_at"`
	Factor   float64 `json:"factor"`
}

type compiledPeriod struct {
	start, end int
	ratio      *float64
}

type compiledRule struct {
	Rule
	location *time.Location
	periods  []compiledPeriod
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
	if (len(rule.DailyPeriods) == 0 && invalidPrice) || utf8.RuneCountInString(rule.Label) > 80 ||
		rule.StartsAt < 0 || rule.EndsAt < 0 || rule.StartsAt > 253402300799 || rule.EndsAt > 253402300799 ||
		(rule.EndsAt > 0 && rule.StartsAt >= rule.EndsAt) {
		return rule, errors.New("invalid public group discount")
	}
	if _, err := time.LoadLocation(rule.Timezone); err != nil {
		return rule, errors.New("invalid public group discount timezone")
	}
	if len(rule.DailyPeriods) > 0 {
		if len(rule.DailyPeriods) > 48 || rule.DailyStart != "" || rule.DailyEnd != "" {
			return rule, errors.New("invalid public group discount daily periods")
		}
		rule.DailyPeriods = slices.Clone(rule.DailyPeriods)
		var occupied [1440]bool
		for _, period := range rule.DailyPeriods {
			start, end, err := dailyMinutes(period.Start, period.End)
			if err != nil || math.IsNaN(period.Ratio) || math.IsInf(period.Ratio, 0) || period.Ratio <= 0 {
				return rule, errors.New("invalid public group discount daily period")
			}
			if end < start {
				end += 1440
			}
			for minute := start; minute < end; minute++ {
				if occupied[minute%1440] {
					return rule, errors.New("overlapping public group discount daily periods")
				}
				occupied[minute%1440] = true
			}
		}
		slices.SortFunc(rule.DailyPeriods, func(a, b DailyPeriod) int { return strings.Compare(a.Start, b.Start) })
		// Only per-window multipliers apply in scheduled mode.
		rule.Ratio, rule.Factor = nil, 0
		return rule, nil
	}
	if rule.Ratio != nil {
		rule.Ratio = new(*rule.Ratio)
	}
	if rule.DailyStart == "" && rule.DailyEnd == "" {
		return rule, nil
	}
	_, _, err := dailyMinutes(rule.DailyStart, rule.DailyEnd)
	return rule, err
}

func dailyMinutes(from, until string) (int, int, error) {
	start, err := time.Parse("15:04", from)
	if err != nil || start.Format("15:04") != from {
		return 0, 0, errors.New("invalid public group discount daily start")
	}
	end, err := time.Parse("15:04", until)
	if err != nil || end.Format("15:04") != until || from == until {
		return 0, 0, errors.New("invalid public group discount daily end")
	}
	return start.Hour()*60 + start.Minute(), end.Hour()*60 + end.Minute(), nil
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
			start, end, _ := dailyMinutes(rule.DailyStart, rule.DailyEnd)
			entry.periods = []compiledPeriod{{start: start, end: end, ratio: rule.Ratio}}
		}
		for _, period := range rule.DailyPeriods {
			start, end, _ := dailyMinutes(period.Start, period.End)
			entry.periods = append(entry.periods, compiledPeriod{start: start, end: end, ratio: new(period.Ratio)})
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
		schedule := &Schedule{EvaluatedAt: now.Unix(), StartsAt: rule.StartsAt, EndsAt: rule.EndsAt,
			DailyStart: rule.DailyStart, DailyEnd: rule.DailyEnd, DailyPeriods: slices.Clone(rule.DailyPeriods), NextFactor: 1}
		offer := Offer{Factor: 1, Label: rule.Label, Timezone: rule.Timezone, Schedule: schedule}
		factor := rule.Factor
		if rule.Ratio != nil {
			factor = publicFactor(base, *rule.Ratio)
		}
		epoch := now.Unix()
		if rule.EndsAt > 0 && epoch >= rule.EndsAt {
			schedule.PeriodStart = rule.EndsAt
			offers[group] = offer
			continue
		}
		if len(rule.periods) == 0 {
			offer.Active = epoch >= rule.StartsAt
			offer.EndsAt = rule.EndsAt
			if offer.Active {
				offer.Factor = factor
				schedule.PeriodStart, schedule.PeriodEnd = rule.StartsAt, rule.EndsAt
			} else {
				offer.NextStart = rule.StartsAt
				schedule.PeriodEnd, schedule.NextFactor = rule.StartsAt, factor
			}
			offers[group] = offer
			continue
		}
		pivot := now
		if epoch < rule.StartsAt {
			pivot = time.Unix(rule.StartsAt, 0)
		}
		local := pivot.In(rule.location)
		var previousEnd int64
		// Include a second future civil day in case a DST jump removes an
		// entire short window on the next day.
		for offset := -1; offset <= 2; offset++ {
			date := local.AddDate(0, 0, offset)
			for _, period := range rule.periods {
				start := time.Date(date.Year(), date.Month(), date.Day(), period.start/60, period.start%60, 0, 0, rule.location)
				endDate := date
				if period.end < period.start {
					endDate = date.AddDate(0, 0, 1)
				}
				end := time.Date(endDate.Year(), endDate.Month(), endDate.Day(), period.end/60, period.end%60, 0, 0, rule.location)
				from, until := max(start.Unix(), rule.StartsAt), end.Unix()
				if rule.EndsAt > 0 {
					until = min(until, rule.EndsAt)
				}
				if from >= until {
					continue
				}
				if until <= epoch {
					previousEnd = max(previousEnd, until)
					continue
				}
				windowFactor := factor
				if period.ratio != nil {
					windowFactor = publicFactor(base, *period.ratio)
				}
				if from <= epoch {
					offer.Active, offer.Factor, offer.EndsAt = true, windowFactor, until
					schedule.PeriodStart, schedule.PeriodEnd = from, until
					continue
				}
				if schedule.NextOffer == nil || from < schedule.NextOffer.StartsAt {
					schedule.NextOffer = &ScheduledOffer{StartsAt: from, EndsAt: until, Factor: windowFactor}
				}
			}
		}
		if !offer.Active {
			schedule.PeriodStart = previousEnd
			if next := schedule.NextOffer; next != nil {
				offer.NextStart, offer.EndsAt = next.StartsAt, next.EndsAt
				schedule.PeriodEnd, schedule.NextFactor = next.StartsAt, next.Factor
			}
		} else if next := schedule.NextOffer; next != nil && next.StartsAt == schedule.PeriodEnd {
			// Adjacent windows switch directly to the next multiplier.
			schedule.NextFactor = next.Factor
		}
		offers[group] = offer
	}
	return offers
}

func publicFactor(base, ratio float64) float64 {
	if base <= 0 {
		return 1
	}
	return max(math.SmallestNonzeroFloat64, min(1, ratio/base))
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
