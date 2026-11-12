package service

import (
	"errors"
	"math"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/extensions/registrationrisk/guard"
	"github.com/QuantumNous/new-api/model"
)

var promotionalFundingInstalled atomic.Bool

func EnablePromotionalFunding() { promotionalFundingInstalled.Store(true) }

// PromotionalFunding uses an expiring grant for the initial estimate and the
// existing cache-aware wallet for further reservations or final overages.
// Synchronous BillingSession requests only: asynchronous task settlement keeps
// the host's durable wallet/subscription accounting unchanged.
type PromotionalFunding struct {
	requestID      string
	userID         int
	model          string
	initial        int
	wallet         WalletFunding
	committed      bool
	walletDone     bool
	grantDone      bool
	refundedWallet bool
	finalActual    int
}

func (p *PromotionalFunding) Source() string { return BillingSourcePromotional }
func (p *PromotionalFunding) PreConsume(amount int) error {
	reserved, err := guard.ReserveTrial(model.DB, p.requestID, p.userID, amount, p.model, time.Now())
	if errors.Is(err, guard.ErrUnavailable) {
		return ErrInsufficientWalletQuota
	}
	if err != nil {
		return err
	}
	p.initial = reserved
	p.wallet.userId = p.userID
	return nil
}
func (p *PromotionalFunding) Settle(delta int) error {
	actual64 := int64(p.initial) + int64(p.wallet.consumed) + int64(delta)
	if actual64 < 0 || actual64 > math.MaxInt32 {
		return guard.ErrInvalid
	}
	actual := int(actual64)
	if p.committed && p.finalActual != actual {
		return guard.ErrConflict
	}
	trial := min(actual, p.initial)
	if !p.walletDone {
		if err := p.wallet.Settle(actual - trial - p.wallet.consumed); err != nil {
			return err
		}
		// Once either leg is committed a later failure must never refund the whole
		// request. A retry may finish the idempotent grant leg with the same charge.
		p.walletDone = true
		p.committed = true
		p.finalActual = actual
	}
	if !p.grantDone {
		if err := guard.FinishTrial(model.DB, p.requestID, p.userID, trial, false); err != nil {
			return err
		}
		p.grantDone = true
	}
	return nil
}
func (p *PromotionalFunding) Refund() error {
	if p.committed {
		return nil
	}
	if !p.refundedWallet {
		if err := p.wallet.Refund(); err != nil {
			return err
		}
		p.refundedWallet = true
	}
	return guard.FinishTrial(model.DB, p.requestID, p.userID, 0, true)
}
