package referral

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/extensions/referral/ledger"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func respond(c *gin.Context, data any, err error) {
	if err == nil {
		common.ApiSuccess(c, data)
		return
	}
	if errors.Is(err, ledger.ErrInvalid) || errors.Is(err, ledger.ErrUnavailable) || errors.Is(err, ledger.ErrReview) {
		common.ApiError(c, err)
		return
	}
	var message *common.Message
	if errors.As(err, &message) {
		common.ApiError(c, message)
		return
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		common.ApiError(c, ledger.ErrUnavailable)
		return
	}
	common.SysError("referral: " + err.Error())
	common.ApiErrorT(c, "Database error, please contact the administrator")
}

func dashboard(c *gin.Context) {
	userID := c.GetInt("id")
	err := model.DB.Transaction(func(tx *gorm.DB) error { return ledger.ImportHistory(tx, userID) })
	if err != nil {
		respond(c, nil, err)
		return
	}
	rules, err := ledger.GetSettings(model.DB)
	if err != nil {
		respond(c, nil, err)
		return
	}
	var account ledger.Account
	if err = model.DB.First(&account, "user_id = ?", userID).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		account = ledger.Account{UserID: userID}
		err = nil
	}
	if err != nil {
		respond(c, nil, err)
		return
	}
	var counts struct{ Invited, Paying int64 }
	if err = model.DB.Model(&ledger.Binding{}).Where("inviter_id = ?", userID).Count(&counts.Invited).Error; err != nil {
		respond(c, nil, err)
		return
	}
	if err = model.DB.Model(&ledger.Reward{}).Where("inviter_id = ? AND paid_quota > refunded_quota", userID).Distinct("user_id").Count(&counts.Paying).Error; err != nil {
		respond(c, nil, err)
		return
	}
	var pending struct{ Pending, Review, Claimable int }
	now := time.Now().Unix()
	err = model.DB.Model(&ledger.Reward{}).Joins("JOIN extension_referral_bindings b ON b.user_id = extension_referral_rewards.user_id").
		Select("COALESCE(SUM(quota - reversed), 0) AS pending, COALESCE(SUM(CASE WHEN b.state <> 'active' THEN quota - reversed ELSE 0 END), 0) AS review, COALESCE(SUM(CASE WHEN b.state = 'active' AND available_at <= ? THEN quota - reversed ELSE 0 END), 0) AS claimable", now).
		Where("extension_referral_rewards.inviter_id = ? AND extension_referral_rewards.state = ?", userID, "pending").Scan(&pending).Error
	if err != nil {
		respond(c, nil, err)
		return
	}
	var user struct{ AffCode string }
	err = model.DB.Model(&model.User{}).Select("aff_code").Where("id = ?", userID).Take(&user).Error
	respond(c, gin.H{"settings": rules, "account": account, "invited": counts.Invited, "paying": counts.Paying, "pending": pending.Pending, "review": pending.Review, "claimable": pending.Claimable, "code": user.AffCode, "server_time": now}, err)
}

type inviteeRow struct {
	ledger.Binding
	Username string `json:"username"`
	NetPaid  int    `json:"net_paid"`
	Earned   int    `json:"earned"`
	Pending  int    `json:"pending"`
}

func invitees(c *gin.Context) { listInvitees(c, false) }
func reviews(c *gin.Context)  { listInvitees(c, true) }

func referralPage(c *gin.Context) *common.PageInfo {
	page := common.GetPageQuery(c)
	page.PageSize = min(max(page.PageSize, 1), 50)
	page.Page = min(max(page.Page, 1), int(^uint(0)>>1)/page.PageSize)
	return page
}

