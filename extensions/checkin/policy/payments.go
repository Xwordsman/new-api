package policy

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/extensions/referral/ledger"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrPaymentInvalid  = common.NewMessage("Invalid check-in payment parameters")
	ErrPaymentConflict = common.NewMessage("Check-in payment facts conflict")
	ErrPaymentNotFound = common.NewMessage("Check-in payment was not found")
)

// RecordPayment joins a verified top-up completion transaction. Collection is
// independent of check-in/referral switches and invite relationships.
func RecordPayment(tx *gorm.DB, userID int, tradeNo, provider string, payment ledger.Payment) error {
	if payment.USDPerUnit != "" || strings.EqualFold(strings.TrimSpace(provider), "redemption") {
		return ErrPaymentInvalid
	}
	return recordCheckinPayment(tx, userID, tradeNo, provider, PaymentSourceTopUp, payment, 0, "")
}

func RecordSubscriptionPayment(tx *gorm.DB, userID int, tradeNo, provider string, payment ledger.Payment) error {
	if payment.USDPerUnit != "" || strings.EqualFold(strings.TrimSpace(provider), "balance") || strings.EqualFold(strings.TrimSpace(provider), "redemption") {
		return ErrPaymentInvalid
	}
	return recordCheckinPayment(tx, userID, tradeNo, provider, PaymentSourceSubscription, payment, 0, "")
}

// RecordRedemptionPayment records an administrator-declared sale value, not a
// verified payment callback. Only the host's successful code redemption calls it.
func RecordRedemptionPayment(tx *gorm.DB, userID int, tradeNo, provider string, payment ledger.Payment) error {
	if provider != "redemption" || payment.USDPerUnit != "" || (payment.Currency != "CNY" && payment.Currency != "USD") {
		return ErrPaymentInvalid
	}
	amount, err := paymentDecimal(payment.Amount, false)
	if err != nil || amount.GreaterThan(decimal.NewFromInt(1000000000)) || !amount.Equal(amount.Truncate(2)) {
		return ErrPaymentInvalid
	}
	return recordCheckinPayment(tx, userID, tradeNo, provider, PaymentSourceRedemption, payment, 0, "")
}

// ReconcilePayment records an audited real payment or prices an existing
// unpriced one. The host must verify the referenced successful order belongs to
// userID. Historical payment dates remain historical; this never credits quota.
func ReconcilePayment(tx *gorm.DB, userID int, tradeNo, provider, source string, payment ledger.Payment, actorID int, reason string) error {
	reason = strings.TrimSpace(reason)
	reasonLength := utf8.RuneCountInString(reason)
	if actorID <= 0 || reasonLength < 3 || reasonLength > 500 || payment.PaidAt <= 0 || source == PaymentSourceRedemption || strings.EqualFold(strings.TrimSpace(provider), "redemption") {
		return ErrPaymentInvalid
	}
	return recordCheckinPayment(tx, userID, tradeNo, provider, source, payment, actorID, reason)
}

