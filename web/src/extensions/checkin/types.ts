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
export type CheckinSettings = {
  enabled: boolean
  version: number
  threshold_amount: string
  currency: 'CNY' | 'USD'
  cny_per_usd: string
  recharge_mode: 'lifetime' | 'rolling'
  lookback_days: number
  include_subscriptions: boolean
  eligibility_days: number
  renew_on_recharge: boolean
  reward_mode: 'fixed' | 'random'
  reward_min_quota: number
  reward_max_quota: number
  monthly_cap_quota: number
  lifetime_cap_quota: number
  daily_budget_quota: number
  timezone: string
  follow_registration_risk: boolean
  require_turnstile: boolean
}

export type CheckinRecord = {
  checkin_date: string
  quota_awarded: number
}

export type CheckinDashboard = {
  enabled: boolean
  today: string
  month: string
  timezone: string
  next_reset_at: number
  verification_required: boolean
  rules: CheckinSettings
  eligibility: {
    eligible: boolean
    reason: string
    qualified_amount: string
    remaining_amount: string
    currency: 'CNY' | 'USD'
    last_recharge_at: number
    expires_at: number
  }
  checked_in_today: boolean
  claimable: boolean
  claim_reason: string
  stats: {
    total_checkins: number
    total_quota: number
    month_checkins: number
    month_quota: number
  }
  records: CheckinRecord[]
}

export type CheckinAccount = {
  user_id: number
  username: string
  state: 'active' | 'paused'
  reason: string
  updated_at: number
  updated_by: number
  total_checkins: number
  total_quota: number
  last_checkin_at: number
}

export type CheckinAudit = {
  id: number
  actor_id: number
  user_id: number
  action: string
  detail: string
  reason: string
  created_at: number
}

export type CheckinPayment = {
  id: number
  user_id: number
  trade_no: string
  provider: string
  reference: string
  currency: string
  amount: string
  refunded_amount: string
  paid_at: number
  cny_per_usd: string
  usd_per_unit: string
  status: 'priced' | 'unpriced'
  source: 'topup' | 'subscription' | 'redemption'
  origin: 'provider' | 'admin' | 'redemption'
  historical: boolean
  created_at: number
  updated_at: number
  reconciled_by: number
  reconcile_reason: string
}

export type CheckinPage<T> = {
  items: T[]
  total: number
  page: number
  page_size: number
}

export type CheckinListParams = {
  p: number
  page_size: number
  user_id?: number
  state?: string
  action?: string
}
