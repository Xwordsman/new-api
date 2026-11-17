package registrationrisk

import (
	"errors"
	"slices"

	"github.com/QuantumNous/new-api/extensions/referral/ledger"
	"github.com/QuantumNous/new-api/extensions/registrationrisk/guard"
	"gorm.io/gorm"
)

type memberGroup struct {
	ID       int                  `json:"id"`
	Priority int                  `json:"priority"`
	Signals  []string             `json:"signals"`
	Members  []memberRow          `json:"members"`
	Bindings []memberGroupBinding `json:"bindings"`
}

type memberGroupBinding struct {
	ledger.Binding `gorm:"embedded"`
	Username       string `json:"username"`
	InviterName    string `json:"inviter_name"`
	Pending        int64  `json:"pending"`
}

// Strong associations join groups. Shared networks and common inviters never
// merge unrelated browser groups. Weak network clues remain per-account rows.
// Financial state is read live, so approval is visible without another scan.
func loadMemberGroups(db *gorm.DB, taskID, kind string, page int) ([]memberGroup, int, error) {
	if !slices.Contains([]string{"review", "flagged", "all", "insufficient"}, kind) {
		return nil, 0, guard.ErrInvalid
	}
	var findings []guard.MemberFinding
	if err := db.Where("task_id = ?", taskID).Limit(100001).Find(&findings).Error; err != nil {
		return nil, 0, err
	}
	if len(findings) > 100000 {
		return nil, 0, errors.New("member group analysis exceeds safety limit")
	}
	var members []memberRow
	if err := memberQuery(db).Select(memberColumns).Order("u.id").Limit(100001).Scan(&members).Error; err != nil {
		return nil, 0, err
	}
	if len(members) > 100000 {
		return nil, 0, errors.New("member group analysis exceeds safety limit")
	}
	parents := make(map[int]int, len(members))
	for _, member := range members {
		parents[member.ID] = member.ID
	}
	for _, finding := range findings {
		if _, ok := parents[finding.UserID]; !ok {
			continue
		}
		for _, signal := range finding.Signals {
			if signal.Code != "device" && signal.Code != "payer" && signal.Code != "invite-burst" {
				continue
			}
			for _, id := range signal.RelatedIDs {
				if _, ok := parents[id]; !ok {
					continue
				}
				a, b := finding.UserID, id
				for parents[a] != a {
					a = parents[a]
				}
				for parents[b] != b {
					b = parents[b]
				}
				parents[max(a, b)] = min(a, b)
			}
		}
	}
	groups := map[int]*memberGroup{}
	for _, member := range members {
		id := member.ID
		for parents[id] != id {
			id = parents[id]
		}
		parents[member.ID] = id
		if groups[id] == nil {
			groups[id] = &memberGroup{ID: id, Signals: []string{}, Members: []memberRow{}, Bindings: []memberGroupBinding{}}
		}
		groups[id].Members = append(groups[id].Members, member)
	}
	insufficient := map[int]bool{}
	for _, finding := range findings {
		id, ok := parents[finding.UserID]
		if !ok {
			continue
		}
		g := groups[id]
		g.Priority = max(g.Priority, finding.Priority)
		insufficient[id] = insufficient[id] || finding.Coverage == "unavailable"
		for _, signal := range finding.Signals {
			if !slices.Contains(g.Signals, signal.Code) {
				g.Signals = append(g.Signals, signal.Code)
			}
		}
	}
	var bindings []memberGroupBinding
	if err := db.Table("extension_referral_bindings AS b").Select("b.*, u.username, i.username AS inviter_name").Joins("JOIN users AS u ON u.id = b.user_id AND u.deleted_at IS NULL").Joins("JOIN users AS i ON i.id = b.inviter_id AND i.deleted_at IS NULL").Order("b.id").Limit(1000001).Scan(&bindings).Error; err != nil {
		return nil, 0, err
	}
	if len(bindings) > 1000000 {
		return nil, 0, errors.New("member reward analysis exceeds safety limit")
	}
	var pending []struct {
		UserID  int
		Pending int64
	}
	if err := db.Model(&ledger.Reward{}).Select("user_id, SUM(quota - reversed) AS pending").Where("state = ? AND quota > reversed", "pending").Group("user_id").Scan(&pending).Error; err != nil {
		return nil, 0, err
	}
	amounts := map[int]int64{}
	for _, row := range pending {
		amounts[row.UserID] = row.Pending
	}
	held := map[int]bool{}
	for _, binding := range bindings {
		binding.Pending = amounts[binding.UserID]
		// Show each invitation once, under the participant with stronger evidence.
		// An independent invitee must not become a second review case merely
		// because their inviter's rewards are held.
		id, ok := parents[binding.InviterID]
		if !ok {
			continue
		}
		if peer, exists := parents[binding.UserID]; exists && groups[peer].Priority > groups[id].Priority {
			id = peer
		}
		groups[id].Bindings = append(groups[id].Bindings, binding)
		held[id] = held[id] || binding.State == "review"
	}
	result := []memberGroup{}
	for id, g := range groups {
		if kind == "review" && g.Priority < 2 && !held[id] {
			continue
		}
		if kind == "flagged" && len(g.Signals) == 0 && !held[id] {
			continue
		}
		if kind == "insufficient" && !insufficient[id] {
			continue
		}
		result = append(result, *g)
	}
	slices.SortFunc(result, func(a, b memberGroup) int {
		if held[a.ID] != held[b.ID] {
			if held[a.ID] {
				return -1
			}
			return 1
		}
		if a.Priority != b.Priority {
			return b.Priority - a.Priority
		}
		return a.ID - b.ID
	})
	total := len(result)
	start := min((page-1)*20, total)
	return result[start:min(start+20, total)], total, nil
}