func recordCheckinPayment(db *gorm.DB, userID int, tradeNo, provider, source string, payment ledger.Payment, actorID int, reason string) error {
	provider = strings.ToLower(strings.TrimSpace(provider))
	tradeNo = strings.TrimSpace(tradeNo)
	payment.Reference = strings.TrimSpace(payment.Reference)
	if payment.Reference == "" {
		payment.Reference = tradeNo
	}
	payment.Currency = strings.ToUpper(strings.TrimSpace(payment.Currency))
	if userID <= 0 || tradeNo == "" || len(tradeNo) > 191 || provider == "" || len(provider) > 32 || provider == "balance" || payment.Reference == "" || len(payment.Reference) > 128 || !paymentCurrencyValid(payment.Currency) || (source != PaymentSourceTopUp && source != PaymentSourceSubscription && source != PaymentSourceRedemption) {
		return ErrPaymentInvalid
	}
	amount, err := paymentDecimal(payment.Amount, true)
	if err != nil {
		return err
	}
	if payment.PaidAt == 0 {
		payment.PaidAt = time.Now().Unix()
	}
	if payment.PaidAt < 0 || payment.PaidAt > time.Now().Add(5*time.Minute).Unix() {
		return ErrPaymentInvalid
	}
	return db.Transaction(func(tx *gorm.DB) error {
		settings, err := LockSettings(tx)
		if err != nil {
			return err
		}
		now := time.Now().Unix()
		cny, err := paymentDecimal(settings.CNYPerUSD, false)
		if err != nil {
			return err
		}
		rate, status := decimal.Zero, PaymentStatusUnpriced
		switch payment.Currency {
		case "USD":
			rate, status = decimal.NewFromInt(1), PaymentStatusPriced
		case "CNY":
			rate, status = decimal.NewFromInt(1).DivRound(cny, 16), PaymentStatusPriced
		}
		if payment.USDPerUnit != "" {
			// USD and CNY always retain their defined conversion. Other currencies
			// need an administrator's explicit rate, never a wallet-derived guess.
			if actorID <= 0 || payment.Currency == "USD" || payment.Currency == "CNY" {
				return ErrPaymentInvalid
			}
			rate, err = paymentDecimal(payment.USDPerUnit, false)
			if err != nil || rate.GreaterThan(decimal.NewFromInt(1000000)) {
				return ErrPaymentInvalid
			}
			status = PaymentStatusPriced
		}
		if actorID > 0 && status == PaymentStatusUnpriced {
			return ErrPaymentInvalid
		}

		var previous PaymentRecord
		err = tx.Where("trade_no = ?", tradeNo).First(&previous).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if previous.ID > 0 {
			previousAmount, parseErr := paymentDecimal(previous.Amount, true)
			if parseErr != nil {
				return parseErr
			}
			if previous.UserID != userID || previous.Provider != provider || previous.Reference != payment.Reference || previous.Source != source || previous.Currency != payment.Currency || !previousAmount.Equal(amount) {
				return ErrPaymentConflict
			}
			if previous.Status != PaymentStatusUnpriced || status == PaymentStatusUnpriced {
				if payment.USDPerUnit != "" && previous.Status != PaymentStatusUnpriced {
					previousRate, parseErr := paymentDecimal(previous.USDPerUnit, false)
					if parseErr != nil || !previousRate.Equal(rate) {
						return ErrPaymentConflict
					}
				}
				// Callback timestamps are receipt times for several providers; retries
				// must not change the original payment date or conversion snapshot.
				return nil
			}
			if actorID <= 0 {
				return ErrPaymentConflict
			}
			cny, err = paymentDecimal(previous.CNYPerUSD, false)
			if err != nil {
				return err
			}
		}

		var other PaymentRecord
		if err := tx.Where("provider = ? AND reference = ?", provider, payment.Reference).First(&other).Error; err == nil && other.TradeNo != tradeNo {
			return ErrPaymentConflict
		} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		// A settings write lock serializes eligibility, payments, and refunds in
		// all dialects, including SQLite. Provider keys remain independently unique.
		notice := PaymentRefund{Provider: provider, Reference: payment.Reference, Amount: "0", Currency: payment.Currency, CreatedAt: now, UpdatedAt: now}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&notice).Error; err != nil {
			return err
		}
		if err := tx.Where("provider = ? AND reference = ?", provider, payment.Reference).First(&notice).Error; err != nil {
			return err
		}
		if notice.Currency != payment.Currency {
			return ErrPaymentConflict
		}
		refunded, err := paymentDecimal(notice.Amount, true)
		if err != nil {
			return err
		}
		refunded = decimal.Min(refunded, amount)
		value := PaymentRecord{UserID: userID, TradeNo: tradeNo, Provider: provider, Reference: payment.Reference, Source: source, Amount: amount.String(), Currency: payment.Currency, CNYPerUSD: cny.String(), USDPerUnit: rate.String(), RefundedAmount: refunded.String(), Status: status, Origin: PaymentOriginProvider, PaidAt: payment.PaidAt, CreatedAt: now, UpdatedAt: now}
		if source == PaymentSourceRedemption {
			value.Origin = PaymentOriginRedemption
		}
		if actorID > 0 {
			value.Origin, value.Historical, value.ReconciledBy, value.ReconcileReason = PaymentOriginAdmin, true, actorID, reason
		}
		if previous.ID > 0 {
			value.ID, value.PaidAt, value.CreatedAt, value.Origin, value.Historical = previous.ID, previous.PaidAt, previous.CreatedAt, previous.Origin, previous.Historical
		}
		if err := tx.Save(&value).Error; err != nil {
			return err
		}
		if actorID > 0 {
			detail, err := common.Marshal(value)
			if err != nil {
				return err
			}
			return tx.Create(&Audit{ActorID: actorID, UserID: userID, Action: "payment_reconcile", Detail: string(detail), Reason: reason, CreatedAt: now, SettingsVersion: settings.Version}).Error
		}
		return nil
	})
}

