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

export const decimalAmount = z
  .string({ error: 'Enter a valid amount' })
  .trim()
  .regex(
    /^(0|[1-9]\d*)(\.\d{1,6})?$/,
    'Enter a non-negative amount with up to six decimal places'
  )

export const checkinSettingsSchema = z
  .object({
    enabled: z.boolean(),
    threshold_amount: decimalAmount,
    currency: z.enum(['CNY', 'USD']),
    cny_per_usd: decimalAmount.refine(
      (value) => Number(value) >= 0.01 && Number(value) <= 10000,
      'CNY per USD must be between 0.01 and 10000'
    ),
    recharge_mode: z.enum(['lifetime', 'rolling']),
    lookback_days: z
      .number({ error: 'Enter a whole number from 1 to 3650' })
      .int('Enter a whole number from 1 to 3650')
      .min(1, 'Enter a whole number from 1 to 3650')
      .max(3650, 'Enter a whole number from 1 to 3650'),
    include_subscriptions: z.boolean(),
    eligibility_days: z
      .number({ error: 'Enter a whole number from 0 to 3650' })
      .int('Enter a whole number from 0 to 3650')
      .min(0, 'Enter a whole number from 0 to 3650')
      .max(3650, 'Enter a whole number from 0 to 3650'),
    renew_on_recharge: z.boolean(),
    reward_mode: z.enum(['fixed', 'random']),
    reward_min_usd: z
      .number({ error: 'Enter a reward above zero and up to 1000000 USD' })
      .positive('Enter a reward above zero and up to 1000000 USD')
      .max(1_000_000, 'Enter a reward above zero and up to 1000000 USD'),
    reward_max_usd: z
      .number({ error: 'Enter a reward above zero and up to 1000000 USD' })
      .positive('Enter a reward above zero and up to 1000000 USD')
      .max(1_000_000, 'Enter a reward above zero and up to 1000000 USD'),
    monthly_cap_usd: z
      .number({ error: 'Enter an amount from 0 to 1000000 USD' })
      .min(0, 'Enter an amount from 0 to 1000000 USD')
      .max(1_000_000, 'Enter an amount from 0 to 1000000 USD'),
    lifetime_cap_usd: z
      .number({ error: 'Enter an amount from 0 to 1000000 USD' })
      .min(0, 'Enter an amount from 0 to 1000000 USD')
      .max(1_000_000, 'Enter an amount from 0 to 1000000 USD'),
    daily_budget_usd: z
      .number({ error: 'Enter an amount from 0 to 1000000 USD' })
      .min(0, 'Enter an amount from 0 to 1000000 USD')
      .max(1_000_000, 'Enter an amount from 0 to 1000000 USD'),
    timezone: z
      .string()
      .trim()
      .min(1, 'Enter a valid IANA time zone')
      .max(64, 'Enter a valid IANA time zone')
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value })
          return true
        } catch {
          return false
        }
      }, 'Enter a valid IANA time zone'),
    follow_registration_risk: z.boolean(),
    require_turnstile: z.boolean(),
  })
  .refine(
    (values) =>
      values.reward_mode === 'fixed' ||
      values.reward_max_usd >= values.reward_min_usd,
    {
      message: 'Maximum reward must be at least the minimum reward',
      path: ['reward_max_usd'],
    }
  )

export type CheckinSettingsValues = z.infer<typeof checkinSettingsSchema>

export const checkinReviewSchema = z.object({
  reason: z
    .string()
    .trim()
    .refine(
      (value) => [...value].length >= 3,
      'Enter a reason with at least 3 characters'
    )
    .refine(
      (value) => [...value].length <= 500,
      'Reason must not exceed 500 characters'
    ),
})

const checkinPaymentOrder = z
  .string()
  .trim()
  .min(1, 'Payment order is required')
  .refine(
    (value) => new TextEncoder().encode(value).length <= 191,
    'Payment order must not exceed 191 bytes'
  )

export const checkinReconcileSchema = checkinReviewSchema
  .extend({
    user_id: z
      .number({ error: 'Enter a valid user ID' })
      .int('Enter a valid user ID')
      .positive('Enter a valid user ID'),
    source: z.enum(['topup', 'subscription']),
    trade_no: checkinPaymentOrder,
    reference: z
      .string()
      .trim()
      .refine(
        (value) => new TextEncoder().encode(value).length <= 128,
        'Payment reference must not exceed 128 bytes'
      )
      .optional(),
    amount: decimalAmount.refine(
      (value) => Number(value) > 0,
      'Actual paid amount must be greater than zero'
    ),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/, 'Use a three-letter currency code'),
    usd_per_unit: z.union([
      z.literal(''),
      decimalAmount.refine(
        (value) => Number(value) > 0,
        'Exchange rate must be greater than zero'
      ),
    ]),
  })
  .refine(
    (values) =>
      values.currency === 'USD' ||
      values.currency === 'CNY' ||
      Number(values.usd_per_unit) > 0,
    {
      message: 'Other currencies require a positive USD exchange rate',
      path: ['usd_per_unit'],
    }
  )

export const checkinRefundSchema = checkinReviewSchema.extend({
  trade_no: checkinPaymentOrder,
  amount: decimalAmount,
})

export type CheckinReconcileValues = z.infer<typeof checkinReconcileSchema>
export type CheckinRefundValues = z.infer<typeof checkinRefundSchema>
