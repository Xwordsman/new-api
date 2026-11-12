package ledger

import (
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// RecordPayment joins the host top-up transaction. A callback retry cannot
// create a second reward, and a failed wallet credit cannot leave a reward.
func RecordPayment(tx *gorm.DB, userID int, tradeNo, provider string, payment Payment) error {
	settings, err := GetSettings(tx)
	if err != nil {
		return err
	}
	if !settings.Enabled {
		return nil
	}
	if tradeNo == "" || len(tradeNo) > 255 || provider == "" || len(provider) > 50 || len(payment.Amount) > 48 || len(payment.Reference) > 255 || len(payment.Currency) > 8 || len(payment.Payer) > 2048 {
		return ErrInvalid
	}
	payerHash := ""
	if payment.Payer != "" {
		payerHash = digest(settings.RiskSalt, provider+":"+payment.Payer)
		identity := PaymentIdentity{UserID: userID, Digest: payerHash}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&identity).Error; err != nil {
			return err
		}
	}
	// Serialize payments with refunds on the provider reference, including a
	// refund delivered before the checkout notification.
	var notice RefundNotice
	if payment.Reference != "" {
		notice = RefundNotice{Provider: provider, Reference: payment.Reference, Amount: "0", Currency: strings.ToUpper(strings.TrimSpace(payment.Currency))}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&notice).Error; err != nil {
			return err
		}
		if err := Lock(tx).First(&notice, "provider = ? AND reference = ?", provider, payment.Reference).Error; err != nil {
			return err
		}
	}
	var binding Binding
	if err := tx.First(&binding, "user_id = ?", userID).Error; err != nil {
		if isMissing(err) {
			return nil
		}
		return err
	}
	account, err := lockAccount(tx, binding.InviterID)
	if err != nil {
		return err
	}
	if err := Lock(tx).First(&binding, binding.ID).Error; err != nil {
		return err
	}
	var existing Reward
	if err := tx.First(&existing, "trade_no = ?", tradeNo).Error; err == nil {
		if existing.State != "unpriced" || payment.USDPerUnit == "" {
			return nil
		}
	} else if !isMissing(err) {
		return err
	}
	if payment.PaidAt == 0 {
		payment.PaidAt = time.Now().Unix()
	}
	if payment.PaidAt < binding.RegisteredAt || payment.PaidAt >= binding.ExpiresAt || binding.State == "ineligible" || binding.State == "historical" {
		return nil
	}
	if err := checkQualification(tx, &binding); err != nil {
		return err
	}
	amount, err := decimal.NewFromString(payment.Amount)
	if err != nil || amount.IsNegative() || amount.GreaterThan(decimal.NewFromInt(1000000000)) {
		return ErrInvalid
	}
	currency := strings.ToUpper(strings.TrimSpace(payment.Currency))
	rate := decimal.NewFromInt(1)
	state := "pending"
	switch currency {
	case "USD":
	case "CNY":
		cny, err := decimal.NewFromString(settings.CNYPerUSD)
		if err != nil || !cny.IsPositive() {
			return ErrInvalid
		}
		rate = decimal.NewFromInt(1).Div(cny)
	default:
		// Unknown currencies require explicit USD reconciliation; never infer
		// actual payment from credited quota, promotional credits or face value.
		rate, state = decimal.Zero, "unpriced"
	}
	if payment.USDPerUnit != "" {
		if len(payment.USDPerUnit) > 32 {
			return ErrInvalid
		}
		rate, err = decimal.NewFromString(payment.USDPerUnit)
		if err != nil || !rate.IsPositive() || rate.GreaterThan(decimal.NewFromInt(1000000)) {
			return ErrInvalid
		}
		state = "pending"
	}
	paidQuota, err := common.WalletQuotaFromDecimalStrict(amount.Mul(rate).Mul(decimal.NewFromFloat(common.QuotaPerUnit)).Truncate(0))
	if err != nil {
		return err
	}
	quota, err := common.WalletQuotaFromDecimalStrict(decimal.NewFromInt(int64(paidQuota)).Mul(decimal.NewFromInt(int64(binding.RateBPS))).Div(decimal.NewFromInt(10000)).Truncate(0))
	if err != nil {
		return err
	}
	quota = min(quota, max(0, binding.CapQuota-binding.Reserved))
	if payment.Payer != "" {
		var shared int64
		if err := tx.Model(&PaymentIdentity{}).Where("digest = ? AND user_id <> ?", payerHash, userID).Count(&shared).Error; err != nil {
			return err
		}
		if shared > 0 {
			binding.State, binding.Reason, binding.ReviewedAt = "review", "Shared payment account requires review", 0
			if err := tx.Save(&binding).Error; err != nil {
				return err
			}
		}
	}
	if existing.ID > 0 && payment.Payer == "" {
		payerHash = existing.PayerHash
	}
	reward := Reward{TradeNo: tradeNo, Provider: provider, Reference: payment.Reference, PayerHash: payerHash, UserID: userID, InviterID: binding.InviterID, PaidQuota: paidQuota, Amount: amount.String(), Currency: currency, ExchangeRate: rate.String(), RateBPS: binding.RateBPS, SettingsVersion: binding.SettingsVersion, Quota: quota, PaidAt: payment.PaidAt, AvailableAt: payment.PaidAt + int64(binding.CoolingHours)*3600, State: state, Historical: binding.Historical}
	if existing.ID > 0 {
		reward.ID = existing.ID
	}
	if err := tx.Save(&reward).Error; err != nil {
		return err
	}
	if err := tx.Model(&binding).Update("reserved", binding.Reserved+quota).Error; err != nil {
		return err
	}
	if payment.Reference != "" && notice.Amount != "0" {
		return applyRefund(tx, &account, &reward, notice.Amount, notice.Currency)
	}
	return nil
}

