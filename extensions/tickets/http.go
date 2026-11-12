package tickets

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	_ "golang.org/x/image/webp"
	"gorm.io/gorm"
)

func RegisterRoutes(api *gin.RouterGroup) {
	users := api.Group("/extensions/tickets", middleware.UserAuth(), middleware.DisableCache(), requestContext())
	users.GET("/notifications", notifications)
	users.POST("", middleware.SessionCookieOriginGuard(), middleware.UserCriticalRateLimit("ticket-create"), createTicket)
	registerConversationRoutes(users)
	admin := api.Group("/extensions/tickets/admin", middleware.AdminAuth(), middleware.DisableCache(), requestContext(), func(c *gin.Context) { c.Set("ticket_staff", true) })
	registerConversationRoutes(admin)
}

func registerConversationRoutes(group *gin.RouterGroup) {
	group.GET("", listTickets)
	group.GET("/:id", getTicket)
	group.GET("/:id/images/:image", getImage)
	group.POST("/:id/replies", middleware.SessionCookieOriginGuard(), middleware.UserCriticalRateLimit("ticket-reply"), replyTicket)
	group.POST("/:id/actions", middleware.SessionCookieOriginGuard(), middleware.UserCriticalRateLimit("ticket-action"), changeStatus)
	group.POST("/:id/read", middleware.SessionCookieOriginGuard(), markTicketRead)
}

func requestContext() gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
		defer cancel()
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	}
}

func currentActor(c *gin.Context) actor {
	return actor{ID: c.GetInt("id"), Username: c.GetString("username"), Staff: c.GetBool("ticket_staff")}
}

func respond(c *gin.Context, data any, err error) {
	if err == nil {
		common.ApiSuccess(c, data)
		return
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.Status(http.StatusNotFound)
		return
	}
	if errors.Is(err, errInvalid) || errors.Is(err, errImage) || errors.Is(err, errClosed) || errors.Is(err, errConflict) {
		common.ApiError(c, err)
		return
	}
	common.SysError("tickets: " + err.Error())
	common.ApiErrorT(c, "Unable to load tickets. Please try again.")
}

func parseID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.Status(http.StatusNotFound)
		return 0, false
	}
	return id, true
}

func listTickets(c *gin.Context) {
	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	status := c.Query("status")
	if err != nil || page < 1 || page > 100000 || utf8.RuneCountInString(c.Query("search")) > 160 || (status != "" && status != statusProcessing && status != statusWaiting && status != statusResolved && status != statusWithdrawn) {
		respond(c, nil, errInvalid)
		return
	}
	data, err := list(model.DB.WithContext(c.Request.Context()), currentActor(c), listOptions{Page: page, PageSize: 20, Search: strings.TrimSpace(c.Query("search")), Status: status, Unread: c.Query("unread") == "true"})
	respond(c, data, err)
}

func getTicket(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	before, err := strconv.ParseInt(c.DefaultQuery("before", "0"), 10, 64)
	if err != nil || before < 0 {
		respond(c, nil, errInvalid)
		return
	}
	data, err := detail(model.DB.WithContext(c.Request.Context()), currentActor(c), id, before)
	respond(c, data, err)
}