func listInvitees(c *gin.Context, admin bool) {
	page := referralPage(c)
	query := model.DB.Model(&ledger.Binding{})
	if !admin {
		query = query.Where("inviter_id = ?", c.GetInt("id"))
	}
	now := time.Now().Unix()
	switch c.Query("state") {
	case "active":
		query = query.Where("state = ? AND expires_at > ? AND reserved < cap_quota", "active", now)
	case "expired":
		query = query.Where("expires_at <= ?", now)
	case "capped":
		query = query.Where("reserved >= cap_quota")
	case "review", "historical", "ineligible":
		query = query.Where("state = ?", c.Query("state"))
	}
	if userID, _ := strconv.Atoi(c.Query("user_id")); userID > 0 {
		query = query.Where("user_id = ?", userID)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		respond(c, nil, err)
		return
	}
	var bindings []ledger.Binding
	if err := query.Order("id DESC").Limit(page.PageSize).Offset(page.GetStartIdx()).Find(&bindings).Error; err != nil {
		respond(c, nil, err)
		return
	}
	rows := make([]inviteeRow, 0, len(bindings))
	ids := make([]int, 0, len(bindings))
	for _, b := range bindings {
		ids = append(ids, b.UserID)
	}
	if len(ids) > 0 {
		var users []ledger.HostUser
		if err := model.DB.Unscoped().Select("id", "username").Where("id IN ?", ids).Find(&users).Error; err != nil {
			respond(c, nil, err)
			return
		}
		names := make(map[int]string, len(users))
		for _, user := range users {
			name := []rune(user.Username)
			if len(name) > 2 {
				names[user.ID] = string(name[:2]) + "***"
			} else {
				names[user.ID] = "***"
			}
		}
		var totals []struct{ UserID, NetPaid, Earned, Pending int }
		if err := model.DB.Model(&ledger.Reward{}).Select("user_id, COALESCE(SUM(paid_quota - refunded_quota), 0) AS net_paid, COALESCE(SUM(CASE WHEN state = 'claimed' THEN quota - reversed ELSE 0 END), 0) AS earned, COALESCE(SUM(CASE WHEN state = 'pending' THEN quota - reversed ELSE 0 END), 0) AS pending").Where("user_id IN ?", ids).Group("user_id").Scan(&totals).Error; err != nil {
			respond(c, nil, err)
			return
		}
		byUser := make(map[int]int, len(totals))
		for i, total := range totals {
			byUser[total.UserID] = i
		}
		for _, b := range bindings {
			row := inviteeRow{Binding: b, Username: names[b.UserID]}
			if i, ok := byUser[b.UserID]; ok {
				row.NetPaid, row.Earned, row.Pending = totals[i].NetPaid, totals[i].Earned, totals[i].Pending
			}
			rows = append(rows, row)
		}
	}
	respond(c, gin.H{"items": rows, "total": count}, nil)
}

func rewards(c *gin.Context) {
	query := model.DB.Model(&ledger.Reward{}).Where("extension_referral_rewards.inviter_id = ?", c.GetInt("id"))
	if c.Query("historical") == "true" {
		query = query.Where("extension_referral_rewards.historical = ? AND extension_referral_rewards.state = ?", true, "claimed")
	} else {
		query = query.Where("extension_referral_rewards.historical = ? OR extension_referral_rewards.state <> ?", false, "claimed")
	}
	if userID, _ := strconv.Atoi(c.Query("user_id")); userID > 0 {
		query = query.Where("extension_referral_rewards.user_id = ?", userID)
	}
	page := referralPage(c)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		respond(c, nil, err)
		return
	}
	var rows []struct {
		ledger.Reward
		Qualification string `json:"qualification"`
	}
	err := query.Select("extension_referral_rewards.*, b.state AS qualification").Joins("JOIN extension_referral_bindings b ON b.user_id = extension_referral_rewards.user_id").Order("extension_referral_rewards.id DESC").Limit(page.PageSize).Offset(page.GetStartIdx()).Scan(&rows).Error
	respond(c, gin.H{"items": rows, "total": total}, err)
}

func transfers(c *gin.Context) {
	var rows []ledger.Transfer
	list(c, model.DB.Model(&ledger.Transfer{}).Where("user_id = ?", c.GetInt("id")), &rows)
}

func audits(c *gin.Context) {
	var rows []ledger.Audit
	list(c, model.DB.Model(&ledger.Audit{}), &rows)
}

func list(c *gin.Context, query *gorm.DB, rows any) {
	page := referralPage(c)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		respond(c, nil, err)
		return
	}
	err := query.Order("id DESC").Limit(page.PageSize).Offset(page.GetStartIdx()).Find(rows).Error
	respond(c, gin.H{"items": rows, "total": total}, err)
}

func claim(c *gin.Context) {
	var request struct {
		RewardID int `json:"reward_id"`
	}
	if common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 4096), &request) != nil || request.RewardID < 0 {
		respond(c, nil, ledger.ErrInvalid)
		return
	}
	count, err := ledger.Claim(model.DB, c.GetInt("id"), request.RewardID, time.Now().Unix())
	respond(c, gin.H{"claimed": count}, err)
}

