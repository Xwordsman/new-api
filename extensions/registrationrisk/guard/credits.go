package guard

import (
	"errors"
	"fmt"
	"math"
	"slices"
	"time"

	"gorm.io/gorm"
)

// ReserveTrial funds an entire initial estimate from a grant. If the grant
// cannot cover it, the caller falls back to the ordinary paid funding path.
// Further estimates and settlement overages use the host wallet, whose cache
// and batch semantics remain owned by the host rather than this extension.
func ReserveTrial(db *gorm.DB, requestID string, userID, amount int, model string, now time.Time) (int, error) {
	if requestID == "" || len(requestID) > 64 || userID <= 0 || amount < 0 || amount > math.MaxInt32 {
		return 0, ErrInvalid
	}
	s, err := GetSettings(db)
	if err != nil {
		return 0, err
	}
	if !s.BonusEnabled || len(s.BonusModels) > 0 && !slices.Contains(s.BonusModels, model) {
		return 0, ErrUnavailable
	}
	reserved := 0
	err = db.Transaction(func(tx *gorm.DB) error {
		// An update, rather than a dialect-specific row lock, serializes grant
		// reservations on every supported database (including SQLite).
		r := tx.Model(&Grant{}).Where("user_id = ?", userID).UpdateColumn("version", gorm.Expr("version + 1"))
		if r.Error != nil {
			return r.Error
		}
		if r.RowsAffected == 0 {
			return ErrUnavailable
		}
		var grant Grant
		if err := tx.First(&grant, "user_id = ?", userID).Error; err != nil {
			return err
		}
		var existing Reservation
		err := tx.First(&existing, "request_id = ?", requestID).Error
		if err == nil {
			if existing.UserID != userID || existing.State != "reserved" || existing.Trial != amount {
				return ErrUnavailable
			}
			reserved = existing.Trial
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if grant.State != "active" || grant.ExpiresAt <= now.Unix() || grant.Remaining <= 0 || grant.Remaining < amount {
			return ErrUnavailable
		}
		var active int64
		if err := tx.Model(&Reservation{}).Where("user_id = ? AND state = ? AND lease_until > ?", userID, "reserved", now.Unix()).Count(&active).Error; err != nil {
			return err
		}
		if active >= int64(s.BonusConcurrency) {
			return ErrUnavailable
		}
		start := now.Unix() / 60 * 60
		count, err := Increment(tx, fmt.Sprintf("trial-rpm:%d:%d", userID, start), start+60, 1)
		if err != nil {
			return err
		}
		if count > int64(s.BonusRPM) {
			return ErrUnavailable
		}
		if err := tx.Model(&grant).Update("remaining", grant.Remaining-amount).Error; err != nil {
			return err
		}
		reserved = amount
		return tx.Create(&Reservation{RequestID: requestID, UserID: userID, Trial: amount, State: "reserved", CreatedAt: now.Unix(), LeaseUntil: now.Unix() + int64(s.LeaseSeconds)}).Error
	})
	return reserved, err
}

// FinishTrial is idempotent. Refunded quota stays promotional even after expiry;
// it is never transferred to the paid wallet. A reserved amount is a hard cap
// on the promotional share of a request's final cost.
func FinishTrial(db *gorm.DB, requestID string, userID, actual int, refund bool) error {
	if actual < 0 || actual > math.MaxInt32 {
		return ErrInvalid
	}
	return db.Transaction(func(tx *gorm.DB) error {
		locked := tx.Model(&Grant{}).Where("user_id = ?", userID).UpdateColumn("version", gorm.Expr("version + 1"))
		if locked.Error != nil {
			return locked.Error
		}
		if locked.RowsAffected != 1 {
			return ErrConflict
		}
		var row Reservation
		if err := tx.First(&row, "request_id = ? AND user_id = ?", requestID, userID).Error; err != nil {
			return err
		}
		if row.State != "reserved" {
			return nil
		}
		if refund {
			actual = 0
		}
		if actual > row.Trial {
			return ErrInvalid
		}
		// MySQL reports changed rows, so an exact estimate needs no zero-delta
		// UPDATE. The version update above already locked and verified the grant.
		if returned := row.Trial - actual; returned > 0 {
			result := tx.Model(&Grant{}).Where("user_id = ? AND remaining <= ?", userID, math.MaxInt32-returned).UpdateColumn("remaining", gorm.Expr("remaining + ?", returned))
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrConflict
			}
		}
		state := "settled"
		if refund {
			state = "refunded"
		}
		return tx.Model(&row).Updates(map[string]any{"state": state, "trial": actual, "lease_until": 0}).Error
	})
}
