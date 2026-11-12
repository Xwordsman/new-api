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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { ReferralPage } from '../index'
import { useReferralTransferStore } from '../transfer-store'
import type { ReferralDashboard } from '../types'

const dashboard: ReferralDashboard = {
  settings: {
    enabled: true,
    rate_bps: 500,
    window_days: 30,
    cooling_hours: 24,
    cap_quota: 50_000_000,
    cny_per_usd: '7.2',
    version: 1,
    started_at: 1700000000,
  },
  account: {
    user_id: 1,
    balance: 2_500_000,
    debt: 0,
    earned: 2_500_000,
    transferred: 0,
  },
  invited: 1,
  paying: 1,
  pending: 0,
  review: 0,
  claimable: 0,
  code: 'my-code',
  server_time: 1700000000,
}

beforeEach(() => {
  sessionStorage.clear()
  useReferralTransferStore.setState({ requests: {} })
  useAuthStore.getState().auth.setUser({ id: 1, username: 'inviter', role: 1 })
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: String(url).endsWith('/dashboard')
        ? dashboard
        : { items: [], total: 0 },
    },
  }))
})

afterEach(() => {
  useReferralTransferStore.setState({ requests: {} })
  sessionStorage.clear()
  useAuthStore.getState().auth.reset()
})

it('copies the permanent referral link using the current site origin', async () => {
  const user = userEvent.setup()
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText')
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ReferralPage />
    </QueryClientProvider>
  )
  await user.click(
    await screen.findByRole('button', { name: 'Copy referral link' })
  )
  expect(clipboard).toHaveBeenCalledWith(
    `${window.location.origin}/sign-up?aff=my-code`
  )
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeVisible()
})

it('retries an uncertain transfer with the same locked amount and key after returning to the page', async () => {
  const user = userEvent.setup()
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValueOnce(new Error('Network response lost'))
    .mockResolvedValueOnce({
      data: { success: true, data: { id: 1, quota: 2_500_000 } },
    })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const first = render(
    <QueryClientProvider client={client}>
      <ReferralPage />
    </QueryClientProvider>
  )
  await user.click(
    await screen.findByRole('button', { name: 'Transfer to wallet' })
  )
  await user.click(screen.getByRole('button', { name: 'Transfer' }))
  await screen.findByText(
    'The previous transfer response was lost. Retry to confirm the same transfer safely.'
  )
  const payload: unknown = post.mock.calls[0][1]
  expect(payload).toEqual({ quota: 2_500_000, request_id: expect.any(String) })
  first.unmount()
  // The committed balance can already have fallen to zero while the response
  // was lost. Confirmation must still be possible, without a second credit.
  client.setQueryData(['referral-extension', 'dashboard'], {
    ...dashboard,
    account: { ...dashboard.account, balance: 0 },
  })
  render(
    <QueryClientProvider client={client}>
      <ReferralPage />
    </QueryClientProvider>
  )
  await user.click(
    await screen.findByRole('button', { name: 'Transfer to wallet' })
  )
  expect(
    screen.getByRole('spinbutton', { name: 'Transfer Amount' })
  ).toBeDisabled()
  expect(
    screen.getByRole('spinbutton', { name: 'Transfer Amount' })
  ).toHaveValue(5)
  await user.click(screen.getByRole('button', { name: 'Transfer' }))
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
  expect(post).toHaveBeenLastCalledWith(
    '/api/extensions/referral/transfer',
    payload
  )
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(useReferralTransferStore.getState().requests[1]).toBeUndefined()
})

it('restores session retry data per account and discards malformed stored amounts', async () => {
  sessionStorage.setItem(
    'referral-pending-transfers',
    JSON.stringify({
      version: 1,
      state: {
        requests: {
          '2': { quota: 500_000, request_id: 'saved-transfer-request' },
        },
      },
    })
  )
  await useReferralTransferStore.persist.rehydrate()
  expect(useReferralTransferStore.getState().requests[1]).toBeUndefined()
  expect(useReferralTransferStore.getState().requests[2]).toEqual({
    quota: 500_000,
    request_id: 'saved-transfer-request',
  })
  sessionStorage.setItem(
    'referral-pending-transfers',
    JSON.stringify({
      version: 1,
      state: {
        requests: { '1': { quota: -1, request_id: 'saved-transfer-request' } },
      },
    })
  )
  await useReferralTransferStore.persist.rehydrate()
  expect(useReferralTransferStore.getState().requests[1]).toBeUndefined()
})
