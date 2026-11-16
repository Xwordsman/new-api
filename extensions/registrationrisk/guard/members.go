package guard

import (
	"errors"
	"math"
	"net/netip"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Member profiles are private administrative metadata, separate from risk events
// and promotional-credit eligibility. No authentication material belongs here.
type MemberProfile struct {
	UserID             int    `gorm:"primaryKey;autoIncrement:false" json:"user_id"`
	RegistrationIP     string `gorm:"size:64" json:"registration_ip"`
	RegistrationAgent  string `gorm:"type:text" json:"registration_agent"`
	RegistrationSource string `gorm:"size:50" json:"registration_source"`
	RegisteredAt       int64  `json:"registered_at"`
	LastLoginIP        string `gorm:"size:64" json:"last_login_ip"`
	LastLoginAgent     string `gorm:"type:text" json:"last_login_agent"`
	LastLoginMethod    string `gorm:"size:50" json:"last_login_method"`
	LastSeenAt         int64  `json:"last_seen_at"`
	Note               string `gorm:"type:text" json:"note"`
	ReviewState        string `gorm:"size:16" json:"review_state"`
	ReviewedAt         int64  `json:"reviewed_at"`
	ReviewerID         int    `json:"reviewer_id"`
	Version            int64  `json:"version"`
}

func (MemberProfile) TableName() string { return "extension_registration_members" }

type MemberSignal struct {
	Code       string `json:"code"`
	Count      int    `json:"count"`
	Threshold  int    `json:"threshold"`
	RelatedIDs []int  `json:"related_ids"`
}

type MemberFinding struct {
	TaskID      string         `gorm:"primaryKey;size:64" json:"-"`
	UserID      int            `gorm:"primaryKey;autoIncrement:false" json:"user_id"`
	Signals     []MemberSignal `gorm:"serializer:json;type:text" json:"signals"`
	SignalCount int            `json:"signal_count"`
	Coverage    string         `gorm:"size:16" json:"coverage"`
}

func (MemberFinding) TableName() string { return "extension_registration_member_findings" }

type MemberPolicy struct {
	Revision       int64 `json:"revision"`
	CaptureEnabled bool  `json:"capture_enabled"`
	RetentionDays  int   `json:"retention_days"`
	LookbackDays   int   `json:"lookback_days"`
	DeviceLimit    int   `json:"device_limit"`
	SignupIPLimit  int   `json:"signup_ip_limit"`
	LoginIPLimit   int   `json:"login_ip_limit"`
	NetworkLimit   int   `json:"network_limit"`
	InviterLimit   int   `json:"inviter_limit"`
	PayerLimit     int   `json:"payer_limit"`
}

const memberPolicyKey = "RegistrationRiskMemberPolicy"

func DefaultMemberPolicy() MemberPolicy {
	return MemberPolicy{CaptureEnabled: true, RetentionDays: 180, LookbackDays: 30,
		DeviceLimit: 2, SignupIPLimit: 3, LoginIPLimit: 5, NetworkLimit: 10, InviterLimit: 20, PayerLimit: 2}
}

func GetMemberPolicy(db *gorm.DB) (MemberPolicy, error) {
	p := DefaultMemberPolicy()
	var row option
	err := db.Where(clause.Eq{Column: "key", Value: memberPolicyKey}).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return p, nil
	}
	if err == nil {
		err = common.UnmarshalJsonStr(row.Value, &p)
	}
	return p, err
}

