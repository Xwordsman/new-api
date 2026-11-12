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
export type { RegistrationSettings } from './lib/schema'
export type RecordKind = 'events' | 'accounts' | 'grants' | 'alerts' | 'audit'
export interface RiskRecord {
  id?: number
  user_id?: number
  inviter_id?: number
  actor_id?: number
  created_at: number
  state?: string
  action?: string
  stage?: string
  source?: string
  enforced?: boolean
  reasons?: string
  reason?: string
  domain?: string
  device_hash?: string
  network_hash?: string
  email_hash?: string
  revision?: number
  total?: number
  remaining?: number
  expires_at?: number
  kind?: string
  summary?: string
  summary_key?: string
  summary_params?: Record<string, number>
  delivered_at?: number
  next_attempt_at?: number
  attempts?: number
  last_error?: string
}
export interface Credit {
  enabled: boolean
  grant: RiskRecord | null
  models?: string[]
  rpm?: number
  concurrency?: number
}
export type RecordFilter = {
  kind: RecordKind
  page: number
  user_id: string
  state: string
  source: string
  device_hash?: string
  network_hash?: string
  email_hash?: string
}
