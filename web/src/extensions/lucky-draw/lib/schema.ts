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

import type { DrawSettings } from '../types'

const integer = z
  .number({ error: 'Enter a valid number' })
  .int('Enter a whole number')
const quota = integer
  .min(0, 'Enter a non-negative amount')
  .max(Number.MAX_SAFE_INTEGER, 'Amount is too large')
export const drawSettingsSchema = z
  .object({
    version: integer
      .min(1, 'Enter a valid number')
      .max(2147483646, 'Enter a valid number'),
    enabled: z.boolean(),
    threshold_amount: z
      .string()
      .regex(/^(0|[1-9]\d{0,12})(\.\d{1,6})?$/, 'Enter a valid amount')
      .refine((v) => Number(v) <= 1e12, 'Amount is too large'),
    currency: z.enum(['CNY', 'USD']),
    recharge_mode: z.enum(['lifetime', 'rolling']),
    lookback_days: integer
      .min(1, 'Enter a valid number')
      .max(3650, 'Enter a valid number'),
    include_subscriptions: z.boolean(),
    eligibility_days: integer
      .min(0, 'Enter a valid number')
      .max(3650, 'Enter a valid number'),
    renew_on_recharge: z.boolean(),
    daily_attempts: integer
      .min(1, 'Enter a valid number')
      .max(100, 'Enter a valid number'),
    timezone: z
      .string()
      .min(1, 'Enter a valid IANA time zone')
      .max(64, 'Enter a valid IANA time zone')
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value })
          return value !== 'Local'
        } catch {
          return false
        }
      }, 'Enter a valid IANA time zone'),
    starts_at: integer
      .min(0, 'Enter a valid number')
      .max(253402214400, 'Enter a valid number'),
    ends_at: integer
      .min(0, 'Enter a valid number')
      .max(253402214400, 'Enter a valid number'),
    allowed_groups: z
      .string()
      .refine(
        (v) => new TextEncoder().encode(v).length <= 2000,
        'Invalid lucky draw parameters'
      ),
    daily_budget_quota: quota,
    total_budget_quota: quota,
    user_cap_quota: quota,
    follow_registration_risk: z.boolean(),
    require_turnstile: z.boolean(),
    show_winners: z.boolean(),
    prizes: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9_-]{1,40}$/, 'Invalid prize ID'),
            name: z
              .string()
              .trim()
              .min(1, 'Prize name is required')
              .refine((v) => [...v].length <= 100, 'Prize name is too long'),
            kind: z.enum(['credit', 'none']),
            quota,
            weight: integer
              .min(0, 'Enter a valid number')
              .max(1_000_000, 'Enter a valid number'),
            stock: integer
              .min(0, 'Enter a valid number')
              .max(1_000_000_000, 'Enter a valid number'),
            color: z
              .string()
              .regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color'),
          })
          .refine(
            (p) =>
              p.kind === 'credit'
                ? p.quota > 0
                : p.quota === 0 && p.stock === 0,
            { message: 'Check the prize amount and stock', path: ['quota'] }
          )
      )
      .min(6, 'Invalid lucky draw parameters')
      .max(8, 'Invalid lucky draw parameters'),
  })
  .superRefine((s, ctx) => {
    if (s.ends_at > 0 && s.ends_at <= s.starts_at) {
      ctx.addIssue({
        code: 'custom',
        path: ['ends_at'],
        message: 'End time must follow start time',
      })
    }
    if (s.prizes.reduce((sum, p) => sum + p.weight, 0) !== 1_000_000) {
      ctx.addIssue({
        code: 'custom',
        path: ['prizes'],
        message: 'Prize probabilities must total exactly 100%',
      })
    }
    if (new Set(s.prizes.map((p) => p.id)).size !== s.prizes.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['prizes'],
        message: 'Prize IDs must be unique',
      })
    }
    if (!s.prizes.some((p) => p.kind === 'credit' && p.weight > 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['prizes'],
        message: 'At least one credit prize needs a positive probability',
      })
    }
    if (
      s.allowed_groups &&
      s.allowed_groups
        .split(',')
        .some((g) => !g || g !== g.trim() || [...g].length > 64)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['allowed_groups'],
        message: 'Use comma-separated group names without spaces',
      })
    }
  }) satisfies z.ZodType<DrawSettings>

export const reviewSchema = z.object({
  user_id: integer.positive('Enter a valid user ID'),
  state: z.enum(['active', 'paused']),
  reason: z
    .string()
    .trim()
    .refine(
      (v) => [...v].length >= 3 && [...v].length <= 500,
      'Enter a reason with 3 to 500 characters'
    ),
})
