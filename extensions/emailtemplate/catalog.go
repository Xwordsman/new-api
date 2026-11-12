package emailtemplate

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
)

type Template struct {
	Type     string `json:"type"`
	Language string `json:"language"`
	Subject  string `json:"subject"`
	HTML     string `json:"html"`
}

type Variable struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Required    bool   `json:"required"`
}

type Definition struct {
	Type      string              `json:"type"`
	Name      string              `json:"name"`
	Variables []Variable          `json:"variables"`
	Defaults  map[string]Template `json:"defaults"`
}

var languages = []string{i18n.LangZhCN, i18n.LangZhTW, i18n.LangEn}

// These are existing delivery scenarios. No new notification triggers are added.
var kinds = []struct {
	id   string
	name string
}{
	{common.EmailTemplateVerification, "Registration verification"},
	{common.EmailTemplateEmailBinding, "Email binding verification"},
	{common.EmailTemplatePasswordReset, "Password reset"},
	{common.EmailTemplateSecurity, "Account security notice"},
	{common.EmailTemplateQuota, "Low balance and subscription quota"},
	{common.EmailTemplateChannel, "Channel status notification"},
	{common.EmailTemplateChannelTest, "Channel test report"},
	{common.EmailTemplateModelUpdate, "Upstream model update"},
	{common.EmailTemplateRiskAlert, "Protection alerts"},
}

func catalog() []Definition {
	definitions := make([]Definition, 0, len(kinds))
	for _, kind := range kinds {
		definition := Definition{Type: kind.id, Name: kind.name, Variables: variables(kind.id), Defaults: map[string]Template{}}
		for _, lang := range languages {
			definition.Defaults[lang] = defaultTemplate(kind.id, lang)
		}
		definitions = append(definitions, definition)
	}
	return definitions
}

func variables(kind string) []Variable {
	vars := []Variable{
		{Name: "site_name", Description: "Site name"},
		{Name: "site_url", Description: "Configured site address"},
		{Name: "original_subject", Description: "Original notification subject"},
	}
	switch kind {
	case common.EmailTemplateVerification, common.EmailTemplateEmailBinding:
		vars = append(vars, Variable{"verification_code", "Verification code", true}, Variable{"expires_in_minutes", "Actual validity in minutes", true}, Variable{"message", "Verification instructions", true})
	case common.EmailTemplatePasswordReset:
		vars = append(vars, Variable{"reset_url", "Password reset URL", true}, Variable{"expires_in_minutes", "Actual validity in minutes", true})
	default:
		vars = append(vars, Variable{"content", "Original notification content", true})
	}
	return vars
}

func normalizeLanguage(lang string) string {
	if lang == "" {
		lang = common.DefaultLanguage
	}
	if result := i18n.ParseAcceptLanguage(lang); result != "" {
		return result
	}
	return i18n.LangEn
}

func templateTitle(kind, lang string) string {
	titles := map[string]string{
		common.EmailTemplateVerification:  "验证您的邮箱",
		common.EmailTemplateEmailBinding:  "确认邮箱操作",
		common.EmailTemplatePasswordReset: "重置您的密码",
		common.EmailTemplateSecurity:      "账号安全通知",
		common.EmailTemplateQuota:         "额度提醒",
		common.EmailTemplateChannel:       "渠道状态通知",
		common.EmailTemplateChannelTest:   "渠道测试报告",
		common.EmailTemplateModelUpdate:   "上游模型更新",
		common.EmailTemplateRiskAlert:     "安全防护告警",
	}
	if lang == i18n.LangZhTW {
		titles = map[string]string{
			common.EmailTemplateVerification: "驗證您的信箱", common.EmailTemplateEmailBinding: "確認信箱操作",
			common.EmailTemplatePasswordReset: "重設您的密碼", common.EmailTemplateSecurity: "帳號安全通知",
			common.EmailTemplateQuota: "額度提醒", common.EmailTemplateChannel: "渠道狀態通知",
			common.EmailTemplateChannelTest: "渠道測試報告", common.EmailTemplateModelUpdate: "上游模型更新",
			common.EmailTemplateRiskAlert: "安全防護警示",
		}
	}
	if lang == i18n.LangEn {
		for _, entry := range kinds {
			titles[entry.id] = entry.name
		}
	}
	return titles[kind]
}

