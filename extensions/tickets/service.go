package tickets

import (
	"errors"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
)

const (
	statusProcessing = "processing"
	statusWaiting    = "waiting_user"
	statusResolved   = "resolved"
	statusWithdrawn  = "withdrawn"
	messagePageSize  = 50
)

var (
	errInvalid  = errors.New("Invalid ticket information")
	errConflict = errors.New("This ticket has changed. Refresh and try again.")
	errClosed   = errors.New("Reopen this ticket before replying")
	errImage    = errors.New("Use up to 5 valid PNG, JPG or WebP images, each no larger than 2 MB")
)

type actor struct {
	ID       int
	Username string
	Staff    bool
}

type submission struct {
	Subject  string
	Category string
	Body     string
	Images   []Attachment
}

func (s *submission) validate(create bool) error {
	s.Subject = strings.TrimSpace(s.Subject)
	s.Body = strings.TrimSpace(s.Body)
	if !utf8.ValidString(s.Body) || utf8.RuneCountInString(s.Body) > 10000 || (s.Body == "" && len(s.Images) == 0) || len(s.Images) > 5 {
		return errInvalid
	}
	if create && (s.Body == "" || !utf8.ValidString(s.Subject) || utf8.RuneCountInString(s.Subject) < 2 || utf8.RuneCountInString(s.Subject) > 160 || !slices.Contains([]string{"quota", "platform", "interface", "api", "refund", "account", "other"}, s.Category)) {
		return errInvalid
	}
	return nil
}

func scope(db *gorm.DB, a actor) *gorm.DB {
	if !a.Staff {
		return db.Where("user_id = ?", a.ID)
	}
	return db
}

func unreadPredicate(a actor) string {
	if a.Staff {
		return "last_user_message_id > staff_read_id"
	}
	return "last_staff_message_id > user_read_id"
}

func (t *Ticket) setUnread(a actor) {
	if a.Staff {
		t.Unread = t.LastUserMessageID > t.StaffReadID
		return
	}
	t.Unread = t.LastStaffMessageID > t.UserReadID
}

type listOptions struct {
	Page, PageSize int
	Search, Status string
	Unread         bool
}

type ticketList struct {
	Items    []Ticket `json:"items"`
	Total    int64    `json:"total"`
	Page     int      `json:"page"`
	PageSize int      `json:"page_size"`
}

func list(db *gorm.DB, a actor, options listOptions) (ticketList, error) {
	result := ticketList{Items: []Ticket{}, Page: options.Page, PageSize: options.PageSize}
	query := scope(db.Model(&Ticket{}), a)
	if options.Search != "" {
		literal := strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(options.Search)
		query = query.Where("subject LIKE ? ESCAPE '!'", "%"+literal+"%")
	}
	if options.Status != "" {
		query = query.Where("status = ?", options.Status)
	}
	if options.Unread {
		query = query.Where(unreadPredicate(a))
	}
	if err := query.Count(&result.Total).Error; err != nil {
		return result, err
	}
	err := query.Order("updated_at DESC").Order("id DESC").Offset((options.Page - 1) * options.PageSize).Limit(options.PageSize).Find(&result.Items).Error
	for i := range result.Items {
		result.Items[i].setUnread(a)
	}
	return result, err
}

type conversation struct {
	Ticket   Ticket    `json:"ticket"`
	Messages []Message `json:"messages"`
	HasOlder bool      `json:"has_older"`
}

func detail(db *gorm.DB, a actor, id, before int64) (conversation, error) {
	result := conversation{Messages: []Message{}}
	if err := scope(db, a).Where("id = ?", id).Take(&result.Ticket).Error; err != nil {
		return result, err
	}
	result.Ticket.setUnread(a)
	query := db.Where("ticket_id = ?", id)
	if before > 0 {
		query = query.Where("id < ?", before)
	}
	if err := query.Order("id DESC").Limit(messagePageSize + 1).Find(&result.Messages).Error; err != nil {
		return result, err
	}
	if len(result.Messages) > messagePageSize {
		result.HasOlder = true
		result.Messages = result.Messages[:messagePageSize]
	}
	slices.Reverse(result.Messages)
	ids := make([]int64, 0, len(result.Messages))
	for i := range result.Messages {
		result.Messages[i].Attachments = []Attachment{}
		ids = append(ids, result.Messages[i].ID)
	}
	if len(ids) == 0 {
		return result, nil
	}
	var images []Attachment
	if err := db.Omit("data").Where("ticket_id = ? AND message_id IN ?", id, ids).Order("id").Find(&images).Error; err != nil {
		return result, err
	}
	for _, image := range images {
		for i := range result.Messages {
			if result.Messages[i].ID == image.MessageID {
				result.Messages[i].Attachments = append(result.Messages[i].Attachments, image)
				break
			}
		}
	}
	return result, nil
}

