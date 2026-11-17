package registrationrisk

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/extensions/referral/ledger"
	"github.com/QuantumNous/new-api/extensions/registrationrisk/guard"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type memberRow struct {
	ID                  int    `json:"id"`
	Username            string `json:"username"`
	DisplayName         string `json:"display_name"`
	Email               string `json:"email"`
	Role                int    `json:"role"`
	Status              int    `json:"status"`
	CreatedAt           int64  `json:"created_at"`
	LastLoginAt         int64  `json:"last_login_at"`
	InviterID           int    `json:"inviter_id"`
	Remark              string `json:"remark"`
	Qualification       string `json:"qualification"`
	DeviceHash          string `json:"-"`
	NetworkHash         string `json:"-"`
	AccountCreated      int64  `json:"-"`
	guard.MemberProfile `gorm:"embedded"`
}

// Start from users, so historical and administrator-created accounts are shown
// without inventing missing registration metadata. Never select a full User.
func memberQuery(db *gorm.DB) *gorm.DB {
	return db.Table("users AS u").
		Joins("LEFT JOIN extension_registration_members AS p ON p.user_id = u.id").
		Joins("LEFT JOIN extension_registration_accounts AS a ON a.user_id = u.id").
		Where("u.deleted_at IS NULL")
}

const memberColumns = "u.id, u.username, u.display_name, u.email, u.role, u.status, u.created_at, u.last_login_at, u.inviter_id, u.remark, a.state AS qualification, a.device_hash, a.network_hash, a.created_at AS account_created, p.*"

func members(c *gin.Context) {
	page, _ := strconv.Atoi(c.Query("page"))
	page = max(1, min(page, 100000))
	q := memberQuery(model.DB.WithContext(c.Request.Context()))
	if value := c.Query("user_id"); value != "" {
		id, err := strconv.Atoi(value)
		if err != nil || id <= 0 {
			respond(c, nil, guard.ErrInvalid)
			return
		}
		q = q.Where("u.id = ?", id)
	}
	search := strings.TrimSpace(c.Query("search"))
	if len(search) > 254 {
		respond(c, nil, guard.ErrInvalid)
		return
	}
	if search != "" {
		// Exact IPs and IDs; usernames/emails use literal substring matching.
		id, _ := strconv.Atoi(search)
		literal := strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(search)
		q = q.Where("(u.id = ? OR u.username LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!' OR p.registration_ip = ? OR p.last_login_ip = ?)", id, "%"+literal+"%", "%"+literal+"%", search, search)
	}
	if state := c.Query("review_state"); state != "" {
		if state != "watch" && state != "cleared" && state != "unreviewed" {
			respond(c, nil, guard.ErrInvalid)
			return
		}
		if state == "unreviewed" {
			q = q.Where("(p.review_state IS NULL OR p.review_state = '' OR p.review_state = ?)", state)
		} else {
			q = q.Where("p.review_state = ?", state)
		}
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		respond(c, nil, err)
		return
	}
	items := []memberRow{}
	err := q.Select(memberColumns).Order("u.id DESC").Offset((page - 1) * 20).Limit(20).Scan(&items).Error
	respond(c, gin.H{"items": items, "total": total, "page": page}, err)
}

