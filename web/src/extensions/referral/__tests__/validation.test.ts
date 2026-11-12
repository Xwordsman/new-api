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
import { describe, expect, it } from 'vitest'

import { referralActionSchema, referralSettingsSchema } from '../lib/schema'

const settings = {
  enabled: true,
  rate: 5,
  window_days: 30,
  cooling_hours: 24,
  cap_usd: 100,
  cny_per_usd: '7.2',
}

describe('referral settings validation', () => {
  it('accepts hundredth-percent precision and a zero-hour cooling period', () => {
    expect(
      referralSettingsSchema.safeParse({
        ...settings,
        rate: 0.29,
        cooling_hours: 0,
      }).success
    ).toBe(true)
  })
  it.each([
    { rate: 100.01 },
    { rate: 5.001 },
    { window_days: 0 },
    { window_days: 30.5 },
    { cooling_hours: -1 },
    { cooling_hours: 0.5 },
    { cap_usd: 0 },
    { cap_usd: 1_000_001 },
    { cny_per_usd: '0' },
    { cny_per_usd: 'Infinity' },
    { cny_per_usd: '10001' },
  ])('rejects an out-of-range setting: %j', (invalid) => {
    expect(
      referralSettingsSchema.safeParse({ ...settings, ...invalid }).success
    ).toBe(false)
  })
  it('requires a finite payment and an audit reason for order reconciliation', () => {
    const order = {
      trade_no: 'order-1',
      amount: '100',
      currency: 'USD',
      usd_per_unit: '',
      reason: 'Verified provider payment',
    }
    expect(referralActionSchema.safeParse(order).success).toBe(true)
    expect(
      referralActionSchema.safeParse({ ...order, reason: '  ' }).success
    ).toBe(false)
    expect(
      referralActionSchema.safeParse({ ...order, amount: '1000000001' }).success
    ).toBe(false)
    expect(
      referralActionSchema.safeParse({ ...order, amount: '-100' }).success
    ).toBe(false)
  })
})
