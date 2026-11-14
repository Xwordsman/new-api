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

export const promotionSchema = z
  .object({
    enabled: z.boolean(),
    ratio: z
      .number({
        error: 'Enter a positive discounted multiplier.',
      })
      .gt(0, 'Enter a positive discounted multiplier.'),
    label: z.string().trim().max(80, 'Invalid group pricing settings'),
    starts_at: z.number().int().min(0).max(253402300799),
    ends_at: z.number().int().min(0).max(253402300799),
    daily_start: z
      .string()
      .regex(/^$|^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm for daily times.'),
    daily_end: z
      .string()
      .regex(/^$|^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm for daily times.'),
    timezone: z
      .string()
      .trim()
      .refine((value) => {
        if (!value) return true
        try {
          new Intl.DateTimeFormat('en', { timeZone: value })
          return true
        } catch {
          return false
        }
      }, 'Enter a valid IANA time zone.'),
  })
  .superRefine((rule, context) => {
    if (rule.ends_at > 0 && rule.starts_at >= rule.ends_at) {
      context.addIssue({
        code: 'custom',
        path: ['ends_at'],
        message: 'Offer end must be after its start.',
      })
    }
    if (
      Boolean(rule.daily_start) !== Boolean(rule.daily_end) ||
      (rule.daily_start !== '' && rule.daily_start === rule.daily_end)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['daily_end'],
        message:
          'Enter both daily times and use different start and end times.',
      })
    }
  })

export const promotionsSchema = z.object({
  revision: z.number().int().nonnegative(),
  groups: z
    .array(
      z.object({
        group: z.string().min(1),
        promotion: promotionSchema.nullable(),
      })
    )
    .max(1024),
})
export type PromotionForm = z.infer<typeof promotionsSchema>
