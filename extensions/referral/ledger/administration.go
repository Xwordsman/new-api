package ledger

import (
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

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

// Review changes qualification only. Historical payments are never inferred or
// awarded automatically; each backfilled order needs a separate reconciliation.
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
		return tx.Create(&Audit{ActorID: actor, UserID: binding.UserID, Action: "review", Detail: common.GetJsonString(map[string]any{"approve": approve, "reason": reason}), CreatedAt: time.Now().Unix()}).Error
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
