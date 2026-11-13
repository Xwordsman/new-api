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
import type { TFunction } from 'i18next'
import { z } from 'zod'

import { parseQuotaFromDollars, quotaUnitsToEditableAmount } from '@/lib/format'

import {
  REDEMPTION_VALIDATION,
  getRedemptionFormErrorMessages,
} from '../constants'
import type { RedemptionFormData, Redemption } from '../types'

// ============================================================================
// Form Schema (use getRedemptionFormSchema(t) in components for i18n messages)
// ============================================================================

export function getRedemptionFormSchema(t: TFunction) {
  const msg = getRedemptionFormErrorMessages(t)
  return z
    .object({
      name: z
        .string()
        .min(REDEMPTION_VALIDATION.NAME_MIN_LENGTH, msg.NAME_LENGTH_INVALID)
        .max(REDEMPTION_VALIDATION.NAME_MAX_LENGTH, msg.NAME_LENGTH_INVALID),
      quota_dollars: z.number().min(0, t('Quota must be a positive number')),
      expired_time: z.date().nullable(),
      count: z
        .number()
        .min(REDEMPTION_VALIDATION.COUNT_MIN, msg.COUNT_INVALID)
        .max(REDEMPTION_VALIDATION.COUNT_MAX, msg.COUNT_INVALID)
        .optional(),
      code_type: z.enum(['gift', 'sale']),
      recharge_amount: z.string(),
      recharge_currency: z.enum(['CNY', 'USD']),
      referral_enabled: z.boolean(),
    })
    .superRefine((data, ctx) => {
      if (data.code_type !== 'sale') return
      if (
        !/^\d+(\.\d{1,2})?$/.test(data.recharge_amount) ||
        data.recharge_amount.length > 48 ||
        Number(data.recharge_amount) <= 0 ||
        Number(data.recharge_amount) > 1000000000
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['recharge_amount'],
          message: t(
            'Sale amount must be positive, at most 1000000000, with up to two decimal places'
          ),
        })
      }
    })
}

export type RedemptionFormValues = {
  name: string
  quota_dollars: number
  expired_time: Date | null
  count?: number
  code_type: 'gift' | 'sale'
  recharge_amount: string
  recharge_currency: 'CNY' | 'USD'
  referral_enabled: boolean
}

// ============================================================================
// Form Defaults
// ============================================================================

export const REDEMPTION_FORM_DEFAULT_VALUES: RedemptionFormValues = {
  name: '',
  quota_dollars: 10,
  expired_time: null,
  count: 1,
  code_type: 'gift',
  recharge_amount: '',
  recharge_currency: 'CNY',
  referral_enabled: false,
}

// ============================================================================
// Form Data Transformation
// ============================================================================

/**
 * Transform form data to API payload
 */
export function transformFormDataToPayload(
  data: RedemptionFormValues
): RedemptionFormData {
  return {
    name: data.name,
    quota: parseQuotaFromDollars(data.quota_dollars),
    expired_time: data.expired_time
      ? Math.floor(data.expired_time.getTime() / 1000)
      : 0,
    count: data.count || 1,
    code_type: data.code_type,
    recharge_amount: data.code_type === 'sale' ? data.recharge_amount : '',
    recharge_currency: data.code_type === 'sale' ? data.recharge_currency : '',
    referral_enabled: data.code_type === 'sale' && data.referral_enabled,
  }
}

/**
 * Transform redemption data to form defaults
 */
export function transformRedemptionToFormDefaults(
  redemption: Redemption
): RedemptionFormValues {
  return {
    name: redemption.name,
    quota_dollars: quotaUnitsToEditableAmount(redemption.quota),
    expired_time:
      redemption.expired_time > 0
        ? new Date(redemption.expired_time * 1000)
        : null,
    count: 1,
    code_type: redemption.code_type === 'sale' ? 'sale' : 'gift',
    recharge_amount: redemption.recharge_amount ?? '',
    recharge_currency: redemption.recharge_currency === 'USD' ? 'USD' : 'CNY',
    referral_enabled: redemption.referral_enabled ?? false,
  }
}
