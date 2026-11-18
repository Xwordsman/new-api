/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
export type BenchmarkGroupSettings = {
  group: string
  model: string
  enabled: boolean
  interval_minutes: number
  candy_enabled: boolean
  svg_enabled: boolean
  mode?: '' | 'local' | 'upstream'
  upstream_channel?: number
  upstream_group?: string
}

export type BenchmarkSettings = {
  revision: number
  enabled: boolean
  interval_minutes: number
  timeout_seconds: number
  history_hours: number
  candy_max_tokens: number
  svg_max_tokens: number
  retention_days: number
  candy_prompt: string
  candy_answer: string
  svg_prompts: { name: string; prompt: string; enabled: boolean }[]
  groups: BenchmarkGroupSettings[]
}

export type SettingsResponse = {
  settings: BenchmarkSettings
  available_groups: { group: string; models: string[] }[]
  upstream_channels?: {
    id: number
    name: string
    groups: string[]
    token_name: string
    token_configured: boolean
  }[]
}

export type RunStatus =
  | 'running'
  | 'passed'
  | 'wrong_answer'
  | 'invalid'
  | 'truncated'
  | 'request_failed'
  | 'timeout'
  | 'interrupted'
export type RunSummary = {
  id: number
  kind: 'candy' | 'svg'
  status: RunStatus
  created_at: number
  latency_ms: number
  prompt_name: string
  manual?: boolean
  source_run_id?: number
  root_run_id?: number
  quality?: '' | 'normal' | 'suspected' | 'abnormal'
  quality_reason?: string
  reviewed_at?: number
  origin?: string
  model?: string
}

export type BenchmarkRun = RunSummary & {
  group: string
  model: string
  prompt: string
  expected: string
  output: string
  error_code: string
  finished_at: number
  input_tokens: number
  output_tokens: number
  manual: boolean
  upstream_id?: number
  upstream_group?: string
  upstream_url?: string
  synced_at?: number
  versions?: RunSummary[]
}

export type Totals = {
  candy_total: number
  candy_passed: number
  svg_total: number
  svg_passed: number
  anomalies: number
  awaiting_review?: number
  manual_total?: number
}

export type HistorySelection = { group: string; after: number; before: number }
export type CleanupPreview = { ids: number[]; count: number }

export type BenchmarkGroup = BenchmarkGroupSettings & {
  interval_seconds: number
  next_at: number
  runs: RunSummary[]
  totals: Totals
  last_sync_at?: number
  upstream_at?: number
  sync_error?: string
  sync_stale?: boolean
}

export type Snapshot = {
  enabled: boolean
  updated_at: number
  refresh_seconds: number
  history_hours: number
  groups: BenchmarkGroup[]
  summary: Totals
}

export type Artworks = {
  items: (RunSummary & { group: string; model: string })[]
  total: number
  page: number
  page_size: number
}
