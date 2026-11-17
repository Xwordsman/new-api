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

const days = z.number().int().min(1).max(3650)
const threshold = z
  .number()
  .int()
  .refine(
    (n) => n === 0 || (n >= 2 && n <= 100000),
    'Use 0 to disable, or a threshold between 2 and 100000.'
  )
export const memberPolicySchema = z.object({
  revision: z.number().int().nonnegative(),
  capture_enabled: z.boolean(),
  retention_days: days,
  lookback_days: days,
  device_limit: threshold,
  signup_ip_limit: threshold,
  login_ip_limit: threshold,
  network_limit: threshold,
  inviter_limit: threshold,
  payer_limit: threshold,
  auto_analysis: z.boolean(),
  analysis_minutes: z.number().int().min(5).max(10080),
  alert_priority: z.number().int().min(0).max(3),
})
export const memberReviewSchema = z
  .object({
    version: z.number().int().nonnegative(),
    state: z.enum(['unreviewed', 'watch', 'cleared']),
    note: z.string().trim().max(500),
  })
  .refine((v) => v.state === 'unreviewed' || v.note.length > 0, {
    path: ['note'],
    message: 'Enter a review note.',
  })
