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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { Rewards } from '../components/rewards'
import type { ReferralReward } from '../types'

const now = 1700000000
const reward: ReferralReward = {
  id: 1,
  trade_no: 'ready-order',
  provider: 'stripe',
  user_id: 2,
  paid_quota: 50_000_000,
  refunded_quota: 0,
  amount: '100',
  currency: 'USD',
  rate_bps: 500,
  quota: 2_500_000,
  reversed: 0,
  offset: 0,
  paid_at: now - 86400,
  available_at: now,
  claimed_at: 0,
  state: 'pending',
  historical: false,
  qualification: 'active',
}

it('allows only cooled, qualified, non-refunded positive rewards to be claimed', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        items: [
          reward,
          {
            ...reward,
            id: 2,
            trade_no: 'cooling-order',
            available_at: now + 1,
          },
          {
            ...reward,
            id: 3,
            trade_no: 'review-order',
            qualification: 'review',
          },
          {
            ...reward,
            id: 4,
            trade_no: 'refunded-order',
            reversed: reward.quota,
          },
          { ...reward, id: 5, trade_no: 'zero-order', quota: 0 },
        ],
        total: 5,
      },
    },
  })
  const onClaim = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <Rewards now={now} onClaim={onClaim} claiming={false} enabled />
    </QueryClientProvider>
  )
  const ready = await screen.findByRole('row', { name: /ready-order/ })
  await user.click(within(ready).getByRole('button', { name: 'Claim reward' }))
  expect(onClaim).toHaveBeenCalledWith(1)
  for (const order of [
    'cooling-order',
    'review-order',
    'refunded-order',
    'zero-order',
  ]) {
    expect(
      within(screen.getByRole('row', { name: new RegExp(order) })).getByRole(
        'button',
        { name: 'Claim reward' }
      )
    ).toBeDisabled()
  }
  expect(
    within(screen.getByRole('row', { name: /zero-order/ })).getByText(
      'No reward'
    )
  ).toBeVisible()
  expect(
    within(screen.getByRole('row', { name: /review-order/ })).getByText(
      'Under review'
    )
  ).toBeVisible()
})
