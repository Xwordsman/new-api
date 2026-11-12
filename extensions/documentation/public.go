package documentationcenter

import (
	"cmp"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
)

type ArticleMetadata struct {
	ID          string `json:"id"`
	CategoryID  string `json:"category_id"`
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	Description string `json:"description"`
	SortOrder   int    `json:"sort_order"`
	UpdatedAt   int64  `json:"updated_at"`
}

func (a Article) metadata() ArticleMetadata {
	return ArticleMetadata{ID: a.ID, CategoryID: a.CategoryID, Slug: a.Slug, Title: a.Title, Description: a.Description, SortOrder: a.SortOrder, UpdatedAt: a.UpdatedAt}
}

// publishedSettings is the single publication boundary shared by search,
// downloads and the website. Drafts never enter any public representation.
func publishedSettings(c *gin.Context) (Settings, map[string]string, bool) {
	c.Header("Cache-Control", "no-store")
	s, _, err := readSettings(model.DB.WithContext(c.Request.Context()))
	if err != nil {
		respond(c, nil, err)
		return Settings{}, nil, false
	}
	if !s.Enabled {
		common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Documentation center is unavailable"))
		return Settings{}, nil, false
	}
	// Use the administrator's configured origin, never a request Host header.
	siteURL := strings.TrimRight(strings.TrimSpace(system_setting.ServerAddress), "/")
	u, err := url.Parse(siteURL)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Scheme != "http" && u.Scheme != "https" {
		siteURL = ""
	}
	variables := map[string]string{"site_name": common.SystemName, "site_url": siteURL, "api_base_url": siteURL + "/v1"}
	replacer := strings.NewReplacer("{{site_name}}", variables["site_name"], "{{site_url}}", variables["site_url"], "{{api_base_url}}", variables["api_base_url"])
	s.Title, s.Description = replacer.Replace(s.Title), replacer.Replace(s.Description)
	categoriesWithArticles := map[string]bool{}
	articles := make([]Article, 0, len(s.Articles))
	for _, article := range s.Articles {
		if article.Status != "published" {
			continue
		}
		article.Title = replacer.Replace(article.Title)
		article.Description = replacer.Replace(article.Description)
		article.Content = replacer.Replace(article.Content)
		articles = append(articles, article)
		categoriesWithArticles[article.CategoryID] = true
	}
	categories := make([]Category, 0, len(s.Categories))
	for _, category := range s.Categories {
		if categoriesWithArticles[category.ID] {
			category.Title = replacer.Replace(category.Title)
			category.Description = replacer.Replace(category.Description)
			categories = append(categories, category)
		}
	}
	slices.SortFunc(categories, func(a, b Category) int {
		if order := cmp.Compare(a.SortOrder, b.SortOrder); order != 0 {
			return order
		}
		return strings.Compare(a.ID, b.ID)
	})
	categoryOrder := make(map[string]int, len(categories))
	for i, category := range categories {
		categoryOrder[category.ID] = i
	}
	slices.SortFunc(articles, func(a, b Article) int {
		if order := cmp.Compare(categoryOrder[a.CategoryID], categoryOrder[b.CategoryID]); order != 0 {
			return order
		}
		if order := cmp.Compare(a.SortOrder, b.SortOrder); order != 0 {
			return order
		}
		return strings.Compare(a.Slug, b.Slug)
	})
	s.Categories, s.Articles = categories, articles
	return s, variables, true
}

func getCatalog(c *gin.Context) {
	s, variables, ok := publishedSettings(c)
	if !ok {
		return
	}
	articles := make([]ArticleMetadata, 0, len(s.Articles))
	for _, article := range s.Articles {
		articles = append(articles, article.metadata())
	}
	common.ApiSuccess(c, gin.H{"title": s.Title, "description": s.Description, "categories": s.Categories, "articles": articles, "variables": variables})
}

