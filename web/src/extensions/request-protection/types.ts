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
export type ProtectionRule = {
  id: string
  name: string
  enabled: boolean
  kind: 'any' | 'all' | 'regex'
  patterns: string[]
  sources: string[]
  action: 'observe' | 'block'
  high_confidence: boolean
  count_penalty: boolean
}
export type ProtectionSettings = {
  channel_ids: number[]
  categories: {
    jailbreak: boolean
    theft: boolean
    attack: boolean
    sexual: boolean
  }
  reviewer: {
    enabled: boolean
    channel_id: number
    model: string
    timeout_seconds: number
    failure_action: 'observe' | 'block'
  }
  store_evidence: boolean
  automatic_suspend: boolean
  revision: number
  enabled: boolean
  mode: 'observe' | 'enforce'
  groups: string[]
  models: string[]
  protocols: string[]
  exempt_user_ids: number[]
  max_body_bytes: number
  max_text_bytes: number
  uninspected_action: 'allow' | 'observe' | 'block'
  require_complete_text: boolean
  upstream_action: 'observe' | 'hold_user'
  fail_closed: boolean
  rules: ProtectionRule[]
  window_minutes: number
  key_threshold: number
  key_suspend_minutes: number
  user_threshold: number
  user_suspend_minutes: number
  duplicate_seconds: number
  retention_days: number
  upstream_codes: string[]
  alert_enabled: boolean
  alert_emails: string[]
  alert_minutes: number
  alert_threshold: number
}
export type ProtectionHit = {
  category?: string
  evidence?: string
  rule_id: string
  name: string
  source: string
  action: string
  high_confidence: boolean
  count_penalty: boolean
}
export type ProtectionVerdict = {
  finding: string
  reason: string
  hits: ProtectionHit[]
  decision: string
  eligible: boolean
  digest: string
  uninspected: string
}
export type ProtectionEvent = {
  channel_id: number
  channel_name: string
  username: string
  token_name: string
  ip: string
  finding: string
  reason: string
  id: number
  request_id: string
  user_id: number
  token_id: number
  created_at: number
  revision: number
  group: string
  model: string
  protocol: string
  decision: string
  digest: string
  counted: boolean
  review: string
  uninspected: string
  upstream: string
  matches: ProtectionHit[]
}
export type ProtectionChannel = {
  id: number
  name: string
  type: number
  models: string
}
export type ProtectionRestriction = {
  id: string
  group: string
  manual_review: boolean
  user_id: number
  token_id: number
  until: number
  started_at: number
  cause_event_id: number
  threshold: number
  window_minutes: number
}
export type ProtectionAudit = {
  id: number
  actor_id: number
  created_at: number
  action: string
  event_id: number
  subject_id: string
  note: string
  revision: number
}
export type ProtectionPage<T> = { items: T[]; total: number; page: number }
export type EventFilters = {
  user_id: string
  token_id: string
  decision: string
  review: string
}
