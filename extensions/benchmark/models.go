package benchmark

import (
	"github.com/QuantumNous/new-api/model"
	"gorm.io/gorm"
)

// Run stores the prompt and answer used at execution time. Public projections
// deliberately exclude the sampled channel and system task identifiers.
type Run struct {
	ID            int64          `gorm:"primaryKey" json:"id"`
	GroupName     string         `gorm:"size:191;index:idx_benchmark_group_time,priority:1" json:"group"`
	Model         string         `gorm:"size:200" json:"model"`
	Kind          string         `gorm:"size:16" json:"kind"`
	PromptName    string         `gorm:"size:160" json:"prompt_name"`
	Prompt        string         `gorm:"type:text" json:"prompt"`
	Expected      string         `gorm:"type:text" json:"expected"`
	Output        model.LongText `json:"output"`
	Status        string         `gorm:"size:24;index:idx_benchmark_status" json:"status"`
	ErrorCode     string         `gorm:"size:40" json:"error_code"`
	ChannelID     int            `json:"-"`
	TaskID        string         `gorm:"size:64" json:"-"`
	Manual        bool           `json:"manual"`
	SourceRunID   int64          `gorm:"index:idx_benchmark_source" json:"source_run_id"`
	RootRunID     int64          `gorm:"index:idx_benchmark_root" json:"root_run_id"`
	Quality       string         `gorm:"size:16" json:"quality"`
	QualityReason string         `gorm:"type:text" json:"quality_reason"`
	ReviewedBy    int            `json:"-"`
	ReviewedAt    int64          `json:"reviewed_at"`
	RequestedBy   int            `json:"-"`
	CreatedAt     int64          `gorm:"index:idx_benchmark_group_time,priority:2;index:idx_benchmark_created" json:"created_at"`
	FinishedAt    int64          `json:"finished_at"`
	LatencyMS     int64          `json:"latency_ms"`
	InputTokens   int            `json:"input_tokens"`
	OutputTokens  int            `json:"output_tokens"`
}

// GroupState keeps scheduling and prompt rotation independent of history
// retention. The system-task lease serializes updates to these cursors.
type GroupState struct {
	GroupName   string `gorm:"size:191;primaryKey"`
	LastAutoAt  int64
	SVGSequence int64
}

func (GroupState) TableName() string { return "extension_benchmark_group_states" }

func Migrate(db *gorm.DB) error {
	if err := db.AutoMigrate(&Run{}, &GroupState{}, &HistoryAudit{}); err != nil {
		return err
	}
	// Old regenerations only stored their immediate parent. Resolve in creation
	// order so descendants keep a stable series even after a parent is deleted.
	var after int64
	for {
		var runs []Run
		if err := db.Select("id", "source_run_id").Where("id > ? AND source_run_id > 0 AND (root_run_id IS NULL OR root_run_id = 0)", after).Order("id").Limit(200).Find(&runs).Error; err != nil {
			return err
		}
		if len(runs) == 0 {
			return nil
		}
		for _, run := range runs {
			root := run.SourceRunID
			var parent Run
			if err := db.Select("id", "root_run_id").Where("id = ?", run.SourceRunID).Find(&parent).Error; err != nil {
				return err
			}
			if parent.RootRunID > 0 {
				root = parent.RootRunID
			}
			if err := db.Model(&Run{}).Where("id = ? AND (root_run_id IS NULL OR root_run_id = 0)", run.ID).Update("root_run_id", root).Error; err != nil {
				return err
			}
			after = run.ID
		}
	}
}

func (Run) TableName() string { return "extension_benchmark_runs" }

type RunSummary struct {
	ID            int64  `json:"id"`
	Kind          string `json:"kind"`
	Status        string `json:"status"`
	CreatedAt     int64  `json:"created_at"`
	LatencyMS     int64  `json:"latency_ms"`
	PromptName    string `json:"prompt_name"`
	Manual        bool   `json:"manual"`
	SourceRunID   int64  `json:"source_run_id"`
	RootRunID     int64  `json:"root_run_id"`
	Quality       string `json:"quality"`
	QualityReason string `json:"quality_reason"`
	ReviewedAt    int64  `json:"reviewed_at"`
}

func (r Run) summary() RunSummary {
	return RunSummary{ID: r.ID, Kind: r.Kind, Status: r.Status, CreatedAt: r.CreatedAt, LatencyMS: r.LatencyMS, PromptName: r.PromptName, Manual: r.Manual, SourceRunID: r.SourceRunID, RootRunID: r.RootRunID, Quality: r.Quality, QualityReason: r.QualityReason, ReviewedAt: r.ReviewedAt}
}

// HistoryAudit survives deletion of the output and records administrator actions
// without retaining model output, prompts, or credentials.
type HistoryAudit struct {
	ID         int64 `gorm:"primaryKey"`
	ActorID    int
	RunID      int64 `gorm:"index"`
	RootRunID  int64
	GroupName  string `gorm:"size:191"`
	Action     string `gorm:"size:24"`
	OldQuality string `gorm:"size:16"`
	NewQuality string `gorm:"size:16"`
	Reason     string `gorm:"type:text"`
	CreatedAt  int64  `gorm:"index"`
}

func (HistoryAudit) TableName() string { return "extension_benchmark_history_audits" }

func (r Run) seriesID() int64 {
	if r.RootRunID > 0 {
		return r.RootRunID
	}
	return r.ID
}

const summaryColumns = "id, kind, status, created_at, latency_ms, prompt_name, manual, source_run_id, root_run_id, quality, quality_reason, reviewed_at"
