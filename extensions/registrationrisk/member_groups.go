package registrationrisk

import (
	"errors"
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/extensions/referral/ledger"
	"github.com/QuantumNous/new-api/extensions/registrationrisk/guard"
	"gorm.io/gorm"
)

type memberGroup struct {
	ID           int                  `json:"id"`
	Priority     int                  `json:"priority"`
	Signals      []string             `json:"signals"`
	Members      []memberRow          `json:"members"`
	Bindings     []memberGroupBinding `json:"bindings"`
	insufficient bool
	findings     map[int]guard.MemberFinding
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
	groups, err := collectMemberGroups(db, taskID, kind)
	if err != nil {
		return nil, 0, err
	}
	total := len(groups)
	start := min((max(page, 1)-1)*20, total)
	return groups[start:min(start+20, total)], total, nil
}

func collectMemberGroups(db *gorm.DB, taskID, kind string) ([]memberGroup, error) {
	if !slices.Contains([]string{"review", "flagged", "all", "insufficient"}, kind) {
		return nil, guard.ErrInvalid
	}
	var findings []guard.MemberFinding
	if err := db.Where("task_id = ?", taskID).Limit(100001).Find(&findings).Error; err != nil {
		return nil, err
	}
	if len(findings) > 100000 {
		return nil, errors.New("member group analysis exceeds safety limit")
	}
	var members []memberRow
	if err := memberQuery(db).Select(memberColumns).Order("u.id").Limit(100001).Scan(&members).Error; err != nil {
		return nil, err
	}
	if len(members) > 100000 {
		return nil, errors.New("member group analysis exceeds safety limit")
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
			groups[id] = &memberGroup{ID: id, Signals: []string{}, Members: []memberRow{}, Bindings: []memberGroupBinding{}, findings: map[int]guard.MemberFinding{}}
		}
		groups[id].Members = append(groups[id].Members, member)
	}
	for _, finding := range findings {
		id, ok := parents[finding.UserID]
		if !ok {
			continue
		}
		g := groups[id]
		g.Priority = max(g.Priority, finding.Priority)
		g.insufficient = g.insufficient || finding.Coverage == "unavailable"
		g.findings[finding.UserID] = finding
		for _, signal := range finding.Signals {
			if !slices.Contains(g.Signals, signal.Code) {
				g.Signals = append(g.Signals, signal.Code)
			}
		}
	}
	var bindings []memberGroupBinding
	if err := db.Table("extension_referral_bindings AS b").Select("b.*, u.username, i.username AS inviter_name").Joins("JOIN users AS u ON u.id = b.user_id AND u.deleted_at IS NULL").Joins("JOIN users AS i ON i.id = b.inviter_id AND i.deleted_at IS NULL").Order("b.id").Limit(1000001).Scan(&bindings).Error; err != nil {
		return nil, err
	}
	if len(bindings) > 1000000 {
		return nil, errors.New("member reward analysis exceeds safety limit")
	}
	var pending []struct {
		UserID  int
		Pending int64
	}
	if err := db.Model(&ledger.Reward{}).Select("user_id, SUM(quota - reversed) AS pending").Where("state = ? AND quota > reversed", "pending").Group("user_id").Scan(&pending).Error; err != nil {
		return nil, err
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
	for _, g := range groups {
		if !g.matches(kind) {
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
	return result, nil
}

func (g memberGroup) matches(kind string) bool {
	held := slices.ContainsFunc(g.Bindings, func(b memberGroupBinding) bool { return b.State == "review" })
	switch kind {
	case "review":
		return g.Priority >= 2 || held
	case "flagged":
		return len(g.Signals) > 0 || held
	case "insufficient":
		return g.insufficient
	case "all":
		return true
	}
	return false
}

type relatedMember struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
}

type memberAnalysisAccount struct {
	Member          memberRow           `json:"member"`
	GroupID         int                 `json:"group_id"`
	Priority        int                 `json:"priority"`
	Signals         []string            `json:"signals"`
	RelatedAccounts []relatedMember     `json:"related_accounts"`
	Binding         *memberGroupBinding `json:"binding"`
}

// Account pagination happens after association filtering and invitation expansion.
// Each live invitation belongs only to its invitee's row, even when the risky
// recipient is in another group. Invitation links do not imply shared devices.
func loadMemberAccounts(db *gorm.DB, taskID, kind, search string, page, pageSize int) ([]memberAnalysisAccount, int, error) {
	search = strings.ToLower(strings.TrimSpace(search))
	if len(search) > 254 || !slices.Contains([]string{"review", "flagged", "all", "insufficient"}, kind) {
		return nil, 0, guard.ErrInvalid
	}
	groups, err := collectMemberGroups(db, taskID, "all")
	if err != nil {
		return nil, 0, err
	}
	members := map[int]memberRow{}
	bindings := map[int]memberGroupBinding{}
	selected := map[int]bool{}
	for _, group := range groups {
		matches := group.matches(kind)
		for _, member := range group.Members {
			members[member.ID] = member
			selected[member.ID] = selected[member.ID] || matches
		}
		for _, binding := range group.Bindings {
			bindings[binding.UserID] = binding
			selected[binding.UserID] = selected[binding.UserID] || matches
		}
	}
	rows := []memberAnalysisAccount{}
	for _, group := range groups {
		for _, member := range group.Members {
			if !selected[member.ID] {
				continue
			}
			if search != "" && strconv.Itoa(member.ID) != search && !strings.Contains(strings.ToLower(member.Username+"\n"+member.DisplayName+"\n"+member.Email+"\n"+member.RegistrationIP+"\n"+member.LastLoginIP), search) {
				continue
			}
			row := memberAnalysisAccount{Member: member, GroupID: group.ID, Priority: group.Priority, Signals: []string{}, RelatedAccounts: []relatedMember{}}
			if binding, ok := bindings[member.ID]; ok {
				row.Binding = &binding
			}
			related := map[int]bool{}
			for _, peer := range group.Members {
				related[peer.ID] = true
			}
			for _, signal := range group.findings[member.ID].Signals {
				row.Signals = append(row.Signals, signal.Code)
				for _, id := range signal.RelatedIDs {
					related[id] = true
				}
			}
			delete(related, member.ID)
			for id := range related {
				if peer, ok := members[id]; ok {
					row.RelatedAccounts = append(row.RelatedAccounts, relatedMember{ID: id, Username: peer.Username})
				}
			}
			slices.SortFunc(row.RelatedAccounts, func(a, b relatedMember) int { return a.ID - b.ID })
			rows = append(rows, row)
		}
	}
	total := len(rows)
	pageSize = max(10, min(pageSize, 100))
	start := min((max(page, 1)-1)*pageSize, total)
	return rows[start:min(start+pageSize, total)], total, nil
}