func transfer(c *gin.Context) {
	var request struct {
		RequestID string `json:"request_id"`
		Quota     int    `json:"quota"`
	}
	if common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 4096), &request) != nil {
		respond(c, nil, ledger.ErrInvalid)
		return
	}
	value, replayed, err := ledger.TransferBalance(model.DB, c.GetInt("id"), request.RequestID, request.Quota, time.Now().Unix())
	if err == nil && !replayed {
		model.SyncReferralWalletCache(c.GetInt("id"), value.Quota)
	}
	respond(c, value, err)
}

func settings(c *gin.Context) { value, err := ledger.GetSettings(model.DB); respond(c, value, err) }
func updateSettings(c *gin.Context) {
	var request ledger.Settings
	if common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 4096), &request) != nil {
		respond(c, nil, ledger.ErrInvalid)
		return
	}
	respond(c, nil, ledger.UpdateSettings(model.DB, request, c.GetInt("id")))
}

func review(c *gin.Context) {
	var request struct {
		Approve bool   `json:"approve"`
		Reason  string `json:"reason"`
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 || common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 4096), &request) != nil {
		respond(c, nil, ledger.ErrInvalid)
		return
	}
	respond(c, nil, ledger.Review(model.DB, id, c.GetInt("id"), request.Approve, request.Reason))
}

func reconcile(c *gin.Context) {
	var request struct {
		TradeNo    string `json:"trade_no"`
		Amount     string `json:"amount"`
		Currency   string `json:"currency"`
		USDPerUnit string `json:"usd_per_unit"`
		Reason     string `json:"reason"`
	}
	if common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 4096), &request) != nil || len(strings.TrimSpace(request.Reason)) < 3 || len(request.Reason) > 500 {
		respond(c, nil, ledger.ErrInvalid)
		return
	}
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		var order model.TopUp
		if err := ledger.Lock(tx).First(&order, "trade_no = ? AND status = ?", request.TradeNo, common.TopUpStatusSuccess).Error; err != nil {
			return err
		}
		payment := ledger.Payment{Amount: request.Amount, Currency: request.Currency, USDPerUnit: request.USDPerUnit, Reference: order.TradeNo, PaidAt: order.CompleteTime}
		var previous ledger.Reward
		if err := tx.First(&previous, "trade_no = ?", order.TradeNo).Error; err == nil {
			if previous.State != "unpriced" {
				return ledger.ErrUnavailable
			}
			payment.Amount, payment.Currency, payment.Reference, payment.PaidAt = previous.Amount, previous.Currency, previous.Reference, previous.PaidAt
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err := ledger.RecordPayment(tx, order.UserId, order.TradeNo, order.PaymentProvider, payment); err != nil {
			return err
		}
		var reward ledger.Reward
		if err := tx.First(&reward, "trade_no = ?", order.TradeNo).Error; err != nil {
			return ledger.ErrUnavailable
		}
		if reward.State == "unpriced" {
			return ledger.ErrInvalid
		}
		return tx.Create(&ledger.Audit{ActorID: c.GetInt("id"), UserID: order.UserId, Action: "reconcile", Detail: common.GetJsonString(request), CreatedAt: time.Now().Unix()}).Error
	})
	respond(c, nil, err)
}

func refund(c *gin.Context) {
	var request struct {
		TradeNo string `json:"trade_no"`
		Amount  string `json:"amount"`
		Reason  string `json:"reason"`
	}
	if common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 4096), &request) != nil {
		respond(c, nil, ledger.ErrInvalid)
		return
	}
	request.Reason = strings.TrimSpace(request.Reason)
	reasonLength := utf8.RuneCountInString(request.Reason)
	if reasonLength < 3 || reasonLength > 500 || c.GetInt("id") <= 0 {
		respond(c, nil, ledger.ErrInvalid)
		return
	}
	var reward ledger.Reward
	if err := model.DB.First(&reward, "trade_no = ?", request.TradeNo).Error; err != nil {
		respond(c, nil, err)
		return
	}
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		// The shared entry point locks check-in settings before referral rows,
		// so an audited refund removes both eligibility and referral earnings.
		if err := model.RecordPaymentRefund(tx, reward.Provider, reward.Reference, request.Amount, reward.Currency); err != nil {
			return err
		}
		return ledger.AuditRefund(tx, request.TradeNo, request.Amount, request.Reason, c.GetInt("id"))
	})
	respond(c, nil, err)
}
