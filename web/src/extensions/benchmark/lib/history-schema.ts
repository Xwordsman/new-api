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

export const reviewSchema = z
  .object({
    quality: z.enum(['', 'normal', 'suspected', 'abnormal']),
    reason: z
      .string()
      .trim()
      .max(500, 'Enter a reason (up to 500 characters).'),
  })
  .refine(
    (value) =>
      !['suspected', 'abnormal'].includes(value.quality) ||
      value.reason.length > 0,
    {
      path: ['reason'],
      message: 'Enter a reason (up to 500 characters).',
    }
  )

export type ReviewValues = z.infer<typeof reviewSchema>

export const cleanupSchema = z
  .object({ group: z.string().min(1), after: z.date(), before: z.date() })
  .refine(
    (value) =>
      value.before > value.after &&
      value.before.getTime() <= Date.now() &&
      value.before.getTime() - value.after.getTime() <= 90 * 86400000
  )

export type CleanupValues = z.infer<typeof cleanupSchema>
