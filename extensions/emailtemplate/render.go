package emailtemplate

import (
	"bytes"
	"html"
	"html/template"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	xhtml "golang.org/x/net/html"
)

var (
	variablePattern = regexp.MustCompile(`\{\{([a-z_]+)\}\}`)
	errInvalid      = common.NewMessage("Invalid email template settings")
	errVariables    = common.NewMessage("Use only the listed email template variables with double braces")
	errRequired     = common.NewMessage("Keep all required variables in the email body and the reset link in a link destination")
	errUnsafeHTML   = common.NewMessage("Email HTML must not contain scripts, forms, embedded pages, event handlers or remote CSS")
)

type compiledTemplate struct {
	source Template
	body   *template.Template
}

// Flat variables are the entire template language. Go expressions, functions,
// includes, loops and access to server objects are never exposed to an editor.
func compileTemplate(source Template) (*compiledTemplate, error) {
	if !knownKind(source.Type) || normalizeLanguage(source.Language) != source.Language ||
		strings.TrimSpace(source.Subject) == "" || utf8.RuneCountInString(source.Subject) > 240 ||
		strings.TrimSpace(source.HTML) == "" || len(source.HTML) > 48*1024 ||
		strings.ContainsFunc(source.Subject, unicode.IsControl) || !utf8.ValidString(source.Subject+source.HTML) {
		return nil, errInvalid
	}
	allowed := map[string]bool{}
	for _, variable := range variables(source.Type) {
		allowed[variable.Name] = true
	}
	for index, text := range []string{source.Subject, source.HTML} {
		for _, match := range variablePattern.FindAllStringSubmatch(text, -1) {
			if !allowed[match[1]] || (index == 0 && match[1] != "site_name" && match[1] != "original_subject") {
				return nil, errVariables
			}
		}
		remainder := variablePattern.ReplaceAllString(text, "")
		if strings.Contains(remainder, "{{") || strings.Contains(remainder, "}}") {
			return nil, errVariables
		}
	}
	if err := validateHTML(source); err != nil {
		return nil, err
	}
	markup := variablePattern.ReplaceAllString(source.HTML, "{{.$1}}")
	body, err := template.New("email").Option("missingkey=error").Parse(markup)
	if err != nil {
		return nil, errInvalid
	}
	compiled := &compiledTemplate{source: source, body: body}
	// Executing as well as parsing detects invalid contextual HTML templates.
	if _, _, err := compiled.render(sampleVariables(source.Type, source.Language)); err != nil {
		return nil, errInvalid
	}
	return compiled, nil
}

func safeLink(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	return err == nil && parsed.Host != "" && parsed.User == nil && (parsed.Scheme == "https" || parsed.Scheme == "http")
}

func safeCSS(value string) bool {
	// Strip CSS escapes/comments by rejecting them: they can conceal url(),
	// @import and executable legacy CSS in mail clients.
	value = strings.ToLower(value)
	for _, forbidden := range []string{"url", "@", "expression", "behavior", "-moz-binding", "\\", "/*", "<", ">"} {
		if strings.Contains(value, forbidden) {
			return false
		}
	}
	return true
}

