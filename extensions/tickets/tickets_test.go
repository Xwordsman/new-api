package tickets

import (
	"bytes"
	"fmt"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func ticketTestDB(t *testing.T, dialect string) *gorm.DB {
	t.Helper()
	var driver gorm.Dialector
	switch dialect {
	case "sqlite":
		driver = sqlite.Open(":memory:")
	case "mysql", "postgres":
		dsn := os.Getenv("TICKETS_TEST_" + strings.ToUpper(dialect) + "_DSN")
		require.Contains(t, dsn, "/tickets_extension_test?")
		if dialect == "mysql" {
			driver = mysql.Open(dsn)
		} else {
			driver = postgres.Open(dsn)
		}
	}
	db, err := gorm.Open(driver, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	connection, err := db.DB()
	require.NoError(t, err)
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, connection.Close()) })
	for _, table := range []any{&Attachment{}, &Message{}, &Ticket{}} {
		require.NoError(t, db.Migrator().DropTable(table))
	}
	require.NoError(t, Migrate(db))
	return db
}

func TestTicketsConversationAndPersistenceMatrix(t *testing.T) {
	dialects := []string{"sqlite"}
	if os.Getenv("TICKETS_TEST_EXTERNAL") == "1" {
		dialects = append(dialects, "mysql", "postgres")
	}
	for _, dialect := range dialects {
		t.Run(dialect, func(t *testing.T) {
			db := ticketTestDB(t, dialect)
			owner, stranger, staff := actor{ID: 1, Username: "owner"}, actor{ID: 2, Username: "stranger"}, actor{ID: 3, Username: "support", Staff: true}
			binary := bytes.Repeat([]byte{0, 127, 255, 42}, 30000) // Larger than MySQL BLOB; binary-safe on every dialect.
			ticket, err := create(db, owner, submission{Subject: "额度 %_! 问题", Category: "quota", Body: "请求未成功", Images: []Attachment{{Name: "截图.png", MIME: "image/png", Size: len(binary), Data: binary}}})
			require.NoError(t, err)
			assert.Equal(t, statusProcessing, ticket.Status)
			_, err = detail(db, stranger, ticket.ID, 0)
			require.ErrorIs(t, err, gorm.ErrRecordNotFound)
			require.ErrorIs(t, update(db, stranger, ticket.ID, 1, submission{Body: "stolen"}, "reply"), gorm.ErrRecordNotFound)
			visible, err := list(db, stranger, listOptions{Page: 1, PageSize: 20})
			require.NoError(t, err)
			assert.Zero(t, visible.Total)
			team, err := list(db, staff, listOptions{Page: 1, PageSize: 20, Unread: true, Search: "%_!"})
			require.NoError(t, err)
			require.Len(t, team.Items, 1)
			assert.True(t, team.Items[0].Unread)
			initial, err := detail(db, owner, ticket.ID, 0)
			require.NoError(t, err)
			require.Len(t, initial.Messages, 1)
			require.Len(t, initial.Messages[0].Attachments, 1)
			assert.Empty(t, initial.Messages[0].Attachments[0].Data, "list metadata must not load image bodies")
			var saved Attachment
			require.NoError(t, db.First(&saved).Error)
			assert.Equal(t, binary, saved.Data)
			require.NoError(t, markRead(db, staff, ticket.ID, ticket.LastMessageID))
			require.NoError(t, update(db, staff, ticket.ID, 1, submission{Body: "请提供请求 ID"}, "reply"))
			require.ErrorIs(t, update(db, owner, ticket.ID, 1, submission{Body: "stale reply"}, "reply"), errConflict)
			firstReply, err := detail(db, owner, ticket.ID, 0)
			require.NoError(t, err)
			assert.Equal(t, statusWaiting, firstReply.Ticket.Status)
			assert.True(t, firstReply.Ticket.Unread)
			require.NoError(t, update(db, staff, ticket.ID, 2, submission{Body: "另一个客服回复"}, "reply"))
			// A read made before the second reply must not clear that new reply.
			require.NoError(t, markRead(db, owner, ticket.ID, firstReply.Ticket.LastMessageID))
			require.NoError(t, markRead(db, owner, ticket.ID, initial.Ticket.LastMessageID))
			latest, err := detail(db, owner, ticket.ID, 0)
			require.NoError(t, err)
			assert.True(t, latest.Ticket.Unread)
			require.NoError(t, markRead(db, owner, ticket.ID, latest.Ticket.LastMessageID))
			require.NoError(t, update(db, owner, ticket.ID, 3, submission{Body: "request-id-123"}, "reply"))
			require.NoError(t, update(db, owner, ticket.ID, 4, submission{}, "withdraw"))
			require.ErrorIs(t, update(db, staff, ticket.ID, 5, submission{Body: "closed reply"}, "reply"), errClosed)
			require.ErrorIs(t, update(db, staff, ticket.ID, 5, submission{}, "withdraw"), errInvalid)
			require.NoError(t, update(db, owner, ticket.ID, 5, submission{}, "reopen"))
			require.NoError(t, update(db, staff, ticket.ID, 6, submission{}, "resolve"))
			closed, err := detail(db, owner, ticket.ID, 0)
			require.NoError(t, err)
			assert.Equal(t, statusResolved, closed.Ticket.Status)
			assert.Equal(t, "request-id-123", closed.Ticket.Preview)
			assert.Equal(t, "resolve", closed.Messages[len(closed.Messages)-1].Event)
			other, err := create(db, stranger, submission{Subject: "Another ticket", Category: "other", Body: "unrelated"})
			require.NoError(t, err)
			require.ErrorIs(t, markRead(db, owner, ticket.ID, other.LastMessageID), errInvalid)
			require.NoError(t, Migrate(db))
			require.NoError(t, Migrate(db))
			after, err := detail(db, owner, ticket.ID, 0)
			require.NoError(t, err)
			assert.Equal(t, closed, after)
			require.NoError(t, db.First(&saved).Error)
			assert.Equal(t, binary, saved.Data)
			assert.True(t, db.Migrator().HasIndex(&Ticket{}, "idx_ticket_owner_updated"))
			assert.True(t, db.Migrator().HasIndex(&Message{}, "idx_ticket_message_cursor"))
		})
	}
}