func Claim(db *gorm.DB, userID, rewardID int, now int64) (int, error) {
	claimed := 0
	err := db.Transaction(func(tx *gorm.DB) error {
		settings, err := GetSettings(tx)
		if err != nil {
			return err
		}
		if !settings.Enabled {
			return ErrUnavailable
		}
		account, err := lockAccount(tx, userID)
		if err != nil {
			return err
		}
		query := Lock(tx).Where("inviter_id = ? AND state = ? AND available_at <= ? AND quota > reversed", userID, "pending", now).
			Where("EXISTS (SELECT 1 FROM extension_referral_bindings b WHERE b.user_id = extension_referral_rewards.user_id AND b.inviter_id = ? AND b.state = ?)", userID, "active")
		if rewardID > 0 {
			query = query.Where("id = ?", rewardID)
		}
		var rewards []Reward
		if err := query.Order("id ASC").Limit(200).Find(&rewards).Error; err != nil {
			return err
		}
		for _, reward := range rewards {
			var binding Binding
			if err := Lock(tx).First(&binding, "user_id = ? AND inviter_id = ?", reward.UserID, userID).Error; err != nil {
				return err
			}
			if err := checkQualification(tx, &binding); err != nil {
				if err == ErrUnavailable {
					continue
				}
				return err
			}
			if binding.State != "active" {
				continue
			}
			net := reward.Quota - reward.Reversed
			if net <= 0 {
				continue
			}
			offset := min(net, account.Debt)
			account.Debt -= offset
			account.Balance, err = checkedAdd(account.Balance, net-offset)
			if err != nil {
				return err
			}
			account.Earned, err = checkedAdd(account.Earned, net)
			if err != nil {
				return err
			}
			reward.ClaimedAt, reward.Offset, reward.State = now, offset, "claimed"
			if err := tx.Save(&reward).Error; err != nil {
				return err
			}
			claimed++
		}
		return tx.Save(&account).Error
	})
	if err == nil && claimed == 0 {
		err = ErrUnavailable
	}
	return claimed, err
}

// TransferBalance credits only spendable wallet quota. It never creates a
// top-up/VIP record. RequestID makes transport retries safe across instances.
func TransferBalance(db *gorm.DB, userID int, requestID string, quota int, now int64) (Transfer, bool, error) {
	transfer := Transfer{}
	replayed := false
	if len(requestID) < 16 || len(requestID) > 64 || quota <= 0 {
		return transfer, false, ErrInvalid
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		account, err := lockAccount(tx, userID)
		if err != nil {
			return err
		}
		if err := tx.First(&transfer, "user_id = ? AND request_id = ?", userID, requestID).Error; err == nil {
			if transfer.Quota != quota {
				return ErrInvalid
			}
			replayed = true
			return nil
		} else if !isMissing(err) {
			return err
		}
		var user HostUser
		if err := tx.First(&user, "id = ? AND status = ?", userID, common.UserStatusEnabled).Error; err != nil {
			return ErrUnavailable
		}
		if account.Debt != 0 || account.Balance < quota || quota > common.MaxWalletQuota {
			return ErrUnavailable
		}
		result := tx.Table("users").Where("id = ? AND quota <= ?", userID, common.MaxWalletQuota-quota).Update("quota", gorm.Expr("quota + ?", quota))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrUnavailable
		}
		account.Balance -= quota
		account.Transferred, err = checkedAdd(account.Transferred, quota)
		if err != nil {
			return err
		}
		if err := tx.Save(&account).Error; err != nil {
			return err
		}
		transfer = Transfer{UserID: userID, RequestID: requestID, Quota: quota, CreatedAt: now}
		return tx.Create(&transfer).Error
	})
	return transfer, replayed, err
}

