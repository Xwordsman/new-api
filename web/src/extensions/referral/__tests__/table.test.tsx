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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { Invitees } from '../components/invitees'
import { ReferralTable } from '../components/referral-table'
import type { Invitee, ReferralTransfer } from '../types'

it('shows issued fixed bonuses separately from invitations awaiting risk review', async () => {
  const invitee: Invitee = {
    id: 1,
    user_id: 2,
    inviter_id: 1,
    username: 'invited-user',
    registered_at: 1700000000,
    expires_at: 1702592000,
    rate_bps: 500,
    cap_quota: 50_000_000,
    cooling_hours: 24,
    settings_version: 1,
    state: 'active',
    reason: '',
    reserved: 0,
    historical: false,
    reviewed_at: 0,
    signup_bonus_quota: 500_000,
    signup_bonus_paid_at: 1700000001,
    net_paid: 0,
    earned: 0,
    pending: 0,
  }
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        items: [
          invitee,
          {
            ...invitee,
            id: 2,
            user_id: 3,
            username: 'review-user',
            state: 'review',
            signup_bonus_paid_at: 0,
          },
        ],
        total: 2,
      },
    },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <Invitees now={1700000100} onClaim={vi.fn()} claiming={false} enabled />
    </QueryClientProvider>
  )
  const issued = await screen.findByRole('row', { name: /invited-user/ })
  expect(within(issued).getByText('Automatically issued')).toBeVisible()
  const review = screen.getByRole('row', { name: /review-user/ })
  expect(
    within(review).queryByText('Automatically issued')
  ).not.toBeInTheDocument()
  expect(within(review).getAllByText('Under review').length).toBeGreaterThan(0)
  expect(
    screen.getByRole('columnheader', { name: 'Fixed invitation bonus' })
  ).toBeVisible()
})

it('shows a recoverable error after loading and an empty state after retry', async () => {
  const user = userEvent.setup()
  let fail: (error: Error) => void = () => undefined
  vi.spyOn(api, 'get')
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject
        })
    )
    .mockResolvedValueOnce({
      data: { success: true, data: { items: [], total: 0 } },
    })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ReferralTable<ReferralTransfer> resource='transfers' columns={[]} />
    </QueryClientProvider>
  )
  expect(screen.getByText('Loading...')).toBeVisible()
  fail(new Error('Offline'))
  await user.click(await screen.findByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('No referral records yet')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Go to next page' })).toBeDisabled()
})

it('requests the next server page while preserving the current records during loading', async () => {
  const user = userEvent.setup()
  const first = {
    id: 1,
    request_id: 'transfer-page-one',
    quota: 500_000,
    offset: 0,
    created_at: 1700000000,
  }
  let finish: (response: {
    data: {
      success: boolean
      data: { items: ReferralTransfer[]; total: number }
    }
  }) => void = () => undefined
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValueOnce({
      data: { success: true, data: { items: [first], total: 11 } },
    })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ReferralTable<ReferralTransfer>
        resource='transfers'
        columns={[
          {
            id: 'request',
            header: 'Transfer ID',
            cell: (row) => row.request_id,
          },
        ]}
      />
    </QueryClientProvider>
  )
  await screen.findByText('transfer-page-one')
  await user.click(screen.getByRole('button', { name: 'Go to next page' }))
  await waitFor(() =>
    expect(get).toHaveBeenLastCalledWith('/api/extensions/referral/transfers', {
      params: { p: 2, page_size: 10 },
    })
  )
  expect(screen.getByText('transfer-page-one')).toBeVisible()
  finish({
    data: {
      success: true,
      data: {
        items: [{ ...first, id: 11, request_id: 'transfer-page-two' }],
        total: 11,
      },
    },
  })
  await screen.findByText('transfer-page-two')
  expect(screen.getByRole('button', { name: 'Go to next page' })).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Go to previous page' })
  ).toBeEnabled()
})
