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
import { z } from 'zod'

export const settingsSchema = z.object({
  revision: z.number().int().nonnegative(),
  enabled: z.boolean(),
  default_protect: z.boolean(),
  allow_opt_out: z.boolean(),
  legacy_mode: z.enum(['ignore', 'confirm']),
  increase_percent: z.number().min(0).max(100),
  quote_ttl_seconds: z.number().int().min(60).max(900),
})

export type PriceSettings = z.infer<typeof settingsSchema>
export type PriceState = {
  token_id: number
  user_id: number
  version: number
  protected: boolean
  paused: boolean
  accepted_at: number
  paused_at: number
  reason: string
  group: string
  previous_ratio: number
  current_ratio: number
}
export type PriceEvent = {
  id: number
  token_id: number
  user_id: number
  actor_id: number
  created_at: number
  action: string
  reason: string
  group: string
  previous_ratio: number
  current_ratio: number
  revision: number
}
export type PriceStatuses = { settings: PriceSettings; states: PriceState[] }
export type PriceDetail = {
  settings: PriceSettings
  state: PriceState
  tracked: boolean
  accepted: Record<string, number> | null
  current: Record<string, number>
  events: PriceEvent[]
}
export type PriceQuote = {
  quote: string
  rates: Record<string, number>
  expires_at: number
  settings: PriceSettings
  protected: boolean
}
