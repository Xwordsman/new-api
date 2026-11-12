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

const invalid = 'Invalid referral parameters'
const reason = 'Enter a reason between 3 and 500 characters.'

export const referralSettingsSchema = z.object({
  enabled: z.boolean(),
  rate: z
    .number({ error: invalid })
    .min(0, invalid)
    .max(100, invalid)
    .refine(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
      invalid
    ),
  window_days: z
    .number({ error: invalid })
    .int(invalid)
    .min(1, invalid)
    .max(3650, invalid),
  cooling_hours: z
    .number({ error: invalid })
    .int(invalid)
    .min(0, invalid)
    .max(8760, invalid),
  cap_usd: z
    .number({ error: invalid })
    .min(0.01, invalid)
    .max(1_000_000, invalid),
  cny_per_usd: z
    .string()
    .max(32, invalid)
    .regex(/^\d+(\.\d+)?$/, invalid)
    .refine(
      (value) => Number(value) >= 0.01 && Number(value) <= 10000,
      invalid
    ),
})
export type ReferralSettingsValues = z.infer<typeof referralSettingsSchema>

export const referralActionSchema = z.object({
  trade_no: z.string().trim().min(1, invalid).max(255, invalid),
  amount: z
    .string()
    .max(48, invalid)
    .regex(/^\d+(\.\d+)?$/, invalid)
    .refine((value) => Number(value) <= 1_000_000_000, invalid),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, invalid),
  usd_per_unit: z
    .string()
    .max(32, invalid)
    .refine(
      (value) =>
        value === '' ||
        (/^\d+(\.\d+)?$/.test(value) &&
          Number(value) > 0 &&
          Number(value) <= 1_000_000),
      invalid
    ),
  reason: z.string().trim().min(3, reason).max(500, reason),
})
export type ReferralActionValues = z.infer<typeof referralActionSchema>
export const referralReviewSchema = z.object({
  reason: z.string().trim().min(3, reason).max(500, reason),
})