// Defaults use inline styles and presentation tables for mail clients. No remote
// fonts, scripts, tracking images, or web-console CSS are needed.
func defaultTemplate(kind, lang string) Template {
	lang = normalizeLanguage(lang)
	english := lang == i18n.LangEn
	traditional := lang == i18n.LangZhTW
	title := templateTitle(kind, lang)
	validity, advice, footer := "有效期为 {{expires_in_minutes}} 分钟。", "如果不是您本人操作，请忽略此邮件。请勿向任何人透露验证码或链接。", "此邮件由 {{site_name}} 自动发送，请勿直接回复。"
	button, fallback := "重置密码", "如果按钮无法打开，请复制以下链接到浏览器："
	if traditional {
		validity, advice, footer = "有效期限為 {{expires_in_minutes}} 分鐘。", "如果不是您本人操作，請忽略此郵件。請勿向任何人透露驗證碼或連結。", "此郵件由 {{site_name}} 自動寄送，請勿直接回覆。"
		button, fallback = "重設密碼", "如果按鈕無法開啟，請複製以下連結至瀏覽器："
	}
	if english {
		validity, advice, footer = "Valid for {{expires_in_minutes}} minutes.", "If you did not request this, ignore this email. Never share your verification code or link.", "This email was sent automatically by {{site_name}}. Please do not reply."
		button, fallback = "Reset Password", "If the button does not open, copy this link into your browser:"
	}
	body := `<div style="font-size:15px;line-height:1.8;white-space:pre-line;color:#334155">{{content}}</div>`
	switch kind {
	case common.EmailTemplateVerification, common.EmailTemplateEmailBinding:
		body = `<p style="margin:0 0 22px;font-size:15px;line-height:1.8;color:#334155">{{message}}</p>
<div style="padding:22px 12px;border:1px solid #e4e1ff;border-radius:12px;background:#f6f5ff;text-align:center;font-family:Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:8px;color:#5b53f5">{{verification_code}}</div>
<p style="margin:20px 0 8px;font-size:14px;color:#334155">` + validity + `</p>
<p style="margin:0;font-size:13px;line-height:1.8;color:#64748b">` + advice + `</p>`
	case common.EmailTemplatePasswordReset:
		body = `<p style="margin:0 0 24px;font-size:15px;line-height:1.8;color:#334155">` + validity + `</p>
<table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="border-radius:8px;background:#5b53f5"><a href="{{reset_url}}" style="display:inline-block;padding:14px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">` + button + `</a></td></tr></table>
<p style="margin:24px 0 8px;font-size:13px;color:#64748b">` + fallback + `</p>
<p style="margin:0 0 20px;font-size:12px;line-height:1.7;word-break:break-all"><a href="{{reset_url}}" style="color:#5b53f5">{{reset_url}}</a></p>
<p style="margin:0;font-size:13px;line-height:1.8;color:#64748b">` + advice + `</p>`
	}
	html := fmt.Sprintf(`<!DOCTYPE html>
<html lang="%s">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>%s</title></head>
<body style="margin:0;padding:32px 12px;background:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#0a2540">
<table role="presentation" width="100%%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e9eaf1;border-radius:16px;overflow:hidden">
<tr><td style="padding:28px 32px 20px;border-top:4px solid #5b53f5"><p style="margin:0 0 22px;font-size:13px;font-weight:600;letter-spacing:1px;color:#5b53f5">{{site_name}}</p><h1 style="margin:0;font-size:25px;line-height:1.4;font-weight:700;color:#0a2540">%s</h1></td></tr>
<tr><td style="padding:8px 32px 32px">%s</td></tr>
<tr><td style="padding:20px 32px;background:#fafafe;border-top:1px solid #eef0f6"><p style="margin:0;font-size:12px;line-height:1.8;color:#8893a7">%s<br>Powered by new-api</p></td></tr>
</table></td></tr></table>
</body></html>`, lang, title, title, body, footer)
	return Template{Type: kind, Language: lang, Subject: "{{original_subject}}", HTML: html}
}

func knownKind(kind string) bool {
	for _, entry := range kinds {
		if kind == entry.id {
			return true
		}
	}
	return false
}

func templateKey(kind, lang string) string { return kind + ":" + lang }

func sampleVariables(kind, lang string) map[string]string {
	values := map[string]string{
		"site_name": common.SystemName, "site_url": "https://example.com",
		"original_subject":  templateTitle(kind, normalizeLanguage(lang)),
		"verification_code": "482916", "expires_in_minutes": "10",
		"reset_url": "https://example.com/user/reset?email=preview%40example.com&token=preview-only",
		"message":   "请确认此次邮箱操作。此处为预览示例，不会生成真实验证码。",
		"content":   "<p>这是一封通知邮件的示例。</p><p>实际发送时，这里会展示现有功能生成的完整通知内容。</p>",
	}
	if normalizeLanguage(lang) == i18n.LangEn {
		values["message"] = "Please confirm this email operation. This is a preview; no real verification code is issued."
		values["content"] = "<p>This is a sample notification.</p><p>Real emails include the complete content generated by the existing notification.</p>"
	}
	if normalizeLanguage(lang) == i18n.LangZhTW {
		values["message"] = "請確認此次信箱操作。此為預覽範例，不會產生真實驗證碼。"
		values["content"] = "<p>這是通知郵件的範例。</p><p>實際寄送時，這裡會顯示現有功能產生的完整通知內容。</p>"
	}
	values["original_subject"] = strings.TrimSpace(values["site_name"] + " · " + values["original_subject"])
	return values
}
