package ledger

import (
	"strings"

	"github.com/shopspring/decimal"
)

// MinorAmount normalizes verified payment-provider minor units. Currencies
// other than USD/CNY stay unpriced until an administrator supplies an FX rate.
func MinorAmount(value, currency string) (string, error) {
	if len(value) > 32 {
		return "", ErrInvalid
	}
	amount, err := decimal.NewFromString(value)
	if err != nil || amount.IsNegative() || !amount.Equal(amount.Truncate(0)) {
		return "", ErrInvalid
	}
	digits := int32(2)
	switch strings.ToUpper(currency) {
	case "JPY", "KRW", "VND", "CLP", "XAF", "XOF", "XPF", "RWF", "UGX", "BIF", "DJF", "GNF", "KMF", "PYG", "VUV":
		digits = 0
	case "BHD", "JOD", "KWD", "OMR", "TND":
		digits = 3
	}
	return amount.Shift(-digits).String(), nil
}
