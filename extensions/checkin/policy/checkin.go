package policy

import (
	"crypto/rand"
	"errors"
	"math/big"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func ReadHistory(db *gorm.DB, userID int, month string) (Stats, []CheckinRecord, error) {
	var stats Stats
	records := make([]CheckinRecord, 0)
	start, err := time.Parse("2006-01", month)
	if err != nil || len(month) != 7 || start.Year() < 1970 || userID <= 0 {
		return stats, records, ErrInvalid
	}
	query := db.Model(&Checkin{}).Where("user_id = ?", userID)
	if err := query.Select("COUNT(*) AS total_checkins, COALESCE(SUM(quota_awarded), 0) AS total_quota").Scan(&stats).Error; err != nil {
		return stats, records, err
	}
	if stats.TotalQuota < 0 || stats.TotalQuota > common.MaxWalletQuota {
		return stats, records, ErrUnavailable
	}
	if err := db.Model(&Checkin{}).Where("user_id = ? AND checkin_date >= ? AND checkin_date < ?", userID, start.Format("2006-01-02"), start.AddDate(0, 1, 0).Format("2006-01-02")).
		Select("checkin_date", "quota_awarded").Order("checkin_date DESC").Find(&records).Error; err != nil {
		return stats, records, err
	}
	stats.MonthCheckins = int64(len(records))
	for _, record := range records {
		if record.QuotaAwarded < 0 || stats.MonthQuota > common.MaxWalletQuota-record.QuotaAwarded {
			return stats, records, ErrUnavailable
		}
		stats.MonthQuota += record.QuotaAwarded
	}
	return stats, records, nil
}

func readAccount(tx *gorm.DB, userID int) (Account, error) {
	var account Account
	if err := tx.Where("user_id = ?", userID).Take(&account).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return Account{UserID: userID, State: "active"}, nil
	} else if err != nil {
		return account, err
	}
	if account.State != "active" && account.State != "paused" {
		return account, ErrUnavailable
	}
	return account, nil
}

// CheckinToday considers both the historical calendar key and actual payment
// time. The persisted reset also survives administrator timezone changes.
func CheckinToday(db *gorm.DB, userID int, settings Settings, now time.Time) (bool, error) {
	location, err := time.LoadLocation(settings.Timezone)
	if err != nil || userID <= 0 {
		return false, ErrInvalid
	}
	local := now.In(location)
	start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location)
	var count int64
	if err := db.Model(&Checkin{}).Where("user_id = ? AND (checkin_date = ? OR (created_at >= ? AND created_at < ?))", userID, local.Format("2006-01-02"), start.Unix(), start.AddDate(0, 0, 1).Unix()).Count(&count).Error; err != nil {
		return false, err
	}
	if count > 0 {
		return true, nil
	}
	account, err := readAccount(db, userID)
	return account.NextResetAt > now.Unix(), err
}

func accountEligibility(tx *gorm.DB, userID int, settings Settings, now time.Time, account Account, lock bool) (Eligibility, HostUser, error) {
	var user HostUser
	summary, err := PaymentSummary(tx, userID, settings, now)
	if err != nil {
		return Eligibility{}, user, err
	}
	threshold, _ := paymentDecimal(settings.ThresholdAmount, true)
	value := Eligibility{
		Eligible: summary.Eligible, QualifiedAmount: summary.QualifiedAmount.String(),
		RemainingAmount: decimal.Max(threshold.Sub(summary.QualifiedAmount), decimal.Zero).String(),
		Currency:        settings.Currency, LastRechargeAt: summary.LastRechargeAt,
		QualifiedAt: summary.QualifiedAt, ExpiresAt: summary.ExpiresAt,
	}
	if !summary.Eligible {
		value.Reason = ErrRechargeRequired.Key
		if summary.ExpiresAt > 0 && now.Unix() >= summary.ExpiresAt {
			value.Reason = ErrEligibilityExpired.Key
		}
	}
	if err := tx.Select("id", "status", "quota").Where("id = ?", userID).Take(&user).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		value.Eligible, value.Reason = false, ErrInactive.Key
		return value, user, nil
	} else if err != nil {
		return value, user, err
	}
	if user.Status != common.UserStatusEnabled {
		value.Eligible, value.Reason = false, ErrInactive.Key
		return value, user, nil
	}
	if account.State == "paused" {
		value.Eligible, value.Reason = false, ErrPaused.Key
		return value, user, nil
	}
	if !settings.FollowRegistrationRisk {
		return value, user, nil
	}
	query := tx
	if lock && tx.Dialector.Name() != "sqlite" {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	var risk RegistrationAccount
	if err := query.Select("user_id", "state").Where("user_id = ?", userID).Take(&risk).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return value, user, nil
	} else if err != nil {
		return value, user, err
	}
	if risk.State != "active" {
		value.Eligible, value.Reason = false, ErrRiskReview.Key
	}
	return value, user, nil
}

