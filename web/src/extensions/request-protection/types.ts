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
  rule_id: string
  name: string
  source: string
  action: string
  high_confidence: boolean
  count_penalty: boolean
}
export type ProtectionVerdict = {
  hits: ProtectionHit[]
  decision: string
  eligible: boolean
  digest: string
  uninspected: string
}
export type ProtectionEvent = {
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
export type ProtectionRestriction = {
  id: string
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
