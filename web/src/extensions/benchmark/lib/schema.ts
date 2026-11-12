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

const invalid = 'Invalid benchmark settings'
const integer = (min: number, max: number) =>
  z.number({ error: invalid }).int(invalid).min(min, invalid).max(max, invalid)
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1, invalid)
    .refine((value) => [...value].length <= max, invalid)
const prompt = z
  .string()
  .trim()
  .min(1, invalid)
  .refine((value) => new TextEncoder().encode(value).length <= 32000, invalid)

export const benchmarkSettingsSchema = z
  .object({
    revision: integer(0, Number.MAX_SAFE_INTEGER),
    enabled: z.boolean(),
    interval_minutes: integer(5, 10080),
    timeout_seconds: integer(10, 600),
    candy_max_tokens: integer(16, 32768),
    svg_max_tokens: integer(128, 32768),
    retention_days: integer(1, 90),
    candy_prompt: prompt,
    candy_answer: z
      .string()
      .trim()
      .min(1, invalid)
      .refine(
        (value) => new TextEncoder().encode(value).length <= 1000,
        invalid
      ),
    svg_prompts: z
      .array(z.object({ name: text(160), prompt, enabled: z.boolean() }))
      .max(24, invalid),
    groups: z
      .array(
        z
          .object({
            group: text(191),
            model: text(200),
            enabled: z.boolean(),
            interval_minutes: integer(0, 10080).refine(
              (value) => value === 0 || value >= 5,
              invalid
            ),
            candy_enabled: z.boolean(),
            svg_enabled: z.boolean(),
          })
          .refine((g) => !g.enabled || g.candy_enabled || g.svg_enabled, {
            message: invalid,
            path: ['candy_enabled'],
          })
      )
      .max(24, invalid),
  })
  .superRefine((s, ctx) => {
    const seen = new Set<string>()
    s.groups.forEach((g, index) => {
      if (g.group === 'auto' || seen.has(g.group)) {
        ctx.addIssue({
          code: 'custom',
          path: ['groups', index, 'group'],
          message: invalid,
        })
      }
      seen.add(g.group)
    })
    if (
      s.groups.some((g) => g.enabled && g.svg_enabled) &&
      !s.svg_prompts.some((p) => p.enabled)
    ) {
      ctx.addIssue({ code: 'custom', path: ['svg_prompts'], message: invalid })
    }
  })