// rewardRange bounds the draw before randomness, so retrying a random reward
// cannot bypass a monthly cap or repeatedly reroll an over-budget award.
func rewardRange(tx *gorm.DB, userID int, settings Settings, now time.Time, stats Stats, walletQuota int) (int, int, error) {
	minimum, maximum := settings.RewardMinQuota, settings.RewardMaxQuota
	if settings.MonthlyCapQuota > 0 {
		location, err := time.LoadLocation(settings.Timezone)
		if err != nil {
			return 0, 0, ErrInvalid
		}
		local := now.In(location)
		start := time.Date(local.Year(), local.Month(), 1, 0, 0, 0, 0, location)
		end := start.AddDate(0, 1, 0)
		var used int64
		// Keep original calendar records and include awards actually paid in
		// this month's timezone window. A timezone change cannot erase spending
		// at the boundary simply by assigning it a different stored month.
		if err := tx.Model(&Checkin{}).Where("user_id = ? AND ((checkin_date >= ? AND checkin_date < ?) OR (created_at >= ? AND created_at < ?))", userID, start.Format("2006-01-02"), end.Format("2006-01-02"), start.Unix(), end.Unix()).
			Select("COALESCE(SUM(CASE WHEN quota_awarded > 0 THEN quota_awarded ELSE 0 END), 0)").Scan(&used).Error; err != nil {
			return 0, 0, err
		}
		if used < 0 || used > int64(settings.MonthlyCapQuota-minimum) {
			return 0, 0, ErrMonthlyCap
		}
		maximum = min(maximum, settings.MonthlyCapQuota-int(used))
	}
	lifetimeCap := common.MaxWalletQuota
	if settings.LifetimeCapQuota > 0 {
		lifetimeCap = settings.LifetimeCapQuota
	}
	if stats.TotalQuota > lifetimeCap-minimum {
		return 0, 0, ErrLifetimeCap
	}
	maximum = min(maximum, lifetimeCap-stats.TotalQuota)
	if settings.DailyBudgetQuota > 0 {
		location, err := time.LoadLocation(settings.Timezone)
		if err != nil {
			return 0, 0, ErrInvalid
		}
		local := now.In(location)
		start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location)
		var used int64
		if err := tx.Model(&Checkin{}).Where("checkin_date = ? OR (created_at >= ? AND created_at < ?)", local.Format("2006-01-02"), start.Unix(), start.AddDate(0, 0, 1).Unix()).
			Select("COALESCE(SUM(CASE WHEN quota_awarded > 0 THEN quota_awarded ELSE 0 END), 0)").Scan(&used).Error; err != nil {
			return 0, 0, err
		}
		if used < 0 || used > int64(settings.DailyBudgetQuota-minimum) {
			return 0, 0, ErrDailyBudget
		}
		maximum = min(maximum, settings.DailyBudgetQuota-int(used))
	}
	if walletQuota > common.MaxWalletQuota-minimum {
		return 0, 0, ErrWalletLimit
	}
	if walletQuota > 0 {
		maximum = min(maximum, common.MaxWalletQuota-walletQuota)
	}
	return minimum, maximum, nil
}

func Dashboard(db *gorm.DB, userID int, month string, now time.Time) (DashboardData, error) {
	var data DashboardData
	if userID <= 0 || now.Unix() < 0 {
		return data, ErrInvalid
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		settings, err := GetSettings(tx)
		if err != nil {
			return err
		}
		location, err := time.LoadLocation(settings.Timezone)
		if err != nil {
			return ErrInvalid
		}
		local := now.In(location)
		if month == "" {
			month = local.Format("2006-01")
		}
		account, err := readAccount(tx, userID)
		if err != nil {
			return err
		}
		var user HostUser
		data.Eligibility, user, err = accountEligibility(tx, userID, settings, now, account, false)
		if err != nil {
			return err
		}
		data.Stats, data.Records, err = ReadHistory(tx, userID, month)
		if err != nil {
			return err
		}
		data.CheckedInToday, err = CheckinToday(tx, userID, settings, now)
		if err != nil {
			return err
		}
		data.Enabled, data.Rules, data.Timezone = settings.Enabled, settings, settings.Timezone
		data.Today, data.Month = local.Format("2006-01-02"), month
		start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location)
		data.NextResetAt = max(start.AddDate(0, 0, 1).Unix(), account.NextResetAt)
		data.VerificationRequired = settings.RequireTurnstile || common.TurnstileCheckEnabled
		currentStats := data.Stats
		if month != local.Format("2006-01") {
			currentStats, _, err = ReadHistory(tx, userID, local.Format("2006-01"))
			if err != nil {
				return err
			}
		}
		switch {
		case !settings.Enabled:
			data.ClaimReason = ErrDisabled.Key
		case !data.Eligibility.Eligible:
			data.ClaimReason = data.Eligibility.Reason
		case data.CheckedInToday:
			data.ClaimReason = ErrAlreadyChecked.Key
		case data.VerificationRequired && (!common.TurnstileCheckEnabled || common.TurnstileSecretKey == "" || common.TurnstileSiteKey == ""):
			data.ClaimReason = ErrVerificationUnavailable.Key
		default:
			if _, _, err := rewardRange(tx, userID, settings, now, currentStats, user.Quota); err != nil {
				if !IsPolicyError(err) {
					return err
				}
				var message *common.Message
				if errors.As(err, &message) {
					data.ClaimReason = message.Key
				}
			}
		}
		data.Claimable = data.ClaimReason == ""
		return nil
	})
	return data, err
}

