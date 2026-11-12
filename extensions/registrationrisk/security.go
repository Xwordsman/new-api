package registrationrisk

import (
	"crypto/hmac"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/extensions/registrationrisk/guard"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const deviceCookie = "newapi_registration_device"

// Device returns a first-party signed, expiring identifier. It is a weak signal:
// deleting cookies or switching browsers bypasses it, so it must not prove fraud.
func Device(c *gin.Context) (string, error) {
	db := model.DB.WithContext(c.Request.Context())
	s, err := guard.GetSettings(db)
	if err != nil {
		return "", err
	}
	salt, err := guard.Salt(db)
	if err != nil {
		return "", err
	}
	now := time.Now().Unix()
	if cookie, err := c.Cookie(deviceCookie); err == nil {
		parts := strings.Split(cookie, ".")
		if len(parts) == 3 && len(parts[0]) == 32 {
			expires, e := strconv.ParseInt(parts[1], 10, 64)
			expected := guard.Digest(salt, "device-cookie:"+parts[0]+"."+parts[1])
			if e == nil && expires > now && expires <= now+int64(s.DeviceDays)*86400 && hmac.Equal([]byte(parts[2]), []byte(expected)) {
				return parts[0], nil
			}
		}
	}
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return "", err
	}
	value := hex.EncodeToString(random[:])
	payload := fmt.Sprintf("%s.%d", value, now+int64(s.DeviceDays)*86400)
	http.SetCookie(c.Writer, &http.Cookie{Name: deviceCookie, Value: payload + "." + guard.Digest(salt, "device-cookie:"+payload), Path: "/", MaxAge: s.DeviceDays * 86400, HttpOnly: true, Secure: common.SessionCookieSecure, SameSite: http.SameSiteLaxMode})
	return value, nil
}

func Evaluate(c *gin.Context, stage, source, email string, inviterID int, verified bool) (*guard.Decision, error) {
	device, err := Device(c)
	if err != nil {
		return nil, err
	}
	return guard.Evaluate(model.DB.WithContext(c.Request.Context()), guard.Input{Stage: stage, Source: source, Email: email, IP: c.ClientIP(), Device: device, InviterID: inviterID, VerifiedEmail: verified}, time.Now())
}

// SignupContext preserves the host's referral context and adds a decision that
// is consumed atomically by model.User.InsertWithTx.
func SignupContext(tx *gorm.DB, d *guard.Decision) *gorm.DB { return guard.WithDecision(tx, d) }

// Captcha replaces only the public signup/mail check. Login and recovery retain
// upstream protections. A token is never consumed by two middleware handlers.
func Captcha() gin.HandlerFunc {
	return func(c *gin.Context) {
		s, err := guard.GetSettings(model.DB.WithContext(c.Request.Context()))
		if err != nil {
			common.ApiErrorT(c, "Registration protection is temporarily unavailable")
			c.Abort()
			return
		}
		if !common.TurnstileCheckEnabled && !(s.Mode == "enforce" && s.Captcha) {
			c.Next()
			return
		}
		token := c.Query("turnstile")
		if token == "" || len(token) > 2048 {
			common.ApiErrorT(c, "Turnstile verification failed, please refresh and try again!")
			c.Abort()
			return
		}
		form := url.Values{"secret": {common.TurnstileSecretKey}, "response": {token}, "remoteip": {c.ClientIP()}}
		req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, "https://challenges.cloudflare.com/turnstile/v0/siteverify", strings.NewReader(form.Encode()))
		if err == nil {
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			client := http.Client{Timeout: 8 * time.Second}
			var response *http.Response
			response, err = client.Do(req)
			if err == nil {
				defer response.Body.Close()
				var result struct {
					Success  bool   `json:"success"`
					Hostname string `json:"hostname"`
				}
				err = common.DecodeJson(io.LimitReader(response.Body, 16384), &result)
				if err == nil && response.StatusCode == 200 && result.Success && (s.CaptchaHostname == "" || strings.EqualFold(result.Hostname, s.CaptchaHostname)) {
					c.Next()
					return
				}
			}
		}
		common.ApiErrorT(c, "Turnstile verification failed, please refresh and try again!")
		c.Abort()
	}
}
