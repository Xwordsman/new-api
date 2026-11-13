package model

import (
	"github.com/QuantumNous/new-api/extensions/referral/ledger"
	"gorm.io/gorm"
)

// Installed at startup by the referral extension. Nil hooks retain upstream
// behavior for embedders and isolated model tests.
var ReferralRegistrationHook func(tx *gorm.DB, userID, inviterID int, registeredAt int64) error
var ReferralPaymentHook func(tx *gorm.DB, userID int, tradeNo, provider string, payment ledger.Payment) error
var RegistrationPaymentHook func(tx *gorm.DB, userID int, provider, payer string) error
var ReferralTransferHook func(userID, quota int) error
var CheckinPaymentHook func(tx *gorm.DB, userID int, tradeNo, provider string, payment ledger.Payment) error
var CheckinRedemptionPaymentHook func(tx *gorm.DB, userID int, tradeNo, provider string, payment ledger.Payment) error
var CheckinSubscriptionPaymentHook func(tx *gorm.DB, userID int, tradeNo, provider string, payment ledger.Payment) error
var CheckinRefundHook func(tx *gorm.DB, provider, reference, totalAmount, currency string) error

func recordReferralPayment(tx *gorm.DB, topUp *TopUp, payments []ledger.Payment) error {
	if len(payments) == 0 {
		return nil
	}
	// Acquire the check-in settings lock before referral accounts or wallet
	// rows, matching the check-in award and shared refund lock order.
	if CheckinPaymentHook != nil {
		if err := CheckinPaymentHook(tx, topUp.UserId, topUp.TradeNo, topUp.PaymentProvider, payments[0]); err != nil {
			return err
		}
	}
	if ReferralPaymentHook != nil {
		if err := ReferralPaymentHook(tx, topUp.UserId, topUp.TradeNo, topUp.PaymentProvider, payments[0]); err != nil {
			return err
		}
	}
	if RegistrationPaymentHook != nil {
		return RegistrationPaymentHook(tx, topUp.UserId, topUp.PaymentProvider, payments[0].Payer)
	}
	return nil
}

// RecordPaymentRefund commits eligibility changes and referral reversals
// together. Only a verified provider event or an audited refund may call it.
func RecordPaymentRefund(db *gorm.DB, provider, reference, totalAmount, currency string) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if CheckinRefundHook != nil {
			if err := CheckinRefundHook(tx, provider, reference, totalAmount, currency); err != nil {
				return err
			}
		}
		if ReferralPaymentHook != nil {
			return ledger.Refund(tx, provider, reference, totalAmount, currency)
		}
		return nil
	})
}

func SyncReferralWalletCache(userID, quota int) {
	syncCreditUserQuotaCache(userID, quota, "referral transfer")
}
