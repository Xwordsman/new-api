package tickets

import "gorm.io/gorm"

// Ticket owns a conversation. Read cursors are persisted separately for its
// owner and the shared support queue, so a late read cannot hide a new reply.
type Ticket struct {
	ID                 int64  `gorm:"primaryKey" json:"id"`
	UserID             int    `gorm:"index:idx_ticket_owner_updated,priority:1" json:"user_id"`
	Username           string `gorm:"size:64" json:"username"`
	Subject            string `gorm:"size:160" json:"subject"`
	Category           string `gorm:"size:24" json:"category"`
	Status             string `gorm:"size:24;index:idx_ticket_status_updated,priority:1" json:"status"`
	Version            int64  `json:"version"`
	LastMessageID      int64  `json:"last_message_id"`
	LastUserMessageID  int64  `json:"-"`
	LastStaffMessageID int64  `json:"-"`
	UserReadID         int64  `json:"-"`
	StaffReadID        int64  `json:"-"`
	Preview            string `gorm:"size:240" json:"preview"`
	CreatedAt          int64  `gorm:"autoCreateTime:false" json:"created_at"`
	UpdatedAt          int64  `gorm:"autoUpdateTime:false;index:idx_ticket_owner_updated,priority:2;index:idx_ticket_status_updated,priority:2" json:"updated_at"`
	Unread             bool   `gorm:"-" json:"unread"`
}

func (Ticket) TableName() string { return "extension_tickets" }

type Message struct {
	ID          int64        `gorm:"primaryKey;index:idx_ticket_message_cursor,priority:2" json:"id"`
	TicketID    int64        `gorm:"index:idx_ticket_message_cursor,priority:1" json:"ticket_id"`
	AuthorID    int          `json:"author_id"`
	AuthorName  string       `gorm:"size:64" json:"author_name"`
	Staff       bool         `json:"staff"`
	Body        string       `gorm:"type:text" json:"body"`
	Event       string       `gorm:"size:24" json:"event"`
	CreatedAt   int64        `gorm:"autoCreateTime:false" json:"created_at"`
	Attachments []Attachment `gorm:"-" json:"attachments"`
}

func (Message) TableName() string { return "extension_ticket_messages" }

type Attachment struct {
	ID        int64  `gorm:"primaryKey" json:"id"`
	TicketID  int64  `gorm:"index:idx_ticket_attachment_owner" json:"-"`
	MessageID int64  `gorm:"index:idx_ticket_attachment_message" json:"-"`
	Name      string `gorm:"size:160" json:"name"`
	MIME      string `gorm:"size:32" json:"mime"`
	Size      int    `json:"size"`
	// GORM chooses MEDIUMBLOB / BYTEA / BLOB for the supported dialects.
	Data []byte `gorm:"size:4194304" json:"-"`
}

func (Attachment) TableName() string { return "extension_ticket_attachments" }

func Migrate(db *gorm.DB) error {
	return db.AutoMigrate(&Ticket{}, &Message{}, &Attachment{})
}