func parseSubmission(c *gin.Context) (submission, int64, error) {
	var s submission
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 12<<20)
	if err := c.Request.ParseMultipartForm(12 << 20); err != nil {
		return s, 0, errInvalid
	}
	defer c.Request.MultipartForm.RemoveAll()
	s.Subject = c.PostForm("subject")
	s.Category = c.PostForm("category")
	s.Body = c.PostForm("body")
	version, _ := strconv.ParseInt(c.PostForm("version"), 10, 64)
	files := c.Request.MultipartForm.File["images"]
	if len(files) > 5 || len(c.Request.MultipartForm.File) > 1 {
		return s, version, errImage
	}
	for _, header := range files {
		if header.Size <= 0 || header.Size > 2<<20 {
			return s, version, errImage
		}
		file, err := header.Open()
		if err != nil {
			return s, version, errImage
		}
		data, err := io.ReadAll(io.LimitReader(file, (2<<20)+1))
		file.Close()
		if err != nil || len(data) > 2<<20 {
			return s, version, errImage
		}
		config, format, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil || (format != "png" && format != "jpeg" && format != "webp") || config.Width < 1 || config.Height < 1 || config.Width > 8192 || config.Height > 8192 || int64(config.Width)*int64(config.Height) > 8000000 {
			return s, version, errImage
		}
		ext := strings.ToLower(path.Ext(header.Filename))
		if (format == "png" && ext != ".png") || (format == "jpeg" && ext != ".jpg" && ext != ".jpeg") || (format == "webp" && ext != ".webp") {
			return s, version, errImage
		}
		decoded, _, err := image.Decode(bytes.NewReader(data))
		if err != nil {
			return s, version, errImage
		}
		// Re-encode instead of serving uploaded bytes, removing metadata and
		// trailing active payloads. Only private, authenticated image routes
		// can retrieve these bytes.
		var normalized bytes.Buffer
		mime, extension := "image/png", ".png"
		if format == "jpeg" {
			err = jpeg.Encode(&normalized, decoded, &jpeg.Options{Quality: 90})
			mime, extension = "image/jpeg", ".jpg"
		} else {
			err = png.Encode(&normalized, decoded)
		}
		if err != nil || normalized.Len() > 4<<20 {
			return s, version, errImage
		}
		name := strings.TrimSuffix(path.Base(strings.ReplaceAll(header.Filename, "\\", "/")), ext)
		name = strings.Map(func(r rune) rune {
			if unicode.IsControl(r) || r == ':' {
				return -1
			}
			return r
		}, name)
		runes := []rune(name)
		name = string(runes[:min(len(runes), 120)]) + extension
		s.Images = append(s.Images, Attachment{Name: name, MIME: mime, Size: normalized.Len(), Data: normalized.Bytes()})
	}
	return s, version, nil
}

func createTicket(c *gin.Context) {
	s, _, err := parseSubmission(c)
	if err != nil {
		respond(c, nil, err)
		return
	}
	ticket, err := create(model.DB.WithContext(c.Request.Context()), currentActor(c), s)
	respond(c, ticket, err)
}

func replyTicket(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	s, version, err := parseSubmission(c)
	if err == nil {
		err = update(model.DB.WithContext(c.Request.Context()), currentActor(c), id, version, s, "reply")
	}
	respond(c, nil, err)
}

func changeStatus(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	var payload struct {
		Version int64  `json:"version"`
		Action  string `json:"action"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	if common.DecodeJson(c.Request.Body, &payload) != nil {
		respond(c, nil, errInvalid)
		return
	}
	err := update(model.DB.WithContext(c.Request.Context()), currentActor(c), id, payload.Version, submission{}, payload.Action)
	respond(c, nil, err)
}

func markTicketRead(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	var payload struct {
		UpTo int64 `json:"up_to"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	if common.DecodeJson(c.Request.Body, &payload) != nil {
		respond(c, nil, errInvalid)
		return
	}
	err := markRead(model.DB.WithContext(c.Request.Context()), currentActor(c), id, payload.UpTo)
	respond(c, nil, err)
}

func getImage(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	imageID, err := strconv.ParseInt(c.Param("image"), 10, 64)
	if err != nil || imageID <= 0 {
		c.Status(http.StatusNotFound)
		return
	}
	db := model.DB.WithContext(c.Request.Context())
	var ticket Ticket
	if err = scope(db, currentActor(c)).Select("id").Where("id = ?", id).Take(&ticket).Error; err != nil {
		respond(c, nil, err)
		return
	}
	var attachment Attachment
	if err = db.Where("id = ? AND ticket_id = ?", imageID, id).Take(&attachment).Error; err != nil {
		respond(c, nil, err)
		return
	}
	extension := ".png"
	if attachment.MIME == "image/jpeg" {
		extension = ".jpg"
	}
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Security-Policy", "default-src 'none'; sandbox")
	c.Header("Content-Disposition", fmt.Sprintf(`inline; filename="ticket-image-%d%s"`, attachment.ID, extension))
	c.Data(http.StatusOK, attachment.MIME, attachment.Data)
}

func notifications(c *gin.Context) {
	db := model.DB.WithContext(c.Request.Context())
	a := currentActor(c)
	mine, err := list(db, a, listOptions{Page: 1, PageSize: 10, Unread: true})
	if err != nil {
		respond(c, nil, err)
		return
	}
	team := ticketList{Items: []Ticket{}}
	if c.GetInt("role") >= common.RoleAdminUser {
		a.Staff = true
		team, err = list(db, a, listOptions{Page: 1, PageSize: 10, Unread: true})
	}
	respond(c, gin.H{"mine": mine, "team": team}, err)
}
