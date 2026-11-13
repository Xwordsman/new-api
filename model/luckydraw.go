package model

import (
	"context"
	"time"

	"github.com/QuantumNous/new-api/extensions/luckydraw/policy"
)

// UserLuckyDraw publishes the committed credit to the live quota cache once.
// Replayed HTTP requests return the same record without incrementing the cache.
func UserLuckyDraw(ctx context.Context, userID int, key string, version int, verified bool) (*policy.Result, error) {
	result, err := policy.Draw(DB.WithContext(ctx), userID, key, version, time.Now(), verified)
	if err == nil && !result.Replay {
		syncCreditUserQuotaCache(userID, result.Record.QuotaAwarded, "lucky draw")
	}
	return result, err
}
