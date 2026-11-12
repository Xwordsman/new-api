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
export type ReferralSettings = {
  enabled: boolean
  rate_bps: number
  window_days: number
  cooling_hours: number
  cap_quota: number
  cny_per_usd: string
  version: number
  started_at: number
}

export type ReferralDashboard = {
  settings: ReferralSettings
  account: {
    user_id: number
    balance: number
    debt: number
    earned: number
    transferred: number
  }
  invited: number
  paying: number
  pending: number
  review: number
  claimable: number
  code: string
  server_time: number
}

export type Invitee = {
  id: number
  user_id: number
  inviter_id: number
  username: string
  registered_at: number
  expires_at: number
  rate_bps: number
  cap_quota: number
  cooling_hours: number
  settings_version: number
  state: string
  reason: string
  reserved: number
  historical: boolean
  reviewed_at: number
  net_paid: number
  earned: number
  pending: number
}

export type ReferralReward = {
  id: number
  trade_no: string
  provider: string
  user_id: number
  paid_quota: number
  refunded_quota: number
  amount: string
  currency: string
  rate_bps: number
  quota: number
  reversed: number
  offset: number
  paid_at: number
  available_at: number
  claimed_at: number
  state: string
  historical: boolean
  qualification: string
}

export type ReferralTransfer = {
  id: number
  request_id: string
  quota: number
  offset: number
  created_at: number
}
export type ReferralAudit = {
  id: number
  actor_id: number
  user_id: number
  action: string
  detail: string
  created_at: number
}
export type ReferralPage<T> = { items: T[]; total: number }
export type ReferralListParams = {
  p: number
  page_size: number
  state?: string
  historical?: boolean
  user_id?: number
}