func memberReview(c *gin.Context) {
	var body struct {
		UserID  int    `json:"user_id"`
		Version int64  `json:"version"`
		State   string `json:"state"`
		Note    string `json:"note"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8192)
	if common.DecodeJson(c.Request.Body, &body) != nil {
		respond(c, nil, guard.ErrInvalid)
		return
	}
	err := guard.ReviewMember(model.DB.WithContext(c.Request.Context()), body.UserID, c.GetInt("id"), body.Version, body.State, body.Note, time.Now())
	respond(c, nil, err)
}

func memberPolicy(c *gin.Context) {
	p, err := guard.GetMemberPolicy(model.DB.WithContext(c.Request.Context()))
	respond(c, p, err)
}

func putMemberPolicy(c *gin.Context) {
	var p guard.MemberPolicy
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	if common.DecodeJson(c.Request.Body, &p) != nil {
		respond(c, nil, guard.ErrInvalid)
		return
	}
	err := guard.SaveMemberPolicy(model.DB.WithContext(c.Request.Context()), p, c.GetInt("id"), time.Now())
	if err == nil {
		p.Revision++
	}
	respond(c, p, err)
}

const memberTaskType = "extension-registration-member-analysis"

type memberAnalysisPayload struct {
	ActorID int                `json:"actor_id"`
	Policy  guard.MemberPolicy `json:"policy"`
}
type memberAnalysisSummary struct {
	Total        int                `json:"total"`
	Flagged      int                `json:"flagged"`
	Insufficient int                `json:"insufficient"`
	Review       int                `json:"review"`
	Priority     int                `json:"priority"`
	CompletedAt  int64              `json:"completed_at"`
	Policy       guard.MemberPolicy `json:"policy"`
}
type memberAnalysisHandler struct{}

func (memberAnalysisHandler) Type() string { return memberTaskType }
func (memberAnalysisHandler) Enabled() bool {
	p, err := guard.GetMemberPolicy(model.DB)
	if err != nil {
		common.SysError("member analysis policy: " + err.Error())
	}
	return err == nil && p.AutoAnalysis
}
func (memberAnalysisHandler) Interval() time.Duration {
	p, err := guard.GetMemberPolicy(model.DB)
	if err != nil {
		return time.Hour
	}
	return time.Duration(max(5, p.AnalysisMinutes)) * time.Minute
}
func (memberAnalysisHandler) NewPayload() any { return memberAnalysisPayload{} }
func (memberAnalysisHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	var payload memberAnalysisPayload
	err := task.DecodePayload(&payload)
	// Scheduled tasks snapshot the current policy when the worker starts.
	if err == nil && payload.Policy.AnalysisMinutes == 0 {
		payload.Policy, err = guard.GetMemberPolicy(model.DB.WithContext(ctx))
	}
	var summary memberAnalysisSummary
	if err == nil {
		summary, err = analyzeMembers(model.DB.WithContext(ctx), task.TaskID, payload, time.Now())
	}
	status, message := model.SystemTaskStatusSucceeded, ""
	if err != nil {
		status, message = model.SystemTaskStatusFailed, "Member analysis failed. Previous results are retained."
		common.SysError("registration member analysis failed: " + err.Error())
	}
	if err := model.FinishSystemTask(task.TaskID, runnerID, status, summary, message); err != nil {
		common.SysError("registration member analysis finish failed: " + err.Error())
		return
	}
	if status == model.SystemTaskStatusSucceeded {
		// Prune only older completed runs, after publishing the new snapshot.
		// A concurrently started run and the last visible snapshot stay intact.
		old := model.DB.Model(&model.SystemTask{}).Select("task_id").Where("type = ? AND id < ? AND status IN ?", memberTaskType, task.ID, []model.SystemTaskStatus{model.SystemTaskStatusSucceeded, model.SystemTaskStatusFailed})
		if err := model.DB.Where("task_id IN (?)", old).Delete(&guard.MemberFinding{}).Error; err != nil {
			common.SysError("registration member findings retention failed: " + err.Error())
		}
	}
}

func startMemberAnalysis(c *gin.Context) {
	p, err := guard.GetMemberPolicy(model.DB.WithContext(c.Request.Context()))
	if err != nil {
		respond(c, nil, err)
		return
	}
	task, _, err := service.EnqueueSystemTask(memberTaskType, memberAnalysisPayload{ActorID: c.GetInt("id"), Policy: p})
	if err != nil {
		respond(c, nil, err)
		return
	}
	respond(c, gin.H{"status": task.Status}, nil)
}

func memberAnalysis(c *gin.Context) {
	db := model.DB.WithContext(c.Request.Context())
	latest, err := model.GetLatestSystemTask(memberTaskType)
	if err != nil {
		respond(c, nil, err)
		return
	}
	status := "idle"
	if latest != nil {
		status = string(latest.Status)
	}
	var completed model.SystemTask
	err = db.Where("type = ? AND status = ?", memberTaskType, model.SystemTaskStatusSucceeded).Order("id DESC").Take(&completed).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		respond(c, gin.H{"status": status, "summary": nil, "items": []any{}, "groups": []any{}, "total": 0}, nil)
		return
	}
	if err != nil {
		respond(c, nil, err)
		return
	}
	var summary memberAnalysisSummary
	if err = common.UnmarshalJsonStr(completed.Result, &summary); err != nil {
		respond(c, nil, err)
		return
	}
	page, _ := strconv.Atoi(c.Query("page"))
	page = max(1, min(page, 100000))
	if c.Query("view") == "accounts" {
		pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
		pageSize = max(10, min(pageSize, 100))
		items, total, err := loadMemberAccounts(db, completed.TaskID, c.DefaultQuery("kind", "review"), c.Query("search"), page, pageSize)
		respond(c, gin.H{"status": status, "summary": summary, "items": items, "total": total, "page": page, "page_size": pageSize}, err)
		return
	}
	if c.Query("view") == "groups" {
		groups, total, err := loadMemberGroups(db, completed.TaskID, c.DefaultQuery("kind", "review"), page)
		respond(c, gin.H{"status": status, "summary": summary, "groups": groups, "total": total, "page": page}, err)
		return
	}
	q := db.Table("extension_registration_member_findings AS f").Joins("JOIN users AS u ON u.id = f.user_id AND u.deleted_at IS NULL").Joins("LEFT JOIN extension_registration_members AS p ON p.user_id = f.user_id").Where("f.task_id = ?", completed.TaskID)
	switch c.DefaultQuery("kind", "review") {
	case "flagged":
		q = q.Where("f.signal_count > 0")
	case "review":
		q = q.Where("f.priority >= ?", 2)
	case "insufficient":
		q = q.Where("f.coverage = ?", "unavailable")
	case "all":
	default:
		respond(c, nil, guard.ErrInvalid)
		return
	}
	var total int64
	if err = q.Count(&total).Error; err != nil {
		respond(c, nil, err)
		return
	}
	items := []struct {
		guard.MemberFinding `gorm:"embedded"`
		Username            string `json:"username"`
		Note                string `json:"note"`
		ReviewState         string `json:"review_state"`
		ReviewedAt          int64  `json:"reviewed_at"`
		Version             int64  `json:"version"`
	}{}
	err = q.Select("f.*, u.username, p.note, p.review_state, p.reviewed_at, p.version").Order("f.priority DESC, f.reward_paid DESC, f.reward_pending DESC, f.user_id DESC").Offset((page - 1) * 20).Limit(20).Scan(&items).Error
	respond(c, gin.H{"status": status, "summary": summary, "items": items, "total": total, "page": page}, err)
}

// Association evidence can hold referral rewards, but cannot approve rewards
// or ban an account. Missing historical metadata cannot establish safety.
func analyzeMembers(db *gorm.DB, taskID string, payload memberAnalysisPayload, now time.Time) (memberAnalysisSummary, error) {
	p := payload.Policy
	summary := memberAnalysisSummary{Policy: p, CompletedAt: now.Unix()}
	if err := guard.PurgeMemberMetadata(db, now); err != nil {
		return summary, err
	}
	rows := []memberRow{}
	if err := memberQuery(db).Select(memberColumns).Order("u.id").Limit(100001).Scan(&rows).Error; err != nil {
		return summary, err
	}
	// Bound memory and transaction size explicitly; never report a partial scan
	// of a larger site as a completed all-member scan.
	if len(rows) > 100000 {
		return summary, errors.New("member analysis exceeds the 100000-account safety limit")
	}
	summary.Total = len(rows)
	s, err := guard.GetSettings(db)
	if err != nil {
		return summary, err
	}
	since := now.Unix() - int64(p.LookbackDays)*86400
	groups := map[string]map[string][]int{}
	for _, code := range []string{"device", "signup-ip", "login-ip", "network", "inviter", "payer"} {
		groups[code] = map[string][]int{}
	}
	keys := map[int]map[string][]string{}
	for _, row := range rows {
		values := map[string][]string{}
		if row.AccountCreated >= since {
			if row.DeviceHash != "" {
				values["device"] = []string{row.DeviceHash}
			}
			if row.NetworkHash != "" {
				values["network"] = []string{row.NetworkHash}
			}
		}
		if row.RegisteredAt >= since && row.RegistrationIP != "" {
			values["signup-ip"] = []string{row.RegistrationIP}
		}
		if row.LastSeenAt >= since && row.LastLoginIP != "" {
			values["login-ip"] = []string{row.LastLoginIP}
		}
		if row.CreatedAt >= since && row.InviterID > 0 {
			values["inviter"] = []string{strconv.Itoa(row.InviterID)}
		}
		keys[row.ID] = values
		for code, signals := range values {
			for _, value := range signals {
				groups[code][value] = append(groups[code][value], row.ID)
			}
		}
	}
	// Payer identities come only from trusted payment callbacks; never from
	// request-supplied payment details. They are lifetime associations.
	var payers []guard.Payer
	if err = db.Table("extension_registration_payers AS pay").Select("pay.*").Joins("JOIN users AS u ON u.id = pay.user_id AND u.deleted_at IS NULL").Order("pay.user_id, pay.digest").Limit(1000001).Scan(&payers).Error; err != nil {
		return summary, err
	}
	if len(payers) > 1000000 {
		return summary, errors.New("member payer analysis exceeds safety limit")
	}
	for _, payer := range payers {
		if payer.Digest == "" || keys[payer.UserID] == nil {
			continue
		}
		groups["payer"][payer.Digest] = append(groups["payer"][payer.Digest], payer.UserID)
		keys[payer.UserID]["payer"] = append(keys[payer.UserID]["payer"], payer.Digest)
	}
	limits := map[string]int{"device": p.DeviceLimit, "signup-ip": p.SignupIPLimit, "login-ip": p.LoginIPLimit, "network": p.NetworkLimit, "inviter": p.InviterLimit, "payer": p.PayerLimit}
	// Amounts are fixed invitation bonuses involving this member as inviter or
	// invitee, not wallet balances or verified recharge totals. Do not sum rows
	// into a site loss: a binding appears on both participants' rows.
	var bindings []ledger.Binding
	if err := db.Limit(1000001).Find(&bindings).Error; err != nil {
		return summary, err
	}
	if len(bindings) > 1000000 {
		return summary, errors.New("member invitation analysis exceeds safety limit")
	}
	referralPolicy, err := ledger.GetSettings(db)
	if err != nil {
		return summary, err
	}
	bursts := memberInvitationBursts(rows, bindings, referralPolicy, since)
	paid, pending := map[int]int64{}, map[int]int64{}
	for _, binding := range bindings {
		for _, id := range []int{binding.UserID, binding.InviterID} {
			if binding.SignupBonusPaidAt > 0 {
				paid[id] += int64(binding.SignupBonusQuota)
			} else if binding.State == "active" || binding.State == "review" {
				pending[id] += int64(binding.SignupBonusQuota)
			}
		}
	}
	findings := make([]guard.MemberFinding, 0, len(rows))
	for _, row := range rows {
		if err := db.Statement.Context.Err(); err != nil {
			return summary, err
		}
		finding := guard.MemberFinding{TaskID: taskID, UserID: row.ID, Signals: []guard.MemberSignal{}, Coverage: "unavailable"}
		finding.RewardPaid, finding.RewardPending = paid[row.ID], pending[row.ID]
		if row.RegistrationIP != "" || row.LastLoginIP != "" || len(keys[row.ID]) > 0 {
			finding.Coverage = "partial"
		}
		for _, code := range []string{"device", "signup-ip", "login-ip", "network", "inviter", "payer"} {
			if limits[code] == 0 {
				continue
			}
			var largest []int
			for _, key := range keys[row.ID][code] {
				if peers := groups[code][key]; len(peers) > len(largest) {
					largest = peers
				}
			}
			if len(largest) < limits[code] {
				continue
			}
			peers := make([]int, 0, min(10, len(largest)-1))
			for _, id := range largest {
				if id != row.ID && len(peers) < 10 {
					peers = append(peers, id)
				}
			}
			finding.Signals = append(finding.Signals, guard.MemberSignal{Code: code, Count: len(largest), Threshold: limits[code], RelatedIDs: peers})
		}
		_, domain, _ := strings.Cut(strings.ToLower(row.Email), "@")
		if guard.RestrictedDomain(strings.TrimSuffix(domain, "."), s) {
			finding.Signals = append(finding.Signals, guard.MemberSignal{Code: "domain", Count: 1, RelatedIDs: []int{}})
		}
		if burst, ok := bursts[row.ID]; ok {
			finding.Signals = append(finding.Signals, burst)
		}
		finding.SignalCount = len(finding.Signals)
		finding.Recommendation = "no-signal"
		for _, signal := range finding.Signals {
			finding.Priority = max(finding.Priority, 1)
			// IPs, subnets and a common inviter remain a single weak evidence
			// class even when all three appear. User-agent strings are not IDs.
			if signal.Code == "device" || signal.Code == "payer" || signal.Code == "domain" || signal.Code == "invite-burst" {
				finding.Priority = max(finding.Priority, 2)
			}
		}
		if finding.Priority == 1 {
			finding.Recommendation = "network-clue"
		}
		if finding.Priority >= 2 {
			finding.Recommendation = "review-evidence"
			summary.Review++
			if finding.RewardPaid > 0 || finding.RewardPending > 0 {
				finding.Priority, finding.Recommendation = 3, "review-rewards"
				summary.Priority++
			}
		}
		if finding.SignalCount > 0 {
			summary.Flagged++
		}
		if finding.Coverage == "unavailable" {
			summary.Insufficient++
		}
		findings = append(findings, finding)
	}
	// Only concrete associations hold rewards. A shared network, a common
	// inviter or an old qualification decision must not amplify itself.
	associated := []int{}
	for _, finding := range findings {
		for _, signal := range finding.Signals {
			if signal.Code == "device" || signal.Code == "payer" || signal.Code == "invite-burst" {
				associated = append(associated, finding.UserID)
				break
			}
		}
	}
	if err := ledger.HoldMemberRewards(db, associated, payload.ActorID, now.Unix()); err != nil {
		return summary, err
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		// A worker may resume the same task after a lease expires.
		if err := tx.Where("task_id = ?", taskID).Delete(&guard.MemberFinding{}).Error; err != nil {
			return err
		}
		if len(findings) > 0 {
			if err := tx.CreateInBatches(&findings, 100).Error; err != nil {
				return err
			}
		}
		if s.AlertEnabled && p.AlertPriority > 0 {
			count := 0
			for _, finding := range findings {
				if finding.Priority >= p.AlertPriority {
					count++
				}
			}
			if count > 0 {
				bucket := now.Unix() / int64(s.AlertDedupMinutes*60)
				n, err := guard.Increment(tx, "alert:member-analysis:"+strconv.FormatInt(bucket, 10), now.Unix()+int64(s.AlertDedupMinutes*60), 1)
				if err != nil {
					return err
				}
				if n == 1 {
					message := common.NewMessage("Member analysis found {{count}} accounts requiring review", map[string]any{"count": count})
					if err := tx.Create(&guard.Alert{Kind: "member-analysis", CreatedAt: now.Unix(), Summary: message.Error(), SummaryKey: message.Key, SummaryParams: message.Params, NextAttemptAt: now.Unix()}).Error; err != nil {
						return err
					}
				}
			}
		}
		return tx.Create(&guard.Audit{ActorID: payload.ActorID, CreatedAt: now.Unix(), Action: "member-analysis", Reason: "Completed all-member association analysis"}).Error
	})
	return summary, err
}

// Each cluster has one inviter, one exact signup IP, and a bounded time span.
// Include the inviter so administrators can investigate the reward recipient.
// These are review clues; shared offices may legitimately satisfy the rule.
func memberInvitationBursts(rows []memberRow, bindings []ledger.Binding, policy ledger.Settings, since int64) map[int]guard.MemberSignal {
	result := map[int]guard.MemberSignal{}
	if policy.InviteBurstLimit < 2 {
		return result
	}
	profiles := make(map[int]memberRow, len(rows))
	for _, row := range rows {
		profiles[row.ID] = row
	}
	groups := map[string][]ledger.Binding{}
	for _, binding := range bindings {
		row, ok := profiles[binding.UserID]
		if !ok || row.RegistrationIP == "" || binding.RegisteredAt <= 0 || binding.RegisteredAt < since {
			continue
		}
		key := strconv.Itoa(binding.InviterID) + "|" + row.RegistrationIP
		groups[key] = append(groups[key], binding)
	}
	window := int64(policy.InviteBurstMinutes) * 60
	for _, group := range groups {
		slices.SortFunc(group, func(a, b ledger.Binding) int {
			if a.RegisteredAt < b.RegisteredAt {
				return -1
			}
			if a.RegisteredAt > b.RegisteredAt {
				return 1
			}
			return a.UserID - b.UserID
		})
		start, nextMember := 0, 0
		for end := range group {
			for group[end].RegisteredAt-group[start].RegisteredAt > window {
				start++
			}
			if end-start+1 < policy.InviteBurstLimit {
				continue
			}
			if end+1 < len(group) && group[end+1].RegisteredAt-group[start].RegisteredAt <= window {
				continue
			}
			// Visit each invitee once. Large shared networks must not turn an
			// overlapping-window scan into a quadratic amount of work.
			nextMember = max(nextMember, start)
			ids := []int{group[end].InviterID}
			for nextMember <= end {
				ids = append(ids, group[nextMember].UserID)
				nextMember++
			}
			for _, id := range ids {
				if _, ok := profiles[id]; !ok || result[id].Count >= end-start+1 {
					continue
				}
				peers := make([]int, 0, 10)
				if id != group[end].InviterID {
					peers = append(peers, group[end].InviterID)
				}
				for _, binding := range group[start : end+1] {
					if len(peers) == 10 {
						break
					}
					if binding.UserID != id {
						peers = append(peers, binding.UserID)
					}
				}
				result[id] = guard.MemberSignal{Code: "invite-burst", Count: end - start + 1, Threshold: policy.InviteBurstLimit, RelatedIDs: peers}
			}
		}
	}
	return result
}
