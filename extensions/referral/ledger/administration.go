package ledger

import (
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// HoldMemberRewards covers both incoming invitations and rewards earned from
// other invitees. Already awarded funds are preserved; future rewards stay held.
// Account -> binding locking matches award/claim/review and protects an explicit
// approval from being overwritten by an analysis that started earlier.
func HoldMemberRewards(db *gorm.DB, ids []int, actor int, now int64) error {
	if len(ids) == 0 {
		return nil
	}
	// Bound bind parameters for every supported database, including large scans.
	for start := 0; start < len(ids); start += 200 {
		batch := ids[start:min(start+200, len(ids))]
		var bindings []Binding
		if err := db.Where("(user_id IN ? OR inviter_id IN ?) AND state = ? AND reviewed_at = 0", batch, batch, "active").Order("inviter_id, id").Find(&bindings).Error; err != nil {
			return err
		}
		for _, candidate := range bindings {
			if err := db.Transaction(func(tx *gorm.DB) error {
				if _, err := lockAccount(tx, candidate.InviterID); err != nil {
					return err
				}
				var binding Binding
				if err := Lock(tx).First(&binding, candidate.ID).Error; err != nil {
					return err
				}
				if binding.State != "active" || binding.ReviewedAt > 0 {
					return nil
				}
				if err := tx.Model(&binding).Updates(map[string]any{"state": "review", "reason": "Associated accounts require referral review"}).Error; err != nil {
					return err
				}
				return tx.Create(&Audit{ActorID: actor, UserID: binding.UserID, Action: "association_hold", Detail: "Associated accounts require referral review", CreatedAt: now}).Error
			}); err != nil {
				return err
			}
		}
	}
	return nil
}

// ImportLegacyBalances preserves previously awarded referral credits. Clearing
// the legacy column and importing its balance commit together, exactly once.
func ImportLegacyBalances(db *gorm.DB) error {
	var users []struct{ ID, AffQuota int }
	return db.Table("users").Where("aff_quota > 0").FindInBatches(&users, 200, func(batch *gorm.DB, _ int) error {
		for _, user := range users {
			if err := db.Transaction(func(tx *gorm.DB) error {
				account, err := lockAccount(tx, user.ID)
				if err != nil {
					return err
				}
				var current struct{ ID, AffQuota int }
				if err := Lock(tx).Table("users").Where("id = ?", user.ID).Take(&current).Error; err != nil {
					return err
				}
				if current.AffQuota <= 0 {
					return nil
				}
				account.Balance, err = checkedAdd(account.Balance, current.AffQuota)
				if err != nil {
					return err
				}
				account.Earned, err = checkedAdd(account.Earned, current.AffQuota)
				if err != nil {
					return err
				}
				if err := tx.Save(&account).Error; err != nil {
					return err
				}
				if err := tx.Table("users").Where("id = ?", user.ID).Update("aff_quota", 0).Error; err != nil {
					return err
				}
				return tx.Create(&Audit{UserID: user.ID, Action: "legacy_balance", Detail: common.GetJsonString(map[string]any{"quota": current.AffQuota}), CreatedAt: time.Now().Unix()}).Error
			}); err != nil {
				return err
			}
		}
		return nil
	}).Error
}

// Review approves qualification and releases a pending signup bonus. Historical
// payments are never inferred; backfilled orders need separate reconciliation.
func Review(db *gorm.DB, id, actor int, approve bool, reason string) error {
	reason = strings.TrimSpace(reason)
	if len(reason) < 3 || len(reason) > 500 {
		return ErrInvalid
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var binding Binding
		if err := tx.First(&binding, id).Error; err != nil {
			return err
		}
		if _, err := lockAccount(tx, binding.InviterID); err != nil {
			return err
		}
		if err := Lock(tx).First(&binding, id).Error; err != nil {
			return err
		}
		binding.State, binding.Reason, binding.ReviewedAt = "ineligible", "Referral qualification was rejected", time.Now().Unix()
		if approve {
			if err := activeUsers(tx, binding.InviterID, binding.UserID); err != nil {
				return err
			}
			binding.State, binding.Reason = "active", ""
		}
		if err := tx.Save(&binding).Error; err != nil {
			return err
		}
		if err := tx.Create(&Audit{ActorID: actor, UserID: binding.UserID, Action: "review", Detail: common.GetJsonString(map[string]any{"approve": approve, "reason": reason}), CreatedAt: time.Now().Unix()}).Error; err != nil {
			return err
		}
		if approve {
			return CompleteSignup(tx, binding.UserID)
		}
		return nil
	})
}

func AuditRefund(db *gorm.DB, tradeNo, amount, reason string, actor int) error {
	reason = strings.TrimSpace(reason)
	reasonLength := utf8.RuneCountInString(reason)
	if actor <= 0 || tradeNo == "" || len(tradeNo) > 255 || len(amount) > 48 || reasonLength < 3 || reasonLength > 500 {
		return ErrInvalid
	}
	var reward Reward
	if err := db.First(&reward, "trade_no = ?", tradeNo).Error; err != nil {
		return err
	}
	total, err := decimal.NewFromString(amount)
	if err != nil || total.IsNegative() {
		return ErrInvalid
	}
	paid, err := decimal.NewFromString(reward.Amount)
	if err != nil || total.GreaterThan(paid) {
		return ErrInvalid
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var notice RefundNotice
		if err := Lock(tx).First(&notice, "provider = ? AND reference = ?", reward.Provider, reward.Reference).Error; err == nil {
			previous, err := decimal.NewFromString(notice.Amount)
			if err != nil || total.LessThan(previous) {
				return ErrInvalid
			}
		} else if !isMissing(err) {
			return err
		}
		if err := Refund(tx, reward.Provider, reward.Reference, amount, reward.Currency); err != nil {
			return err
		}
		return tx.Create(&Audit{ActorID: actor, UserID: reward.UserID, Action: "refund", Detail: common.GetJsonString(map[string]any{"trade_no": tradeNo, "cumulative_amount": amount, "reason": reason}), CreatedAt: time.Now().Unix()}).Error
	})
}