func TestTicketValidationAndMessagePagination(t *testing.T) {
	db := ticketTestDB(t, "sqlite")
	owner := actor{ID: 1, Username: "owner"}
	for _, invalid := range []submission{
		{Subject: "x", Category: "other", Body: "text"},
		{Subject: strings.Repeat("字", 161), Category: "other", Body: "text"},
		{Subject: "Subject", Category: "invalid", Body: "text"},
		{Subject: "Subject", Category: "other", Body: " "},
		{Subject: "Subject", Category: "other", Body: strings.Repeat("字", 10001)},
	} {
		_, err := create(db, owner, invalid)
		require.ErrorIs(t, err, errInvalid)
	}
	ticket, err := create(db, owner, submission{Subject: "Long conversation", Category: "other", Body: "original"})
	require.NoError(t, err)
	// Explicit history fixture at the pagination boundary, without repetitive API calls.
	history := make([]Message, messagePageSize)
	for i := range history {
		history[i] = Message{TicketID: ticket.ID, AuthorID: owner.ID, Body: fmt.Sprintf("message %d", i+1), CreatedAt: 1800000000}
	}
	require.NoError(t, db.Create(&history).Error)
	latest, err := detail(db, owner, ticket.ID, 0)
	require.NoError(t, err)
	require.Len(t, latest.Messages, 50)
	assert.True(t, latest.HasOlder)
	assert.Equal(t, history[0].ID, latest.Messages[0].ID)
	older, err := detail(db, owner, ticket.ID, latest.Messages[0].ID)
	require.NoError(t, err)
	require.Len(t, older.Messages, 1)
	assert.Equal(t, "original", older.Messages[0].Body)
	assert.False(t, older.HasOlder)
}

