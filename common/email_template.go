package common

const EmailTemplateOptionKey = "EmailTemplateExtensionSettings"

const (
	EmailTemplateVerification  = "verification"
	EmailTemplateEmailBinding  = "email_binding"
	EmailTemplatePasswordReset = "password_reset"
	EmailTemplateSecurity      = "security_notice"
	EmailTemplateQuota         = "quota_warning"
	EmailTemplateChannel       = "channel_status"
	EmailTemplateChannelTest   = "channel_test"
	EmailTemplateModelUpdate   = "model_update"
	EmailTemplateRiskAlert     = "risk_alert"
)

// EmailTemplateData carries presentation data only. Issuing and verifying
// challenges, notification preferences, and transport selection stay with callers.
type EmailTemplateData struct {
	Type      string
	Language  string
	Variables map[string]string
}

// EmailTemplateRenderer is installed once during extension initialization.
// Without the extension, callers retain their original subject and HTML.
var EmailTemplateRenderer func(subject, content string, data EmailTemplateData) (string, string)

func SendEmailWithTemplate(subject, receiver, content string, data EmailTemplateData) error {
	if EmailTemplateRenderer != nil {
		subject, content = EmailTemplateRenderer(subject, content, data)
	}
	return SendEmail(subject, receiver, content)
}
