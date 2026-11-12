package benchmark

import (
	"errors"
	"math"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const settingsKey = "BenchmarkExtensionSettings"

var (
	errInvalid  = common.NewMessage("Invalid benchmark settings")
	errConflict = common.NewMessage("Benchmark settings changed. Reload before saving.")
)

type GroupSettings struct {
	Group           string `json:"group"`
	Model           string `json:"model"`
	Enabled         bool   `json:"enabled"`
	IntervalMinutes int    `json:"interval_minutes"`
	CandyEnabled    bool   `json:"candy_enabled"`
	SVGEnabled      bool   `json:"svg_enabled"`
}

type SVGPrompt struct {
	Name    string `json:"name"`
	Prompt  string `json:"prompt"`
	Enabled bool   `json:"enabled"`
}

type Settings struct {
	Revision        int64           `json:"revision"`
	Enabled         bool            `json:"enabled"`
	IntervalMinutes int             `json:"interval_minutes"`
	TimeoutSeconds  int             `json:"timeout_seconds"`
	CandyMaxTokens  int             `json:"candy_max_tokens"`
	SVGMaxTokens    int             `json:"svg_max_tokens"`
	RetentionDays   int             `json:"retention_days"`
	CandyPrompt     string          `json:"candy_prompt"`
	CandyAnswer     string          `json:"candy_answer"`
	SVGPrompts      []SVGPrompt     `json:"svg_prompts"`
	Groups          []GroupSettings `json:"groups"`
}

func defaultSettings() Settings {
	return Settings{
		IntervalMinutes: 60, TimeoutSeconds: 300, CandyMaxTokens: 4096, SVGMaxTokens: 16384, RetentionDays: 30,
		CandyPrompt: "在一个黑色的袋子里放有三种口味的糖果，每种糖果有两种不同的形状（圆形和五角星形）。摸取前可以用手感辨别形状并选择要取出的形状，但不能辨别口味；取出的糖果不放回。参赛者需要事先分别决定取多少颗圆形糖、多少颗五角星形糖。现已知数量如下表。最少取出多少颗糖果（两种形状的合计），才能保证手中有圆形苹果味和五角星桃子味的组合，或者圆形桃子味和五角星苹果味的组合？\n\n| 形状 | 苹果味 | 桃子味 | 西瓜味 |\n| 圆形 | 7 | 9 | 8 |\n| 五角星形 | 7 | 6 | 4 |\n\n请只返回最少糖果数，用一个阿拉伯数字回答，不要解释。",
		CandyAnswer: "21",
		SVGPrompts:  []SVGPrompt{{Name: "Octopus drummer", Enabled: true, Prompt: "创建一个 HTML，用 SVG 绘制一只章鱼打架子鼓的 2D 动画：章鱼有 8 条可辨的触手，分别握着鼓棒，同时敲击底鼓、军鼓、镲片等至少 5 件鼓组部件，敲击节奏要稳定循环，被击中的部件有震动或闪光反馈，章鱼头部随节拍轻微点动。所有样式与脚本内联，不引用外部资源。只返回完整单文件 HTML，必须包含 SVG；不要解释或 Markdown 围栏。"}},
		Groups:      []GroupSettings{},
	}
}

// Enabled reports the user-facing feature switch without running any checks.
func Enabled(db *gorm.DB) (bool, error) {
	settings, _, err := getSettings(db)
	return settings.Enabled, err
}

func getSettings(db *gorm.DB) (Settings, string, error) {
	settings := defaultSettings()
	var option model.Option
	err := db.Where(clause.Eq{Column: "key", Value: settingsKey}).Take(&option).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return settings, "", nil
	}
	if err != nil {
		return settings, "", err
	}
	err = common.UnmarshalJsonStr(option.Value, &settings)
	return settings, option.Value, err
}

func saveSettings(db *gorm.DB, settings Settings) (Settings, error) {
	if settings.Revision < 0 || settings.Revision == math.MaxInt64 || settings.IntervalMinutes < 5 || settings.IntervalMinutes > 10080 ||
		settings.TimeoutSeconds < 10 || settings.TimeoutSeconds > 600 || settings.RetentionDays < 1 || settings.RetentionDays > 90 ||
		settings.CandyMaxTokens < 16 || settings.CandyMaxTokens > 32768 || settings.SVGMaxTokens < 128 || settings.SVGMaxTokens > 32768 ||
		len(settings.Groups) > 24 || len(settings.SVGPrompts) > 24 {
		return settings, errInvalid
	}
	settings.CandyPrompt = strings.TrimSpace(settings.CandyPrompt)
	settings.CandyAnswer = strings.TrimSpace(settings.CandyAnswer)
	if settings.CandyPrompt == "" || len(settings.CandyPrompt) > 32000 || settings.CandyAnswer == "" || len(settings.CandyAnswer) > 1000 {
		return settings, errInvalid
	}
	seen := make(map[string]bool)
	for i := range settings.Groups {
		g := &settings.Groups[i]
		g.Model = strings.TrimSpace(g.Model)
		if g.Group == "" || utf8.RuneCountInString(g.Group) > 191 || g.Group == "auto" || seen[g.Group] || !ratio_setting.ContainsGroupRatio(g.Group) ||
			g.Model == "" || utf8.RuneCountInString(g.Model) > 200 || g.IntervalMinutes < 0 || g.IntervalMinutes > 10080 || (g.IntervalMinutes > 0 && g.IntervalMinutes < 5) ||
			(g.Enabled && !g.CandyEnabled && !g.SVGEnabled) {
			return settings, errInvalid
		}
		seen[g.Group] = true
	}
	activePrompts := 0
	for i := range settings.SVGPrompts {
		p := &settings.SVGPrompts[i]
		p.Name = strings.TrimSpace(p.Name)
		p.Prompt = strings.TrimSpace(p.Prompt)
		if p.Name == "" || utf8.RuneCountInString(p.Name) > 160 || p.Prompt == "" || len(p.Prompt) > 32000 {
			return settings, errInvalid
		}
		if p.Enabled {
			activePrompts++
		}
	}
	for _, g := range settings.Groups {
		if g.Enabled && g.SVGEnabled && activePrompts == 0 {
			return settings, errInvalid
		}
	}
	if settings.Groups == nil {
		settings.Groups = []GroupSettings{}
	}
	if settings.SVGPrompts == nil {
		settings.SVGPrompts = []SVGPrompt{}
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		initial, err := common.Marshal(defaultSettings())
		if err != nil {
			return err
		}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.Option{Key: settingsKey, Value: string(initial)}).Error; err != nil {
			return err
		}
		current, raw, err := getSettings(tx)
		if err != nil {
			return err
		}
		if current.Revision != settings.Revision {
			return errConflict
		}
		settings.Revision++
		encoded, err := common.Marshal(settings)
		if err != nil {
			return err
		}
		result := tx.Model(&model.Option{}).Where(clause.Eq{Column: "key", Value: settingsKey}).Where("value = ?", raw).Update("value", string(encoded))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errConflict
		}
		return nil
	})
	return settings, err
}

func (g GroupSettings) interval(s Settings) int64 {
	minutes := g.IntervalMinutes
	if minutes == 0 {
		minutes = s.IntervalMinutes
	}
	return int64(minutes) * 60
}