// Claim is the only reward transaction, including requests through upstream's
// legacy endpoint. Verification is supplied only after server-side validation.
func Claim(db *gorm.DB, userID int, now time.Time, verificationPassed ...bool) (*Checkin, error) {
	if userID <= 0 || now.Unix() < 0 {
		return nil, ErrInvalid
	}
	var checkin Checkin
	err := db.Transaction(func(tx *gorm.DB) error {
		settings, err := LockSettings(tx)
		if err != nil {
			return err
		}
		if !settings.Enabled {
			return ErrDisabled
		}
		if settings.RequireTurnstile || common.TurnstileCheckEnabled {
			if !common.TurnstileCheckEnabled || common.TurnstileSecretKey == "" || common.TurnstileSiteKey == "" {
				return ErrVerificationUnavailable
			}
			if len(verificationPassed) == 0 || !verificationPassed[0] {
				return ErrVerificationRequired
			}
		}
		account, err := readAccount(tx, userID)
		if err != nil {
			return err
		}
		eligibility, _, err := accountEligibility(tx, userID, settings, now, account, true)
		if err != nil {
			return err
		}
		if !eligibility.Eligible {
			switch eligibility.Reason {
			case ErrInactive.Key:
				return ErrInactive
			case ErrPaused.Key:
				return ErrPaused
			case ErrRechargeRequired.Key:
				return ErrRechargeRequired
			case ErrEligibilityExpired.Key:
				return ErrEligibilityExpired
			case ErrRiskReview.Key:
				return ErrRiskReview
			default:
				return ErrUnavailable
			}
		}
		checked, err := CheckinToday(tx, userID, settings, now)
		if err != nil {
			return err
		}
		if checked {
			return ErrAlreadyChecked
		}
		location, err := time.LoadLocation(settings.Timezone)
		if err != nil {
			return ErrInvalid
		}
		local := now.In(location)
		stats, _, err := ReadHistory(tx, userID, local.Format("2006-01"))
		if err != nil {
			return err
		}
		// Lock the wallet after settings, qualification, and registration review.
		// No callback or check-in transaction acquires these locks in reverse.
		query := tx
		if tx.Dialector.Name() != "sqlite" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		var user HostUser
		if err := query.Select("id", "status", "quota").Where("id = ?", userID).Take(&user).Error; errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrInactive
		} else if err != nil {
			return err
		}
		if user.Status != common.UserStatusEnabled {
			return ErrInactive
		}
		minimum, maximum, err := rewardRange(tx, userID, settings, now, stats, user.Quota)
		if err != nil {
			return err
		}
		quota := minimum
		if maximum > minimum {
			draw, err := rand.Int(rand.Reader, big.NewInt(int64(maximum-minimum+1)))
			if err != nil {
				return err
			}
			quota += int(draw.Int64())
		}
		checkin = Checkin{UserID: userID, CheckinDate: local.Format("2006-01-02"), QuotaAwarded: quota, CreatedAt: now.Unix()}
		if err := tx.Create(&checkin).Error; err != nil {
			return err
		}
		credit := tx.Model(&HostUser{}).Where("id = ? AND status = ? AND quota <= ?", userID, common.UserStatusEnabled, common.MaxWalletQuota-quota).
			UpdateColumn("quota", gorm.Expr("quota + ?", quota))
		if credit.Error != nil {
			return credit.Error
		}
		if credit.RowsAffected != 1 {
			return ErrWalletLimit
		}
		start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location)
		account.LastClaimAt, account.NextResetAt = now.Unix(), start.AddDate(0, 0, 1).Unix()
		if err := tx.Save(&account).Error; err != nil {
			return err
		}
		detail, err := common.Marshal(map[string]any{
			"checkin_id": checkin.ID, "checkin_date": checkin.CheckinDate, "quota_awarded": quota,
			"reward_mode": settings.RewardMode, "reward_min_quota": settings.RewardMinQuota,
			"reward_max_quota": settings.RewardMaxQuota, "timezone": settings.Timezone,
			"next_reset_at": account.NextResetAt,
		})
		if err != nil {
			return err
		}
		return tx.Create(&Audit{ActorID: userID, UserID: userID, Action: "claim", Detail: string(detail), CreatedAt: now.Unix(), SettingsVersion: settings.Version}).Error
	})
	if err != nil {
		return nil, err
	}
	return &checkin, nil
}
