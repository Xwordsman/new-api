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
import type {
  CheckinDashboard,
  CheckinPayment,
  CheckinSettings,
} from '../types'

export const checkinSettings: CheckinSettings = {
  enabled: true,
  version: 1,
  threshold_amount: '50',
  currency: 'CNY',
  cny_per_usd: '7',
  recharge_mode: 'lifetime',
  lookback_days: 30,
  include_subscriptions: false,
  eligibility_days: 0,
  renew_on_recharge: true,
  reward_mode: 'fixed',
  reward_min_quota: 5_000,
  reward_max_quota: 5_000,
  monthly_cap_quota: 0,
  lifetime_cap_quota: 0,
  daily_budget_quota: 0,
  timezone: 'Asia/Shanghai',
  follow_registration_risk: true,
  require_turnstile: false,
}

export const checkinDashboard: CheckinDashboard = {
  enabled: true,
  today: '2026-11-12',
  month: '2026-11',
  timezone: 'Asia/Shanghai',
  next_reset_at: 1_794_499_200,
  verification_required: false,
  rules: checkinSettings,
  eligibility: {
    eligible: true,
    reason: '',
    qualified_amount: '50',
    remaining_amount: '0',
    currency: 'CNY',
    last_recharge_at: 1_794_369_600,
    expires_at: 0,
  },
  checked_in_today: false,
  claimable: true,
  claim_reason: '',
  stats: {
    total_checkins: 2,
    total_quota: 10_000,
    month_checkins: 1,
    month_quota: 5_000,
  },
  records: [{ checkin_date: '2026-11-11', quota_awarded: 5_000 }],
}

export const checkinPayment: CheckinPayment = {
  id: 1,
  user_id: 7,
  trade_no: 'payment-order-7',
  provider: 'stripe',
  reference: 'payment-reference-7',
  source: 'topup',
  origin: 'provider',
  amount: '50.123456',
  currency: 'CNY',
  refunded_amount: '10.1',
  cny_per_usd: '7',
  usd_per_unit: '',
  status: 'priced',
  historical: false,
  paid_at: 1_794_369_600,
  created_at: 1_794_369_600,
  updated_at: 1_794_369_600,
  reconciled_by: 0,
  reconcile_reason: '',
}