func Refund(db *gorm.DB, provider, reference, amount, currency string) error {
	if len(amount) > 48 || provider == "" || len(provider) > 50 || reference == "" || len(reference) > 255 || len(currency) > 8 {
		return ErrInvalid
	}
	total, err := decimal.NewFromString(amount)
	if err != nil || total.IsNegative() || total.GreaterThan(decimal.NewFromInt(1000000000)) {
		return ErrInvalid
	}
	return db.Transaction(func(tx *gorm.DB) error {
		notice := RefundNotice{Provider: provider, Reference: reference, Amount: "0", Currency: strings.ToUpper(currency)}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&notice).Error; err != nil {
			return err
		}
		if err := Lock(tx).First(&notice, "provider = ? AND reference = ?", provider, reference).Error; err != nil {
			return err
		}
		previous, err := decimal.NewFromString(notice.Amount)
		if err != nil {
			return err
		}
		if notice.Currency != strings.ToUpper(currency) {
			return ErrInvalid
		}
		if total.LessThanOrEqual(previous) {
			return nil
		}
		notice.Amount = total.String()
		if err := tx.Save(&notice).Error; err != nil {
			return err
		}
		var rewards []Reward
		if err := tx.Where("provider = ? AND reference = ?", provider, reference).Find(&rewards).Error; err != nil {
			return err
		}
		for _, reward := range rewards {
			account, err := lockAccount(tx, reward.InviterID)
			if err != nil {
				return err
			}
			if err := Lock(tx).First(&reward, reward.ID).Error; err != nil {
				return err
			}
			if err := applyRefund(tx, &account, &reward, notice.Amount, notice.Currency); err != nil {
				return err
			}
		}
		return nil
	})
}

func applyRefund(tx *gorm.DB, account *Account, reward *Reward, amount, currency string) error {
	if reward.Currency != currency {
		return ErrInvalid
	}
	paid, err := decimal.NewFromString(reward.Amount)
	if err != nil || !paid.IsPositive() {
		return ErrInvalid
	}
	refunded, err := decimal.NewFromString(amount)
	if err != nil {
		return err
	}
	refunded = decimal.Min(refunded, paid)
	refundedQuota, err := common.WalletQuotaFromDecimalStrict(decimal.NewFromInt(int64(reward.PaidQuota)).Mul(refunded).Div(paid).Truncate(0))
	if err != nil {
		return err
	}
	// Reward the net actual payment at the snapshotted rate, still bounded by
	// this order's original cap allocation. A refund never reopens the cap.
	netReward, err := common.WalletQuotaFromDecimalStrict(decimal.NewFromInt(int64(reward.PaidQuota - refundedQuota)).Mul(decimal.NewFromInt(int64(reward.RateBPS))).Div(decimal.NewFromInt(10000)).Truncate(0))
	if err != nil {
		return err
	}
	reversed := reward.Quota - min(reward.Quota, netReward)
	delta := reversed - reward.Reversed
	if delta <= 0 && refundedQuota <= reward.RefundedQuota {
		return nil
	}
	if reward.State == "claimed" && delta > 0 {
		fromBalance := min(account.Balance, delta)
		account.Balance -= fromBalance
		account.Debt, err = checkedAdd(account.Debt, delta-fromBalance)
		if err != nil {
			return err
		}
		account.Earned = max(0, account.Earned-delta)
		if err := tx.Save(account).Error; err != nil {
			return err
		}
	}
	reward.Reversed, reward.RefundedQuota = reversed, refundedQuota
	return tx.Save(reward).Error
}