func TestTicketRoutesEnforceSessionOwnershipAndPrivateImages(t *testing.T) {
	db := ticketTestDB(t, "sqlite")
	previousDB, previousLog := model.DB, model.LOG_DB
	previousType, previousRedis, previousSecret, previousSecure := common.MainDatabaseType(), common.RedisEnabled, common.SessionSecret, common.SessionCookieSecure
	model.DB, model.LOG_DB = db, db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.RedisEnabled, common.SessionSecret, common.SessionCookieSecure = false, "ticket-test-session-secret", true
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLog
		common.SetMainDatabaseType(previousType)
		common.RedisEnabled, common.SessionSecret, common.SessionCookieSecure = previousRedis, previousSecret, previousSecure
	})
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.AuditLog{}, &model.Option{}, &model.UserAccessToken{}))
	require.NoError(t, model.EnsureLegacyAccessTokenRetireAt(time.Now().Unix()))
	tokens := map[string]string{}
	for _, entry := range []struct {
		name string
		role int
	}{{"owner", common.RoleCommonUser}, {"stranger", common.RoleCommonUser}, {"support", common.RoleAdminUser}} {
		user := model.User{Username: entry.name, Password: "unusable", Status: common.UserStatusEnabled, Role: entry.role, AuthVersion: 1, Group: "default", AffCode: entry.name}
		require.NoError(t, db.Create(&user).Error)
		session := model.UserSession{SID: "tickets-" + entry.name, UserID: user.Id, Version: 1, UserAuthVersion: 1, Status: model.UserSessionStatusActive, RefreshHash: "unusable", LoginMethod: "password", LastActiveAt: time.Now().Unix(), ExpiresAt: time.Now().Unix() + 3600}
		require.NoError(t, model.CreateUserSession(&session))
		token, _, err := service.IssueAccessToken(service.AuthIdentity{UserID: user.Id, SessionID: session.SID, UserAuthVersion: 1, SessionVersion: 1})
		require.NoError(t, err)
		tokens[entry.name] = token
	}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterRoutes(router.Group("/api"))
	for _, route := range router.Routes() {
		rule, ok := middleware.AccessTokenRouteRule(route.Method + " " + route.Path)
		require.True(t, ok, route.Path)
		assert.Equal(t, "session", rule.Kind(), route.Path)
	}
	request := func(method, url, who, contentType, origin string, body io.Reader) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "https://tickets.example"+url, body)
		if who != "" {
			r.Header.Set("Authorization", "Bearer "+tokens[who])
		}
		r.Header.Set("Content-Type", contentType)
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	base := "/api/extensions/tickets"
	assert.Equal(t, 401, request("GET", base, "", "", "", nil).Code)
	assert.Equal(t, 403, request("GET", base+"/admin", "owner", "", "", nil).Code)
	assert.Equal(t, 403, request("POST", base, "owner", "", "https://foreign.example", nil).Code)
	var pngData bytes.Buffer
	require.NoError(t, png.Encode(&pngData, image.NewRGBA(image.Rect(0, 0, 2, 2))))
	// Uploaded trailing payload must never be served back.
	imageBytes := append(append([]byte{}, pngData.Bytes()...), []byte("<script>private-payload</script>")...)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	require.NoError(t, writer.WriteField("subject", "图片测试"))
	require.NoError(t, writer.WriteField("category", "interface"))
	require.NoError(t, writer.WriteField("body", "页面报错"))
	part, err := writer.CreateFormFile("images", "error.png")
	require.NoError(t, err)
	_, err = part.Write(imageBytes)
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	response := request("POST", base, "owner", writer.FormDataContentType(), "https://tickets.example", &body)
	require.Equal(t, 200, response.Code)
	var created struct {
		Success bool
		Data    Ticket
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &created))
	require.True(t, created.Success, response.Body.String())
	imageURL := fmt.Sprintf("%s/%d/images/1", base, created.Data.ID)
	assert.Equal(t, 401, request("GET", imageURL, "", "", "", nil).Code)
	assert.Equal(t, 404, request("GET", imageURL, "stranger", "", "", nil).Code)
	assert.Equal(t, 404, request("GET", fmt.Sprintf("%s/%d", base, created.Data.ID), "stranger", "", "", nil).Code)
	served := request("GET", imageURL, "owner", "", "", nil)
	require.Equal(t, 200, served.Code)
	assert.Equal(t, pngData.Bytes(), served.Body.Bytes())
	assert.Equal(t, "nosniff", served.Header().Get("X-Content-Type-Options"))
	assert.Equal(t, "private, no-store", served.Header().Get("Cache-Control"))
	assert.Equal(t, 200, request("GET", strings.Replace(imageURL, base, base+"/admin", 1), "support", "", "", nil).Code)
	for _, tc := range []struct {
		name string
		data []byte
	}{{"fake.png", []byte("<svg onload='evil()'></svg>")}, {"wrong.jpg", pngData.Bytes()}, {"large.png", bytes.Repeat([]byte{1}, (2<<20)+1)}} {
		t.Run(tc.name, func(t *testing.T) {
			var payload bytes.Buffer
			form := multipart.NewWriter(&payload)
			file, err := form.CreateFormFile("images", tc.name)
			require.NoError(t, err)
			_, err = file.Write(tc.data)
			require.NoError(t, err)
			require.NoError(t, form.Close())
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/", &payload)
			c.Request.Header.Set("Content-Type", form.FormDataContentType())
			_, _, err = parseSubmission(c)
			require.ErrorIs(t, err, errImage)
		})
	}
}
