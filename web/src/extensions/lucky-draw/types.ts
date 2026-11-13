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
export type Prize = {
  id: string
  name: string
  kind: 'credit' | 'none'
  quota: number
  weight: number
  stock: number
  color: string
}

export type DrawSettings = {
  version: number
  enabled: boolean
  threshold_amount: string
  currency: 'CNY' | 'USD'
  recharge_mode: 'lifetime' | 'rolling'
  lookback_days: number
  include_subscriptions: boolean
  eligibility_days: number
  renew_on_recharge: boolean
  daily_attempts: number
  timezone: string
  starts_at: number
  ends_at: number
  allowed_groups: string
  daily_budget_quota: number
  total_budget_quota: number
  user_cap_quota: number
  follow_registration_risk: boolean
  require_turnstile: boolean
  show_winners: boolean
  prizes: Prize[]
}

export type DrawAccount = {
  user_id: number
  state: 'active' | 'paused'
  reason: string
  updated_by: number
  updated_at: number
  attempts: number
  next_reset_at: number
  total_draws: number
  total_quota: number
}
export type DrawRecord = {
  id: number
  user_id: number
  request_key: string
  prize_id: string
  prize_name: string
  quota_awarded: number
  created_at: number
  settings_version: number
}
export type DrawResult = {
  record: DrawRecord
  prizes: Prize[]
  replay: boolean
}
export type DrawDashboard = {
  rules: DrawSettings
  account: DrawAccount
  qualified_amount: string
  remaining_amount: string
  expires_at: number
  remaining_attempts: number
  reason: string
  drawable: boolean
  verification_required: boolean
}
export type DrawAudit = {
  id: number
  actor_id: number
  user_id: number
  action: string
  detail: string
  created_at: number
}
export type DrawSummary = {
  pool: { daily_quota: number; total_quota: number; total_draws: number }
  stock: { prize_id: string; awarded: number }[]
}
export type Winner = {
  id: number
  participant: string
  prize_name: string
  quota_awarded: number
  created_at: number
}
