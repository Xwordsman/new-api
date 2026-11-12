package policy

import (
	"context"
	"sort"
	"sync"
	"time"
)

type Resource struct {
	Name  string
	Limit int
}

type Occupancy struct {
	Resource string `json:"resource"`
	Active   int    `json:"active"`
	Limit    int    `json:"limit"`
	Admitted int64  `json:"admitted"`
	Rejected int64  `json:"rejected"`
}

// Acquire atomically reserves every resource or none. Renew never recreates a
// missing lease, so an expired owner cannot overwrite a replacement request.
type Store interface {
	Acquire(context.Context, []Resource, string, time.Duration) (bool, error)
	Renew(context.Context, []Resource, string, time.Duration) (bool, error)
	Release(context.Context, []Resource, string) error
	Reject(context.Context, Resource) error
	Snapshot(context.Context) ([]Occupancy, error)
}

type memoryEntry struct {
	limit    int
	leases   map[string]time.Time
	admitted int64
	rejected int64
	updated  time.Time
}

type MemoryStore struct {
	mu        sync.Mutex
	entries   map[string]*memoryEntry
	now       func() time.Time
	lastSweep time.Time
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{entries: map[string]*memoryEntry{}, now: time.Now}
}

func (m *MemoryStore) entry(name string, now time.Time) *memoryEntry {
	e := m.entries[name]
	if e == nil {
		e = &memoryEntry{leases: map[string]time.Time{}}
		m.entries[name] = e
	}
	for id, expires := range e.leases {
		if !expires.After(now) {
			delete(e.leases, id)
		}
	}
	return e
}

func (m *MemoryStore) sweep(now time.Time) {
	if now.Sub(m.lastSweep) < time.Minute {
		return
	}
	m.lastSweep = now
	for name, e := range m.entries {
		for id, expires := range e.leases {
			if !expires.After(now) {
				delete(e.leases, id)
			}
		}
		if len(e.leases) == 0 && now.Sub(e.updated) >= 24*time.Hour {
			delete(m.entries, name)
		}
	}
}

func (m *MemoryStore) Acquire(ctx context.Context, resources []Resource, id string, ttl time.Duration) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	m.sweep(now)
	for _, r := range resources {
		e := m.entry(r.Name, now)
		e.limit = r.Limit
		if _, exists := e.leases[id]; !exists && r.Limit > 0 && len(e.leases) >= r.Limit {
			return false, nil
		}
	}
	for _, r := range resources {
		e := m.entry(r.Name, now)
		if _, exists := e.leases[id]; !exists {
			e.admitted++
		}
		e.leases[id], e.updated = now.Add(ttl), now
	}
	return true, nil
}

func (m *MemoryStore) Renew(ctx context.Context, resources []Resource, id string, ttl time.Duration) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	for _, r := range resources {
		if _, ok := m.entry(r.Name, now).leases[id]; !ok {
			return false, nil
		}
	}
	for _, r := range resources {
		e := m.entry(r.Name, now)
		e.leases[id], e.updated = now.Add(ttl), now
	}
	return true, nil
}

func (m *MemoryStore) Release(ctx context.Context, resources []Resource, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, r := range resources {
		if e := m.entries[r.Name]; e != nil {
			delete(e.leases, id)
		}
	}
	return nil
}

func (m *MemoryStore) Reject(ctx context.Context, r Resource) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	m.sweep(now)
	e := m.entry(r.Name, now)
	e.limit = r.Limit
	e.rejected++
	e.updated = now
	return nil
}

func (m *MemoryStore) Snapshot(ctx context.Context) ([]Occupancy, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	rows := []Occupancy{}
	for name := range m.entries {
		e := m.entry(name, now)
		if len(e.leases) == 0 && now.Sub(e.updated) >= 24*time.Hour {
			delete(m.entries, name)
			continue
		}
		rows = append(rows, Occupancy{Resource: name, Active: len(e.leases), Limit: e.limit, Admitted: e.admitted, Rejected: e.rejected})
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Active != rows[j].Active {
			return rows[i].Active > rows[j].Active
		}
		return rows[i].Resource < rows[j].Resource
	})
	return rows[:min(len(rows), 1000)], nil
}
