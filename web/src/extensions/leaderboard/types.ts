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
export const boardIds = [
  'invitations',
  'income',
  'tokens',
  'savings',
  'cyber',
] as const
export type BoardId = (typeof boardIds)[number]
export type Period = 'today' | 'yesterday' | 'all'

export interface RankEntry {
  rank: number
  name: string
  value: number
  is_me: boolean
}

export interface LeaderboardSnapshot {
  enabled: boolean
  pending: boolean
  stale: boolean
  updated_at: number
  day_start: number
  refresh_minutes: number
  top_n: number
  warning_retention_days: number
  invitation_paid_only: boolean
  boards: Partial<Record<BoardId, Record<Period, RankEntry[]>>>
}

export interface LeaderboardSettings {
  revision: number
  enabled: boolean
  interval_minutes: number
  top_n: number
  invitations: boolean
  income: boolean
  tokens: boolean
  savings: boolean
  cyber: boolean
  mask_names: boolean
  exclude_admins: boolean
  excluded_user_ids: number[]
  invitation_paid_only: boolean
  warning_retention_days: number
  model_prefixes: string[]
  safety_codes: string[]
}

export interface SettingsResponse {
  settings: LeaderboardSettings
  updated_at: number
}
