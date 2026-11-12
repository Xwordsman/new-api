package policy

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

var (
	ErrUserBusy    = errors.New("user concurrency exceeded")
	ErrChannelBusy = errors.New("channel concurrency exceeded")
	localStore     = NewMemoryStore()
)

// CurrentStore never falls back to process-local counters when Redis is
// configured: doing so during an outage would multiply the permitted load.
func CurrentStore() (Store, error) {
	if !common.RedisEnabled {
		return localStore, nil
	}
	if common.RDB == nil {
		return nil, ErrUnavailable
	}
	return &RedisStore{Client: common.RDB}, nil
}

type Request struct {
	mu        sync.Mutex
	store     Store
	settings  Settings
	id        string
	user      Resource
	channel   []Resource
	ctx       context.Context
	cancel    context.CancelFunc
	stop      chan struct{}
	done      chan struct{}
	closeOnce sync.Once
	lost      bool
}

// Admit uses the account group, never the key's routing group. Every API key
// and transport owned by the same user competes for the same user resource.
func Admit(ctx context.Context, store Store, s Settings, userID int, group string) (*Request, error) {
	if err := s.Validate(); err != nil {
		return nil, err
	}
	r := &Request{store: store, settings: s, id: common.GetUUID(), user: Resource{Name: "user:" + strconv.Itoa(userID), Limit: s.UserLimit(userID, group)}, stop: make(chan struct{}), done: make(chan struct{})}
	r.ctx, r.cancel = context.WithCancel(ctx)
	admitted, err := r.acquire(ctx, []Resource{r.user}, r.ttl())
	if err != nil {
		r.cancel()
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, ErrUnavailable
	}
	if !admitted && s.QueueTimeoutMS > 0 {
		err = r.wait(ctx)
		admitted = err == nil
	}
	if !admitted {
		r.reject(r.user)
		r.cancel()
		if err != nil {
			return nil, err
		}
		return nil, ErrUserBusy
	}
	go r.heartbeat()
	return r, nil
}

func (r *Request) Context() context.Context { return r.ctx }
func (r *Request) ttl() time.Duration       { return time.Duration(r.settings.LeaseSeconds) * time.Second }

func (r *Request) acquire(ctx context.Context, resources []Resource, ttl time.Duration) (bool, error) {
	op, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	ok, err := r.store.Acquire(op, resources, r.id, ttl)
	if err != nil {
		// A lost response may follow a committed Redis script. Remove only our
		// own reservation before reporting an uncertain acquisition.
		cleanup, done := context.WithTimeout(context.Background(), 2*time.Second)
		defer done()
		_ = r.store.Release(cleanup, resources, r.id)
	}
	return ok, err
}

func (r *Request) wait(ctx context.Context) error {
	waiting := []Resource{{Name: "wait:" + r.user.Name, Limit: r.settings.MaxQueuedPerUser}}
	queueTTL := time.Duration(r.settings.QueueTimeoutMS) * time.Millisecond
	waitCtx, stopWaiting := context.WithTimeout(ctx, queueTTL)
	defer stopWaiting()
	ok, err := r.acquire(waitCtx, waiting, queueTTL+5*time.Second)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if waitCtx.Err() != nil {
			return ErrUserBusy
		}
		return ErrUnavailable
	}
	if !ok {
		return ErrUserBusy
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = r.store.Release(cleanup, waiting, r.id)
	}()
	poll := time.NewTicker(100 * time.Millisecond)
	defer poll.Stop()
	for {
		select {
		case <-waitCtx.Done():
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return ErrUserBusy
		case <-poll.C:
			ok, err = r.acquire(waitCtx, []Resource{r.user}, r.ttl())
			if err != nil {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				if waitCtx.Err() != nil {
					return ErrUserBusy
				}
				return ErrUnavailable
			}
			if ok {
				return nil
			}
		}
	}
}

// ReserveChannel switches attempt capacity while retaining the user's slot.
// The upstream credential is hashed, so reordering/rotating a multi-key list
// cannot accidentally share a slot with a different credential.
func (r *Request) ReserveChannel(channelID int, key string, multiKey bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.lost {
		return ErrUnavailable
	}
	if err := r.ctx.Err(); err != nil {
		return err
	}
	limit, keyLimit := r.settings.ChannelLimits(channelID)
	resources := []Resource{{Name: "channel:" + strconv.Itoa(channelID), Limit: limit}}
	if multiKey {
		hash := sha256.Sum256([]byte(key))
		resources = append(resources, Resource{Name: fmt.Sprintf("channel:%d:key:%x", channelID, hash), Limit: keyLimit})
	}
	if slices.Equal(r.channel, resources) {
		return nil
	}
	if err := r.releaseChannel(); err != nil {
		return ErrUnavailable
	}
	ok, err := r.acquire(r.ctx, resources, r.ttl())
	if err != nil {
		if r.ctx.Err() != nil {
			return r.ctx.Err()
		}
		return ErrUnavailable
	}
	if !ok {
		for _, resource := range resources {
			r.reject(resource)
		}
		return ErrChannelBusy
	}
	r.channel = resources
	return nil
}

func (r *Request) reject(resource Resource) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = r.store.Reject(ctx, resource)
}

func (r *Request) releaseChannel() error {
	if len(r.channel) == 0 {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := r.store.Release(ctx, r.channel, r.id); err != nil {
		return err
	}
	r.channel = nil
	return nil
}

func (r *Request) heartbeat() {
	defer close(r.done)
	ticker := time.NewTicker(r.ttl() / 3)
	defer ticker.Stop()
	for {
		select {
		case <-r.stop:
			return
		case <-ticker.C:
			r.mu.Lock()
			resources := append([]Resource{r.user}, r.channel...)
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			ok, err := r.store.Renew(ctx, resources, r.id, r.ttl())
			cancel()
			if !ok || err != nil {
				r.lost = true
				r.cancel()
			}
			r.mu.Unlock()
			if !ok || err != nil {
				return
			}
		}
	}
}

// Close follows the handler's lifetime, including stream completion and
// transport unwinding after cancellation; an idle Responses socket owns no slot.
func (r *Request) Close() {
	r.closeOnce.Do(func() {
		close(r.stop)
		<-r.done
		r.mu.Lock()
		defer r.mu.Unlock()
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		resources := append([]Resource{r.user}, r.channel...)
		_ = r.store.Release(ctx, resources, r.id)
		r.cancel()
	})
}