// Refund accepts a verified cumulative provider amount. It is safe to call
// inside another transaction so referral reversals can commit together.
func Refund(db *gorm.DB, provider, reference, totalAmount, currency string) error {
	provider = strings.ToLower(strings.TrimSpace(provider))
	reference = strings.TrimSpace(reference)
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if provider == "" || len(provider) > 32 || provider == "balance" || reference == "" || len(reference) > 128 || !paymentCurrencyValid(currency) {
		return ErrPaymentInvalid
	}
	total, err := paymentDecimal(totalAmount, true)
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if _, err := LockSettings(tx); err != nil {
			return err
		}
		now := time.Now().Unix()
		notice := PaymentRefund{Provider: provider, Reference: reference, Amount: "0", Currency: currency, CreatedAt: now, UpdatedAt: now}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&notice).Error; err != nil {
			return err
		}
		if err := tx.Where("provider = ? AND reference = ?", provider, reference).First(&notice).Error; err != nil {
			return err
		}
		if notice.Currency != currency {
			return ErrPaymentConflict
		}
		previous, err := paymentDecimal(notice.Amount, true)
		if err != nil {
			return err
		}
		if total.LessThanOrEqual(previous) {
			return nil
		}
		notice.Amount, notice.UpdatedAt = total.String(), now
		if err := tx.Save(&notice).Error; err != nil {
			return err
		}
		var record PaymentRecord
		if err := tx.Where("provider = ? AND reference = ?", provider, reference).First(&record).Error; errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		} else if err != nil {
			return err
		}
		if record.Currency != currency {
			return ErrPaymentConflict
		}
		paid, err := paymentDecimal(record.Amount, true)
		if err != nil {
			return err
		}
		record.RefundedAmount, record.UpdatedAt = decimal.Min(total, paid).String(), now
		return tx.Save(&record).Error
	})
}

// RefundPayment is the audited manual counterpart, keyed by a recorded order.
// It changes qualification, never the wallet's paid funds or awarded rewards.
func RefundPayment(db *gorm.DB, tradeNo, totalAmount, reason string, actorID int) error {
	reason = strings.TrimSpace(reason)
	reasonLength := utf8.RuneCountInString(reason)
	if actorID <= 0 || tradeNo == "" || len(tradeNo) > 191 || reasonLength < 3 || reasonLength > 500 {
		return ErrPaymentInvalid
	}
	total, err := paymentDecimal(totalAmount, true)
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		settings, err := LockSettings(tx)
		if err != nil {
			return err
		}
		var value PaymentRecord
		if err := tx.Where("trade_no = ?", tradeNo).First(&value).Error; errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrPaymentNotFound
		} else if err != nil {
			return err
		}
		paid, err := paymentDecimal(value.Amount, true)
		if err != nil || total.GreaterThan(paid) {
			return ErrPaymentInvalid
		}
		previous, err := paymentDecimal(value.RefundedAmount, true)
		if err != nil {
			return err
		}
		if total.LessThan(previous) {
			return ErrPaymentConflict
		}
		if total.Equal(previous) {
			return nil
		}
		if err := Refund(tx, value.Provider, value.Reference, total.String(), value.Currency); err != nil {
			return err
		}
		detail, err := common.Marshal(map[string]any{"trade_no": value.TradeNo, "provider": value.Provider, "reference": value.Reference, "currency": value.Currency, "previous_amount": previous.String(), "cumulative_amount": total.String()})
		if err != nil {
			return err
		}
		return tx.Create(&Audit{ActorID: actorID, UserID: value.UserID, Action: "payment_refund", Detail: string(detail), Reason: reason, CreatedAt: time.Now().Unix(), SettingsVersion: settings.Version}).Error
	})
}