func SaveMemberPolicy(db *gorm.DB, p MemberPolicy, actorID int, now time.Time) error {
	if p.Revision < 0 || p.Revision == math.MaxInt64 || p.RetentionDays < 1 || p.RetentionDays > 3650 || p.LookbackDays < 1 || p.LookbackDays > 3650 {
		return ErrInvalid
	}
	for _, limit := range []int{p.DeviceLimit, p.SignupIPLimit, p.LoginIPLimit, p.NetworkLimit, p.InviterLimit, p.PayerLimit} {
		// Zero disables a signal. A single account can never form a cluster.
		if limit != 0 && (limit < 2 || limit > 100000) {
			return ErrInvalid
		}
	}
	return db.Transaction(func(tx *gorm.DB) error {
		initial, err := common.Marshal(DefaultMemberPolicy())
		if err != nil {
			return err
		}
		if err = tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&option{Key: memberPolicyKey, Value: string(initial)}).Error; err != nil {
			return err
		}
		var current option
		if err = tx.Where(clause.Eq{Column: "key", Value: memberPolicyKey}).Take(&current).Error; err != nil {
			return err
		}
		var old MemberPolicy
		if err = common.UnmarshalJsonStr(current.Value, &old); err != nil {
			return err
		}
		if old.Revision != p.Revision {
			return ErrConflict
		}
		p.Revision++
		encoded, err := common.Marshal(p)
		if err != nil {
			return err
		}
		result := tx.Model(&option{}).Where(clause.Eq{Column: "key", Value: memberPolicyKey}).Where("value = ?", current.Value).Update("value", string(encoded))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrConflict
		}
		return tx.Create(&Audit{CreatedAt: now.Unix(), ActorID: actorID, Action: "member-policy", Reason: "Member analysis policy updated"}).Error
	})
}

func memberClientMetadata(ip, agent string) (string, string) {
	address, err := netip.ParseAddr(ip)
	ip = ""
	if err == nil {
		ip = address.Unmap().String()
	}
	agent = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, agent)
	if len(agent) > 1024 {
		agent = agent[:1024]
	}
	return ip, strings.ToValidUTF8(agent, "")
}

// RecordMemberLogin is called only after the complete authentication flow has
// created a session, never after an initial authentication challenge or refresh.
func RecordMemberLogin(db *gorm.DB, userID int, ip, agent, method string, now time.Time) error {
	p, err := GetMemberPolicy(db)
	if err != nil || !p.CaptureEnabled {
		return err
	}
	ip, agent = memberClientMetadata(ip, agent)
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&MemberProfile{UserID: userID}).Error; err != nil {
			return err
		}
		return tx.Model(&MemberProfile{}).Where("user_id = ? AND last_seen_at <= ?", userID, now.Unix()).Updates(map[string]any{
			"last_login_ip": ip, "last_login_agent": agent, "last_login_method": method, "last_seen_at": now.Unix(),
		}).Error
	})
}

func ReviewMember(db *gorm.DB, userID, actorID int, version int64, state, note string, now time.Time) error {
	note = strings.TrimSpace(note)
	if userID <= 0 || version < 0 || version == math.MaxInt64 || !slices.Contains([]string{"unreviewed", "watch", "cleared"}, state) || !utf8.ValidString(note) || utf8.RuneCountInString(note) > 500 || (state != "unreviewed" && note == "") {
		return ErrInvalid
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Table("users").Where("id = ? AND deleted_at IS NULL", userID).Count(&count).Error; err != nil {
			return err
		}
		if count != 1 {
			return ErrInvalid
		}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&MemberProfile{UserID: userID}).Error; err != nil {
			return err
		}
		result := tx.Model(&MemberProfile{}).Where("user_id = ? AND version = ?", userID, version).Updates(map[string]any{
			"note": note, "review_state": state, "reviewed_at": now.Unix(), "reviewer_id": actorID, "version": version + 1,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrConflict
		}
		return tx.Create(&Audit{CreatedAt: now.Unix(), ActorID: actorID, UserID: userID, Action: "member-" + state, Reason: note}).Error
	})
}

func PurgeMemberMetadata(db *gorm.DB, now time.Time) error {
	p, err := GetMemberPolicy(db)
	if err != nil {
		return err
	}
	cutoff := now.Unix() - int64(p.RetentionDays)*86400
	if err = db.Model(&MemberProfile{}).Where("registered_at > 0 AND registered_at < ?", cutoff).Updates(map[string]any{"registration_ip": "", "registration_agent": ""}).Error; err != nil {
		return err
	}
	return db.Model(&MemberProfile{}).Where("last_seen_at > 0 AND last_seen_at < ?", cutoff).Updates(map[string]any{"last_login_ip": "", "last_login_agent": ""}).Error
}
