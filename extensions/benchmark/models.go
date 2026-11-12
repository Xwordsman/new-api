package benchmark

import (
	"github.com/QuantumNous/new-api/model"
	"gorm.io/gorm"
)

// Run stores the prompt and answer used at execution time. Public projections
// deliberately exclude the sampled channel and system task identifiers.
type Run struct {
	ID           int64          `gorm:"primaryKey" json:"id"`
	GroupName    string         `gorm:"size:191;index:idx_benchmark_group_time,priority:1" json:"group"`
	Model        string         `gorm:"size:200" json:"model"`
	Kind         string         `gorm:"size:16" json:"kind"`
	PromptName   string         `gorm:"size:160" json:"prompt_name"`
	Prompt       string         `gorm:"type:text" json:"prompt"`
	Expected     string         `gorm:"type:text" json:"expected"`
	Output       model.LongText `json:"output"`
	Status       string         `gorm:"size:24;index:idx_benchmark_status" json:"status"`
	ErrorCode    string         `gorm:"size:40" json:"error_code"`
	ChannelID    int            `json:"-"`
	TaskID       string         `gorm:"size:64" json:"-"`
	Manual       bool           `json:"manual"`
	CreatedAt    int64          `gorm:"index:idx_benchmark_group_time,priority:2;index:idx_benchmark_created" json:"created_at"`
	FinishedAt   int64          `json:"finished_at"`
	LatencyMS    int64          `json:"latency_ms"`
	InputTokens  int            `json:"input_tokens"`
	OutputTokens int            `json:"output_tokens"`
}

// GroupState keeps scheduling and prompt rotation independent of history
// retention. The system-task lease serializes updates to these cursors.
type GroupState struct {
	GroupName   string `gorm:"size:191;primaryKey"`
	LastAutoAt  int64
	SVGSequence int64
}

func (GroupState) TableName() string { return "extension_benchmark_group_states" }

func Migrate(db *gorm.DB) error { return db.AutoMigrate(&Run{}, &GroupState{}) }

func (Run) TableName() string { return "extension_benchmark_runs" }

type RunSummary struct {
	ID         int64  `json:"id"`
	Kind       string `json:"kind"`
	Status     string `json:"status"`
	CreatedAt  int64  `json:"created_at"`
	LatencyMS  int64  `json:"latency_ms"`
	PromptName string `json:"prompt_name"`
}

func (r Run) summary() RunSummary {
	return RunSummary{ID: r.ID, Kind: r.Kind, Status: r.Status, CreatedAt: r.CreatedAt, LatencyMS: r.LatencyMS, PromptName: r.PromptName}
}