func PaymentSummary(tx *gorm.DB, userID int, settings Settings, now time.Time) (QualificationSummary, error) {
	value := QualificationSummary{QualifiedAmount: decimal.Zero}
	threshold, err := paymentDecimal(settings.ThresholdAmount, true)
	if err != nil || userID <= 0 || (settings.Currency != "USD" && settings.Currency != "CNY") {
		return value, ErrPaymentInvalid
	}
	location, err := time.LoadLocation(settings.Timezone)
	if err != nil {
		return value, ErrPaymentInvalid
	}
	now = now.In(location)
	query := tx.Model(&PaymentRecord{}).Where("user_id = ? AND status = ? AND paid_at <= ?", userID, PaymentStatusPriced, now.Unix())
	if !settings.IncludeSubscriptions {
		query = query.Where("source IN ?", []string{PaymentSourceTopUp, PaymentSourceRedemption})
	}
	if settings.RechargeMode == "rolling" {
		if settings.LookbackDays < 1 || settings.LookbackDays > 36500 {
			return value, ErrPaymentInvalid
		}
		query = query.Where("paid_at >= ?", now.AddDate(0, 0, -settings.LookbackDays).Unix())
	} else if settings.RechargeMode != "lifetime" {
		return value, ErrPaymentInvalid
	}
	rows, err := query.Order("paid_at ASC").Order("id ASC").Rows()
	if err != nil {
		return value, err
	}
	defer rows.Close()
	for rows.Next() {
		var payment PaymentRecord
		if err := tx.ScanRows(rows, &payment); err != nil {
			return value, err
		}
		net, err := paymentNetValue(payment, settings.Currency)
		if err != nil {
			return value, err
		}
		if !net.IsPositive() {
			continue
		}
		value.QualifiedAmount = value.QualifiedAmount.Add(net)
		value.LastRechargeAt = payment.PaidAt
		if value.QualifiedAt == 0 && value.QualifiedAmount.GreaterThanOrEqual(threshold) {
			value.QualifiedAt = payment.PaidAt
		}
	}
	if err := rows.Err(); err != nil {
		return value, err
	}
	if value.QualifiedAmount.LessThan(threshold) {
		return value, nil
	}
	value.Eligible = true
	if settings.EligibilityDays < 0 || settings.EligibilityDays > 36500 {
		return value, ErrPaymentInvalid
	}
	anchor := value.QualifiedAt
	if settings.RenewOnRecharge {
		anchor = value.LastRechargeAt
	}
	// A zero threshold explicitly removes monetary qualification. Payment
	// history remains visible, but it must not make paying users expire while
	// users without a payment remain eligible.
	if threshold.IsPositive() && settings.EligibilityDays > 0 && anchor > 0 {
		value.ExpiresAt = time.Unix(anchor, 0).In(location).AddDate(0, 0, settings.EligibilityDays).Unix()
		value.Eligible = now.Unix() < value.ExpiresAt
	}
	return value, nil
}

func paymentNetValue(payment PaymentRecord, currency string) (decimal.Decimal, error) {
	paid, err := paymentDecimal(payment.Amount, true)
	if err != nil {
		return decimal.Zero, err
	}
	refunded, err := paymentDecimal(payment.RefundedAmount, true)
	if err != nil || refunded.GreaterThan(paid) {
		return decimal.Zero, ErrPaymentInvalid
	}
	net := paid.Sub(refunded)
	if payment.Currency == currency {
		return net, nil
	}
	cny, err := paymentDecimal(payment.CNYPerUSD, false)
	if err != nil {
		return decimal.Zero, err
	}
	if payment.Currency == "CNY" {
		net = net.DivRound(cny, 16)
	} else if payment.Currency != "USD" {
		rate, err := paymentDecimal(payment.USDPerUnit, false)
		if err != nil {
			return decimal.Zero, err
		}
		net = net.Mul(rate)
	}
	if currency == "CNY" {
		net = net.Mul(cny)
	}
	return net, nil
}

// paymentDecimal bounds size and precision before arithmetic. Scientific
// notation, signs, whitespace, and partial numbers are not payment evidence.
func paymentDecimal(input string, allowZero bool) (decimal.Decimal, error) {
	if input == "" || len(input) > 48 {
		return decimal.Zero, ErrPaymentInvalid
	}
	whole, fraction, point := strings.Cut(input, ".")
	if whole == "" || (point && (fraction == "" || len(fraction) > 16)) {
		return decimal.Zero, ErrPaymentInvalid
	}
	for _, part := range []string{whole, fraction} {
		for _, character := range part {
			if character < '0' || character > '9' {
				return decimal.Zero, ErrPaymentInvalid
			}
		}
	}
	value, err := decimal.NewFromString(input)
	if err != nil || value.GreaterThan(decimal.NewFromInt(1000000000000)) || (!allowZero && !value.IsPositive()) {
		return decimal.Zero, ErrPaymentInvalid
	}
	return value, nil
}

func paymentCurrencyValid(currency string) bool {
	if len(currency) != 3 {
		return false
	}
	for _, character := range currency {
		if character < 'A' || character > 'Z' {
			return false
		}
	}
	return true
}
