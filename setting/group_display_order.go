package setting

import (
	"fmt"
	"slices"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

var groupDisplayOrder = struct {
	sync.RWMutex
	groups []string
}{groups: []string{}}

func ValidateGroupDisplayOrder(value string) error {
	var groups []string
	if !strings.HasPrefix(strings.TrimSpace(value), "[") || common.UnmarshalJsonStr(value, &groups) != nil {
		return fmt.Errorf("Expected a JSON array of group identifiers")
	}
	seen := make(map[string]bool, len(groups))
	for _, group := range groups {
		if strings.TrimSpace(group) == "" || strings.TrimSpace(group) != group || seen[group] {
			return fmt.Errorf("Group display order must contain unique, non-empty group identifiers")
		}
		seen[group] = true
	}
	return nil
}

func UpdateGroupDisplayOrder(value string) error {
	if err := ValidateGroupDisplayOrder(value); err != nil {
		return err
	}
	var groups []string
	if err := common.UnmarshalJsonStr(value, &groups); err != nil {
		return err
	}
	groupDisplayOrder.Lock()
	groupDisplayOrder.groups = groups
	groupDisplayOrder.Unlock()
	return nil
}

func GroupDisplayOrderJSONString() string {
	groupDisplayOrder.RLock()
	defer groupDisplayOrder.RUnlock()
	encoded, _ := common.Marshal(groupDisplayOrder.groups)
	return string(encoded)
}

// OrderGroupNames only arranges supplied, authorized groups for display. It
// never changes AutoGroups or adds groups that were filtered by permissions.
func OrderGroupNames(groups []string) []string {
	remaining := make(map[string]bool, len(groups))
	for _, group := range groups {
		remaining[group] = true
	}
	ordered := make([]string, 0, len(remaining))
	groupDisplayOrder.RLock()
	for _, group := range groupDisplayOrder.groups {
		if remaining[group] {
			ordered = append(ordered, group)
			delete(remaining, group)
		}
	}
	groupDisplayOrder.RUnlock()
	tail := make([]string, 0, len(remaining))
	for group := range remaining {
		tail = append(tail, group)
	}
	slices.Sort(tail)
	return append(ordered, tail...)
}
