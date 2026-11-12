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
export type MonitorStatus =
  | 'healthy'
  | 'degraded'
  | 'unhealthy'
  | 'idle'
  | 'unknown'
  | 'disabled'

export type MonitorMetrics = {
  outcomes: number
  successes: number
  success_rate: number | null
  ttft_seconds: number | null
  tokens_per_second: number | null
  cache_hit_rate: number | null
  ttft_samples: number
  speed_samples: number
  cache_samples: number
  latency_seconds: number | null
  latency_samples: number
  fastest_ttft_seconds: number | null
  max_tokens_per_second: number | null
}

export type GroupPromotion = {
  enabled: boolean
  factor: number
  label: string
  starts_at: number
  ends_at: number
  daily_start: string
  daily_end: string
  timezone: string
}

export type MonitorGroupSettings = {
  group: string
  display_name: string
  description: string
  badge: string
  promotion: GroupPromotion | null
}

export type MonitorSettings = {
  revision: number
  enabled: boolean
  groups: MonitorGroupSettings[]
}

export type MonitorSettingsResponse = {
  settings: MonitorSettings
  available_groups: { group: string; ratio: number }[]
}

export type MonitorBucket = {
  start: number
  end: number
  status: MonitorStatus
  outcomes: number
  successes: number
  success_rate: number | null
}

export type MonitorGroup = MonitorGroupSettings &
  MonitorMetrics & {
    ratio: number
    base_ratio: number
    offer: {
      active: boolean
      factor: number
      label: string
      next_start: number
      ends_at: number
    }
    status: MonitorStatus
    timeline: MonitorBucket[]
    models: (MonitorMetrics & { model: string; enabled: boolean })[]
    sample_limited: boolean
    observed_from: number
  }

export type MonitorSnapshot = {
  enabled: boolean
  window: string
  updated_at: number
  refresh_seconds: number
  consume_logs_enabled: boolean
  error_logs_enabled: boolean
  sample_limit_per_group: number
  groups: MonitorGroup[]
  summary: MonitorMetrics
}