func create(db *gorm.DB, a actor, s submission) (Ticket, error) {
	var ticket Ticket
	if a.ID <= 0 || a.Staff {
		return ticket, errInvalid
	}
	if err := s.validate(true); err != nil {
		return ticket, err
	}
	now := time.Now().Unix()
	ticket = Ticket{UserID: a.ID, Username: a.Username, Subject: s.Subject, Category: s.Category, Status: statusProcessing, Version: 1, CreatedAt: now, UpdatedAt: now}
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&ticket).Error; err != nil {
			return err
		}
		return appendMessage(tx, &ticket, a, s, "")
	})
	return ticket, err
}

// appendMessage runs only after a ticket's optimistic write gate has been
// acquired in the same transaction. Ticket state, reply and images commit
// together; no reply can slip through a concurrent withdrawal or resolution.
func appendMessage(tx *gorm.DB, ticket *Ticket, a actor, s submission, event string) error {
	m := Message{TicketID: ticket.ID, AuthorID: a.ID, AuthorName: a.Username, Staff: a.Staff, Body: s.Body, Event: event, CreatedAt: time.Now().Unix()}
	if err := tx.Create(&m).Error; err != nil {
		return err
	}
	for i := range s.Images {
		s.Images[i].ID = 0
		s.Images[i].TicketID = ticket.ID
		s.Images[i].MessageID = m.ID
	}
	if len(s.Images) > 0 {
		if err := tx.Create(&s.Images).Error; err != nil {
			return err
		}
	}
	preview := []rune(s.Body)
	if len(preview) > 240 {
		preview = preview[:240]
	}
	if event == "" {
		ticket.Preview = string(preview)
	}
	ticket.LastMessageID = m.ID
	ticket.UpdatedAt = m.CreatedAt
	updates := map[string]any{"last_message_id": m.ID, "preview": ticket.Preview, "updated_at": m.CreatedAt}
	if a.Staff {
		ticket.LastStaffMessageID = m.ID
		updates["last_staff_message_id"] = m.ID
		updates["staff_read_id"] = ticket.LastUserMessageID
	} else {
		ticket.LastUserMessageID = m.ID
		updates["last_user_message_id"] = m.ID
		updates["user_read_id"] = ticket.LastStaffMessageID
	}
	return tx.Model(&Ticket{}).Where("id = ?", ticket.ID).Updates(updates).Error
}

func update(db *gorm.DB, a actor, id, version int64, s submission, action string) error {
	if action == "reply" {
		if err := s.validate(false); err != nil {
			return err
		}
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var ticket Ticket
		if err := scope(tx, a).Where("id = ?", id).Take(&ticket).Error; err != nil {
			return err
		}
		if ticket.Version != version {
			return errConflict
		}
		closed := ticket.Status == statusResolved || ticket.Status == statusWithdrawn
		event := action
		switch action {
		case "reply":
			if closed {
				return errClosed
			}
			event = ""
			ticket.Status = statusProcessing
			if a.Staff {
				ticket.Status = statusWaiting
			}
		case "withdraw":
			if a.Staff || closed {
				return errInvalid
			}
			ticket.Status = statusWithdrawn
		case "resolve":
			if closed {
				return errInvalid
			}
			ticket.Status = statusResolved
		case "reopen":
			if !closed {
				return errInvalid
			}
			ticket.Status = statusProcessing
		default:
			return errInvalid
		}
		gate := scope(tx.Model(&Ticket{}), a).Where("id = ? AND version = ?", id, version).Updates(map[string]any{"version": version + 1, "status": ticket.Status})
		if gate.Error != nil {
			return gate.Error
		}
		if gate.RowsAffected != 1 {
			return errConflict
		}
		return appendMessage(tx, &ticket, a, s, event)
	})
}

func markRead(db *gorm.DB, a actor, id, upTo int64) error {
	var ticket Ticket
	if err := scope(db, a).Where("id = ?", id).Take(&ticket).Error; err != nil {
		return err
	}
	if upTo <= 0 || upTo > ticket.LastMessageID {
		return errInvalid
	}
	// A cursor must refer to this conversation, not another ticket's ID.
	var count int64
	if err := db.Model(&Message{}).Where("id = ? AND ticket_id = ?", upTo, id).Count(&count).Error; err != nil {
		return err
	}
	if count != 1 {
		return errInvalid
	}
	column := "user_read_id"
	if a.Staff {
		column = "staff_read_id"
	}
	return scope(db.Model(&Ticket{}), a).Where("id = ? AND "+column+" < ?", id, upTo).Update(column, upTo).Error
}