func getArticle(c *gin.Context) {
	s, variables, ok := publishedSettings(c)
	if !ok {
		return
	}
	for i, article := range s.Articles {
		if article.Slug != c.Param("slug") {
			continue
		}
		var previous, next *ArticleMetadata
		if i > 0 {
			metadata := s.Articles[i-1].metadata()
			previous = &metadata
		}
		if i+1 < len(s.Articles) {
			metadata := s.Articles[i+1].metadata()
			next = &metadata
		}
		common.ApiSuccess(c, gin.H{"article": article, "previous": previous, "next": next, "variables": variables})
		return
	}
	common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Documentation article not found"))
}

func downloadMarkdown(c *gin.Context) {
	s, _, ok := publishedSettings(c)
	if !ok {
		return
	}
	for _, article := range s.Articles {
		if article.Slug == c.Param("slug") {
			c.Header("X-Content-Type-Options", "nosniff")
			c.Header("Content-Disposition", `attachment; filename="`+article.Slug+`.md"`)
			c.Data(http.StatusOK, "text/plain; charset=utf-8", []byte(article.Content))
			return
		}
	}
	common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Documentation article not found"))
}

// ExportLLMs also serves the root /llms-full.txt alias. It performs its own
// feature/publication checks, so mounting the alias cannot expose drafts.
func ExportLLMs(c *gin.Context) {
	s, variables, ok := publishedSettings(c)
	if !ok {
		return
	}
	var text strings.Builder
	text.WriteString("# " + s.Title + "\n\n" + s.Description + "\n")
	for _, article := range s.Articles {
		text.WriteString("\n---\n\n# " + article.Title + "\n\n")
		text.WriteString("Source: " + variables["site_url"] + "/docs/guides/" + article.Slug + "\n\n")
		text.WriteString(article.Content)
		text.WriteString("\n")
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, "text/plain; charset=utf-8", []byte(text.String()))
}

func searchArticles(c *gin.Context) {
	s, _, ok := publishedSettings(c)
	if !ok {
		return
	}
	query := strings.TrimSpace(c.Query("q"))
	terms := strings.Fields(strings.ToLower(query))
	if utf8.RuneCountInString(query) > 120 || len(terms) > 10 {
		respond(c, nil, common.NewMessage("Invalid documentation search query"))
		return
	}
	type result struct {
		ArticleMetadata
		Excerpt string `json:"excerpt"`
		score   int
	}
	results := []result{}
	if len(terms) == 0 {
		common.ApiSuccess(c, results)
		return
	}
	for _, article := range s.Articles {
		title, description, content := strings.ToLower(article.Title), strings.ToLower(article.Description), strings.ToLower(article.Content)
		score, matches := 0, true
		for _, term := range terms {
			titleMatch, descriptionMatch, contentMatch := strings.Contains(title, term), strings.Contains(description, term), strings.Contains(content, term)
			if !titleMatch && !descriptionMatch && !contentMatch {
				matches = false
				break
			}
			if titleMatch {
				score += 6
			}
			if descriptionMatch {
				score += 3
			}
			if contentMatch {
				score++
			}
		}
		if !matches {
			continue
		}
		excerpt := strings.Join(strings.Fields(article.Content), " ")
		lowerExcerpt := strings.ToLower(excerpt)
		start := 0
		for _, term := range terms {
			if at := strings.Index(lowerExcerpt, term); at >= 0 {
				start = max(0, utf8.RuneCountInString(lowerExcerpt[:at])-60)
				break
			}
		}
		runes := []rune(excerpt)
		end := min(start+240, len(runes))
		excerpt = string(runes[start:end])
		if start > 0 {
			excerpt = "…" + excerpt
		}
		if end < len(runes) {
			excerpt += "…"
		}
		results = append(results, result{ArticleMetadata: article.metadata(), Excerpt: excerpt, score: score})
	}
	slices.SortStableFunc(results, func(a, b result) int { return cmp.Compare(b.score, a.score) })
	common.ApiSuccess(c, results[:min(len(results), 30)])
}