func validateHTML(source Template) error {
	root, err := xhtml.Parse(strings.NewReader(source.HTML))
	if err != nil {
		return errInvalid
	}
	allowedTags := strings.Fields("html head title meta style body table thead tbody tfoot tr td th p div span a img br hr h1 h2 h3 h4 h5 h6 strong b em i u s small sup sub ul ol li pre code blockquote center font")
	allowedAttributes := strings.Fields("lang dir style class id role width height align valign border cellpadding cellspacing colspan rowspan alt title bgcolor color face size target rel name content charset")
	found := map[string]bool{}
	resetLink := false
	var walk func(*xhtml.Node) error
	walk = func(node *xhtml.Node) error {
		if (node.Type == xhtml.CommentNode || node.Type == xhtml.DoctypeNode) && strings.Contains(node.Data, "{{") {
			return errVariables
		}
		if node.Type == xhtml.ElementNode {
			if !slices.Contains(allowedTags, node.Data) {
				return errUnsafeHTML
			}
			for _, attr := range node.Attr {
				if attr.Namespace != "" {
					return errUnsafeHTML
				}
				if attr.Key == "style" && !safeCSS(attr.Val) {
					return errUnsafeHTML
				}
				if strings.Contains(attr.Val, "{{") {
					if node.Data != "a" || attr.Key != "href" || (attr.Val != "{{reset_url}}" && attr.Val != "{{site_url}}") {
						return errVariables
					}
					resetLink = resetLink || attr.Val == "{{reset_url}}"
					continue
				}
				if (node.Data == "a" && attr.Key == "href") || (node.Data == "img" && attr.Key == "src") {
					if !safeLink(attr.Val) {
						return errUnsafeHTML
					}
					continue
				}
				if !slices.Contains(allowedAttributes, attr.Key) {
					return errUnsafeHTML
				}
			}
		}
		if node.Type == xhtml.TextNode {
			if node.Parent != nil && (node.Parent.Data == "style" || node.Parent.Data == "title") {
				if node.Parent.Data == "style" && !safeCSS(node.Data) {
					return errUnsafeHTML
				}
				if strings.Contains(node.Data, "{{") {
					return errVariables
				}
			} else {
				for _, match := range variablePattern.FindAllStringSubmatch(node.Data, -1) {
					found[match[1]] = true
				}
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			if err := walk(child); err != nil {
				return err
			}
		}
		return nil
	}
	if err := walk(root); err != nil {
		return err
	}
	for _, variable := range variables(source.Type) {
		if variable.Required && (!found[variable.Name] || !strings.Contains(source.HTML, "{{"+variable.Name+"}}")) {
			return errRequired
		}
	}
	if source.Type == common.EmailTemplatePasswordReset && !resetLink {
		return errRequired
	}
	return nil
}

func (compiled *compiledTemplate) render(values map[string]string) (string, string, error) {
	data := make(map[string]any, len(values))
	for name, value := range values {
		data[name] = value
	}
	for _, variable := range variables(compiled.source.Type) {
		if variable.Required && strings.TrimSpace(values[variable.Name]) == "" {
			return "", "", errRequired
		}
	}
	if compiled.source.Type == common.EmailTemplatePasswordReset && !safeLink(values["reset_url"]) {
		return "", "", errInvalid
	}
	// Only the notification fragment is HTML. All codes, URLs, names and other
	// values stay ordinary strings and receive contextual html/template escaping.
	data["content"] = template.HTML(sanitizeNotificationContent(values["content"])) // #nosec G203 -- allowlisted below.
	var body bytes.Buffer
	if err := compiled.body.Execute(&body, data); err != nil {
		return "", "", errInvalid
	}
	subject := variablePattern.ReplaceAllStringFunc(compiled.source.Subject, func(token string) string {
		return values[token[2:len(token)-2]]
	})
	if strings.ContainsFunc(subject, unicode.IsControl) || utf8.RuneCountInString(subject) > 512 {
		return "", "", errInvalid
	}
	return subject, body.String(), nil
}

// Notification content already contains useful paragraphs and links. Keep a
// small inert subset so channel names and upstream text cannot add active HTML.
func sanitizeNotificationContent(content string) string {
	root, err := xhtml.Parse(strings.NewReader(content))
	if err != nil {
		return html.EscapeString(content)
	}
	var output strings.Builder
	var walk func(*xhtml.Node)
	walk = func(node *xhtml.Node) {
		if node.Type == xhtml.TextNode {
			output.WriteString(html.EscapeString(node.Data))
			return
		}
		if node.Type == xhtml.ElementNode && slices.Contains(strings.Fields("script style iframe object embed svg math form input button img link meta"), node.Data) {
			return
		}
		keep := node.Type == xhtml.ElementNode && slices.Contains(strings.Fields("p div span br hr strong b em i a ul ol li pre code table tbody tr td th blockquote"), node.Data)
		if keep {
			output.WriteString("<" + node.Data)
			if node.Data == "a" {
				for _, attr := range node.Attr {
					if attr.Key == "href" && safeLink(attr.Val) {
						output.WriteString(` href="` + html.EscapeString(attr.Val) + `" rel="noopener noreferrer"`)
					}
				}
			}
			output.WriteString(">")
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
		if keep && node.Data != "br" && node.Data != "hr" {
			output.WriteString("</" + node.Data + ">")
		}
	}
	walk(root)
	return output.String()
}

var snapshot struct {
	sync.Mutex
	raw       string
	enabled   bool
	ready     bool
	templates map[string]*compiledTemplate
}

func Initialize() { common.EmailTemplateRenderer = Render }

// Render fails back to the caller's original email if the plugin is disabled,
// unavailable, or cannot render. Template editing must never block account mail.
func Render(subject, content string, data common.EmailTemplateData) (string, string) {
	if !knownKind(data.Type) {
		return subject, content
	}
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[common.EmailTemplateOptionKey]
	common.OptionMapRWMutex.RUnlock()
	snapshot.Lock()
	if !snapshot.ready || raw != snapshot.raw {
		snapshot.ready, snapshot.raw, snapshot.enabled = true, raw, false
		var settings Settings
		if raw != "" {
			if common.UnmarshalJsonStr(raw, &settings) != nil {
				common.SysError("email templates: invalid settings; using original email")
			} else if templates, err := compileSettings(settings); err != nil {
				common.SysError("email templates: invalid template; using original email")
			} else {
				snapshot.enabled, snapshot.templates = settings.Enabled, templates
			}
		}
	}
	enabled := snapshot.enabled
	lang := normalizeLanguage(data.Language)
	compiled := snapshot.templates[templateKey(data.Type, lang)]
	snapshot.Unlock()
	if !enabled {
		return subject, content
	}
	if compiled == nil {
		var err error
		compiled, err = compileTemplate(defaultTemplate(data.Type, lang))
		if err != nil {
			return subject, content
		}
	}
	values := make(map[string]string, len(data.Variables)+4)
	for key, value := range data.Variables {
		values[key] = value
	}
	values["site_name"], values["site_url"] = common.SystemName, system_setting.ServerAddress
	values["original_subject"], values["content"] = subject, content
	resultSubject, resultHTML, err := compiled.render(values)
	if err != nil {
		common.SysError("email templates: rendering failed; using original email")
		return subject, content
	}
	return resultSubject, resultHTML
}
