package policy

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/go-redis/redis/v8"
)

const redisPrefix = "newapi:concurrency:v1:"

// Redis TIME keeps lease deadlines consistent across gateway clocks. Each
// reservation is request-owned; neither cleanup nor release can free another
// request's slot. The host uses one Redis client (not Redis Cluster).
var acquireScript = redis.NewScript(`
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
local ttl = tonumber(ARGV[2])
local count = (#KEYS - 1) / 2
redis.call('ZREMRANGEBYSCORE', KEYS[#KEYS], '-inf', now)
for i = 1, count do
  local k = KEYS[i * 2 - 1]
  redis.call('HSET', KEYS[i * 2], 'limit', ARGV[i * 2 + 1])
  redis.call('EXPIRE', KEYS[i * 2], 86400)
  redis.call('ZREMRANGEBYSCORE', k, '-inf', now)
  if not redis.call('ZSCORE', k, ARGV[1]) and tonumber(ARGV[i * 2 + 1]) > 0 and redis.call('ZCARD', k) >= tonumber(ARGV[i * 2 + 1]) then return 0 end
end
for i = 1, count do
  local k = KEYS[i * 2 - 1]
  if redis.call('ZADD', k, now + ttl, ARGV[1]) == 1 then redis.call('HINCRBY', KEYS[i * 2], 'admitted', 1) end
  if redis.call('PTTL', k) < ttl + 60000 then redis.call('PEXPIRE', k, ttl + 60000) end
  redis.call('EXPIRE', KEYS[i * 2], 86400)
  redis.call('ZADD', KEYS[#KEYS], now + 86400000, ARGV[i * 2 + 2])
end
return 1
`)

var renewScript = redis.NewScript(`
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
local count = (#KEYS - 1) / 2
for i = 1, count do
  local k = KEYS[i * 2 - 1]
  local expiry = redis.call('ZSCORE', k, ARGV[1])
  if not expiry or tonumber(expiry) <= now then return 0 end
end
for i = 1, count do
  local k = KEYS[i * 2 - 1]
  redis.call('ZADD', k, now + tonumber(ARGV[2]), ARGV[1])
  local keep = tonumber(ARGV[2]) + 60000
  if redis.call('PTTL', k) < keep then redis.call('PEXPIRE', k, keep) end
  redis.call('EXPIRE', KEYS[i * 2], 86400)
  redis.call('ZADD', KEYS[#KEYS], now + 86400000, ARGV[i + 2])
end
return 1
`)

var rejectScript = redis.NewScript(`
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
redis.call('HINCRBY', KEYS[1], 'rejected', 1)
redis.call('HSET', KEYS[1], 'limit', ARGV[2])
redis.call('EXPIRE', KEYS[1], 86400)
redis.call('ZADD', KEYS[2], now + 86400000, ARGV[1])
return 1
`)

var snapshotScript = redis.NewScript(`
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local names = redis.call('ZREVRANGE', KEYS[1], 0, 999)
local result = {}
for _, name in ipairs(names) do
  local slots = ARGV[1] .. 'slots:' .. name
  local stats = ARGV[1] .. 'stats:' .. name
  redis.call('ZREMRANGEBYSCORE', slots, '-inf', now)
  table.insert(result, {name, redis.call('ZCARD', slots), redis.call('HGET', stats, 'admitted') or '0', redis.call('HGET', stats, 'rejected') or '0', redis.call('HGET', stats, 'limit') or '0'})
end
return result
`)

type RedisStore struct{ Client *redis.Client }

func (r *RedisStore) Acquire(ctx context.Context, resources []Resource, id string, ttl time.Duration) (bool, error) {
	keys, args := make([]string, 0, len(resources)*2+1), []any{id, ttl.Milliseconds()}
	for _, resource := range resources {
		keys = append(keys, redisPrefix+"slots:"+resource.Name, redisPrefix+"stats:"+resource.Name)
		args = append(args, resource.Limit, resource.Name)
	}
	keys = append(keys, redisPrefix+"resources")
	value, err := acquireScript.Run(ctx, r.Client, keys, args...).Int()
	return value == 1, err
}

func (r *RedisStore) Renew(ctx context.Context, resources []Resource, id string, ttl time.Duration) (bool, error) {
	keys, args := make([]string, 0, len(resources)*2+1), []any{id, ttl.Milliseconds()}
	for _, resource := range resources {
		keys = append(keys, redisPrefix+"slots:"+resource.Name, redisPrefix+"stats:"+resource.Name)
		args = append(args, resource.Name)
	}
	keys = append(keys, redisPrefix+"resources")
	value, err := renewScript.Run(ctx, r.Client, keys, args...).Int()
	return value == 1, err
}

func (r *RedisStore) Release(ctx context.Context, resources []Resource, id string) error {
	pipe := r.Client.Pipeline()
	for _, resource := range resources {
		pipe.ZRem(ctx, redisPrefix+"slots:"+resource.Name, id)
	}
	_, err := pipe.Exec(ctx)
	return err
}

func (r *RedisStore) Reject(ctx context.Context, resource Resource) error {
	return rejectScript.Run(ctx, r.Client, []string{redisPrefix + "stats:" + resource.Name, redisPrefix + "resources"}, resource.Name, resource.Limit).Err()
}

func (r *RedisStore) Snapshot(ctx context.Context) ([]Occupancy, error) {
	result, err := snapshotScript.Run(ctx, r.Client, []string{redisPrefix + "resources"}, redisPrefix).Slice()
	if err != nil {
		return nil, err
	}
	rows := make([]Occupancy, 0, len(result))
	for _, item := range result {
		parts, ok := item.([]any)
		if !ok || len(parts) != 5 {
			return nil, fmt.Errorf("invalid concurrency status response")
		}
		name, nameOK := parts[0].(string)
		active, activeOK := parts[1].(int64)
		admittedText, admittedOK := parts[2].(string)
		rejectedText, rejectedOK := parts[3].(string)
		limitText, limitOK := parts[4].(string)
		if !nameOK || !activeOK || !admittedOK || !rejectedOK || !limitOK {
			return nil, fmt.Errorf("invalid concurrency status values")
		}
		admitted, admittedErr := strconv.ParseInt(admittedText, 10, 64)
		rejected, rejectedErr := strconv.ParseInt(rejectedText, 10, 64)
		limit, limitErr := strconv.Atoi(limitText)
		if admittedErr != nil || rejectedErr != nil || limitErr != nil {
			return nil, fmt.Errorf("invalid concurrency status counters")
		}
		rows = append(rows, Occupancy{Resource: name, Active: int(active), Limit: limit, Admitted: admitted, Rejected: rejected})
	}
	return rows, nil
}
