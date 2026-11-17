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
export type MemberReviewState = 'unreviewed' | 'watch' | 'cleared'
export type MemberProfile = {
  id: number
  username: string
  display_name: string
  email: string
  role: number
  status: number
  created_at: number
  last_login_at: number
  inviter_id: number
  remark: string
  qualification: string
  registration_ip: string
  registration_agent: string
  registration_source: string
  registered_at: number
  last_login_ip: string
  last_login_agent: string
  last_login_method: string
  last_seen_at: number
  note: string
  review_state: MemberReviewState | ''
  reviewed_at: number
  reviewer_id: number
  version: number
}
export type MemberPolicy = {
  revision: number
  capture_enabled: boolean
  retention_days: number
  lookback_days: number
  device_limit: number
  signup_ip_limit: number
  login_ip_limit: number
  network_limit: number
  inviter_limit: number
  payer_limit: number
  auto_analysis: boolean
  analysis_minutes: number
  alert_priority: number
}
export type MemberFilter = {
  page: number
  search: string
  review_state: string
  user_id?: number
}
export type MemberFinding = {
  user_id: number
  username: string
  coverage: 'unavailable' | 'partial'
  signal_count: number
  priority: number
  reward_paid: number
  reward_pending: number
  recommendation: string
  signals: {
    code: string
    count: number
    threshold: number
    related_ids: number[]
  }[]
  note: string
  review_state: MemberReviewState | ''
}
export type AnalysisResult = {
  status: 'idle' | 'pending' | 'running' | 'succeeded' | 'failed'
  summary: null | {
    total: number
    flagged: number
    insufficient: number
    review: number
    priority: number
    completed_at: number
    policy: MemberPolicy
  }
  items: MemberFinding[]
  total: number
  page?: number
}
