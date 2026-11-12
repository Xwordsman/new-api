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

import type { LeaderboardSettings } from '../types'

const invalid = 'Invalid leaderboard settings'
const integer = (min: number, max: number) =>
  z.number({ error: invalid }).int(invalid).min(min, invalid).max(max, invalid)
export const splitList = (text: string): string[] =>
  text
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean)
const codes = (max: number) =>
  z.string().refine((text) => {
    const values = splitList(text)
    return (
      values.length <= max &&
      values.every((value) => value.length <= 100 && !/[\s*]/.test(value))
    )
  }, invalid)

export const leaderboardSettingsSchema = z
  .object({
    revision: integer(0, Number.MAX_SAFE_INTEGER - 1),
    enabled: z.boolean(),
    interval_minutes: integer(1, 1440),
    top_n: integer(4, 50),
    invitations: z.boolean(),
    income: z.boolean(),
    tokens: z.boolean(),
    savings: z.boolean(),
    cyber: z.boolean(),
    mask_names: z.boolean(),
    exclude_admins: z.boolean(),
    invitation_paid_only: z.boolean(),
    warning_retention_days: integer(1, 3650),
    excluded_users: z.string().refine((text) => {
      const values = splitList(text)
      return (
        values.length <= 500 &&
        values.every(
          (value) =>
            /^\d+$/.test(value) &&
            Number.isSafeInteger(Number(value)) &&
            Number(value) > 0
        )
      )
    }, invalid),
    model_prefixes_text: codes(50),
    safety_codes_text: codes(100),
  })
  .superRefine((value, ctx) => {
    if (!value.cyber) return
    for (const key of ['model_prefixes_text', 'safety_codes_text'] as const) {
      if (splitList(value[key]).length === 0) {
        ctx.addIssue({ code: 'custom', path: [key], message: invalid })
      }
    }
  })

export type SettingsFormValues = z.infer<typeof leaderboardSettingsSchema>

export function settingsToForm(
  settings: LeaderboardSettings
): SettingsFormValues {
  const { excluded_user_ids, model_prefixes, safety_codes, ...rest } = settings
  return {
    ...rest,
    excluded_users: excluded_user_ids.join(', '),
    model_prefixes_text: model_prefixes.join('\n'),
    safety_codes_text: safety_codes.join('\n'),
  }
}
