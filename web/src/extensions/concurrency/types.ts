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
export type ConcurrencySettings = {
  revision: number
  enabled: boolean
  default_user_limit: number
  default_channel_limit: number
  default_key_limit: number
  queue_timeout_ms: number
  max_queued_per_user: number
  lease_seconds: number
  users: { user_id: number; limit: number }[]
  groups: { group: string; limit: number }[]
  channels: { channel_id: number; limit: number; key_limit: number }[]
}

export type Occupancy = {
  resource: string
  active: number
  limit: number
  admitted: number
  rejected: number
}

export type ConcurrencyStatus = {
  mode: 'redis' | 'memory'
  items: Occupancy[]
  max_items: number
}
