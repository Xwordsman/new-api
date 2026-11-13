package policy

import (
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

const (
	PaymentSourceTopUp        = "topup"
	PaymentSourceSubscription = "subscription"
	PaymentSourceRedemption   = "redemption"
	PaymentOriginProvider     = "provider"
	PaymentOriginAdmin        = "admin"
	PaymentOriginRedemption   = "redemption"
	PaymentStatusPriced       = "priced"
	PaymentStatusUnpriced     = "unpriced"
)

// PaymentRecord is an eligibility ledger. Writing one never changes a wallet
// or infers payment from a top-up's credited face value.
type PaymentRecord struct {
	ID              int    `json:"id" gorm:"primaryKey"`
	UserID          int    `json:"user_id" gorm:"index:checkin_payment_user_time,priority:1"`
	TradeNo         string `json:"trade_no" gorm:"type:varchar(191);uniqueIndex"`
	Provider        string `json:"provider" gorm:"type:varchar(32);uniqueIndex:checkin_payment_reference,priority:1"`
	Reference       string `json:"reference" gorm:"type:varchar(128);uniqueIndex:checkin_payment_reference,priority:2"`
	Source          string `json:"source" gorm:"type:varchar(24)"`
	Amount          string `json:"amount" gorm:"type:varchar(48)"`
	Currency        string `json:"currency" gorm:"type:varchar(8)"`
	CNYPerUSD       string `json:"cny_per_usd" gorm:"type:varchar(48)"`
	USDPerUnit      string `json:"usd_per_unit" gorm:"type:varchar(48)"`
	RefundedAmount  string `json:"refunded_amount" gorm:"type:varchar(48)"`
	Status          string `json:"status" gorm:"type:varchar(16)"`
	Origin          string `json:"origin" gorm:"type:varchar(16)"`
	Historical      bool   `json:"historical"`
	PaidAt          int64  `json:"paid_at" gorm:"index:checkin_payment_user_time,priority:2"`
	CreatedAt       int64  `json:"created_at"`
	UpdatedAt       int64  `json:"updated_at"`
	ReconciledBy    int    `json:"reconciled_by"`
	ReconcileReason string `json:"reconcile_reason" gorm:"type:varchar(500)"`
}

func (PaymentRecord) TableName() string { return "extension_checkin_payments" }

// PaymentRefund retains a cumulative provider total even when a refund arrives
// before payment. Older or repeated notifications cannot reduce that total.
type PaymentRefund struct {
	ID        int    `json:"id" gorm:"primaryKey"`
	Provider  string `json:"provider" gorm:"type:varchar(32);uniqueIndex:checkin_refund_reference,priority:1"`
	Reference string `json:"reference" gorm:"type:varchar(128);uniqueIndex:checkin_refund_reference,priority:2"`
	Amount    string `json:"amount" gorm:"type:varchar(48)"`
	Currency  string `json:"currency" gorm:"type:varchar(8)"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
}

func (PaymentRefund) TableName() string { return "extension_checkin_payment_refunds" }

// QualificationSummary describes monetary qualification only. Account status,
// registration review, and award limits are checked separately by check-in.
type QualificationSummary struct {
	Eligible        bool            `json:"eligible"`
	QualifiedAmount decimal.Decimal `json:"qualified_amount"`
	LastRechargeAt  int64           `json:"last_recharge_at"`
	QualifiedAt     int64           `json:"qualified_at"`
	ExpiresAt       int64           `json:"expires_at"`
}

func PaymentModels() []any { return []any{&PaymentRecord{}, &PaymentRefund{}} }

// PaymentQuery is also used by the administrator's eligibility ledger. The
// caller enforces whether UserID is the authenticated user or an admin filter.
type PaymentQuery struct {
	UserID   int
	Source   string
	Status   string
	TradeNo  string
	Page     int
	PageSize int
}

func GetPayments(db *gorm.DB, input PaymentQuery) ([]PaymentRecord, int64, error) {
	if input.UserID < 0 || input.Page < 1 || input.PageSize < 1 || input.PageSize > 100 || input.Page > 1000000 {
		return nil, 0, ErrPaymentInvalid
	}
	if input.Source != "" && input.Source != PaymentSourceTopUp && input.Source != PaymentSourceSubscription && input.Source != PaymentSourceRedemption {
		return nil, 0, ErrPaymentInvalid
	}
	if input.Status != "" && input.Status != PaymentStatusPriced && input.Status != PaymentStatusUnpriced {
		return nil, 0, ErrPaymentInvalid
	}
	if len(input.TradeNo) > 191 {
		return nil, 0, ErrPaymentInvalid
	}
	query := db.Model(&PaymentRecord{})
	if input.UserID > 0 {
		query = query.Where("user_id = ?", input.UserID)
	}
	if input.Source != "" {
		query = query.Where("source = ?", input.Source)
	}
	if input.Status != "" {
		query = query.Where("status = ?", input.Status)
	}
	if input.TradeNo != "" {
		query = query.Where("trade_no = ?", input.TradeNo)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	payments := make([]PaymentRecord, 0, input.PageSize)
	err := query.Order("id DESC").Limit(input.PageSize).Offset((input.Page - 1) * input.PageSize).Find(&payments).Error
	return payments, total, err
}
