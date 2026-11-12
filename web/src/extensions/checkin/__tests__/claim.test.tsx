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
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { toast } from 'sonner'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { CheckinPage } from '../index'
import { checkinDashboard } from './fixtures'

let client: QueryClient
const initialConfig = useSystemConfigStore.getState()

beforeEach(() => {
  localStorage.clear()
  useAuthStore.getState().auth.setUser({ id: 7, username: 'alice', role: 1 })
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
  client = createAppQueryClient()
  client.setDefaultOptions({
    queries: { retry: false, gcTime: 0, staleTime: Infinity },
    mutations: { retry: false },
  })
  client.setQueryData(['status'], {
    extension_features: { checkin: true },
    turnstile_site_key: 'test-site-key',
  })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: checkinDashboard },
  })
  vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      data: { quota_awarded: 5000, checkin_date: '2026-11-12' },
    },
  })
  vi.spyOn(toast, 'error').mockImplementation(() => 'error-toast')
  vi.spyOn(toast, 'success').mockImplementation(() => 'success-toast')
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(async () => {
  cleanup()
  client.clear()
  useAuthStore.getState().auth.reset()
  useSystemConfigStore.setState(initialConfig)
  delete window.turnstile
  vi.restoreAllMocks()
  await i18next.changeLanguage('en')
  localStorage.clear()
})

async function renderCheckin() {
  const root = createRootRoute()
  const checkinRoute = createRoute({
    getParentRoute: () => root,
    path: '/checkin',
    component: CheckinPage,
  })
  const walletRoute = createRoute({
    getParentRoute: () => root,
    path: '/wallet',
    component: () => <h1>Wallet</h1>,
  })
  const router = createRouter({
    routeTree: root.addChildren([checkinRoute, walletRoute]),
    history: createMemoryHistory({ initialEntries: ['/checkin'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return router
}

test('a disabled check-in feature shows a closed state without exposing a claim button', async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: { success: true, data: { ...checkinDashboard, enabled: false } },
  })
  await renderCheckin()
  expect(
    await screen.findByText('Check-in is currently unavailable')
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Check in now' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('grid', { name: 'Reward calendar' })
  ).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

test('insufficient verified recharge explains the missing amount and links to the wallet', async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      success: true,
      data: {
        ...checkinDashboard,
        claimable: false,
        claim_reason: 'Recharge requirement has not been met',
        eligibility: {
          ...checkinDashboard.eligibility,
          eligible: false,
          qualified_amount: '20',
          remaining_amount: '30',
        },
      },
    },
  })
  const user = userEvent.setup()
  const router = await renderCheckin()
  expect(
    await screen.findByRole('button', { name: 'Check in now' })
  ).toBeDisabled()
  expect(
    screen.getByText('Recharge requirement has not been met')
  ).toHaveAttribute('role', 'status')
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40')
  expect(
    screen.getByText('Recharge CN¥30.00 more to reach the check-in threshold.')
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Go to wallet' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/wallet'))
  expect(api.post).not.toHaveBeenCalled()
})

test('the calendar uses the server month and prevents navigating beyond its current month', async () => {
  const user = userEvent.setup()
  vi.mocked(api.get).mockImplementation(async (_url, config) => ({
    data: {
      success: true,
      data: {
        ...checkinDashboard,
        month:
          (config?.params as { month?: string } | undefined)?.month ??
          checkinDashboard.month,
      },
    },
  }))
  await renderCheckin()
  expect(await screen.findByText('November 2026')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Next month' })).toHaveAttribute(
    'aria-disabled',
    'true'
  )
  expect(
    screen.getByRole('gridcell', {
      name: 'Check-in on November 11, 2026: $0.01',
    })
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Previous month' }))
  expect(await screen.findByText('October 2026')).toBeVisible()
  expect(api.get).toHaveBeenCalledWith('/api/extensions/checkin/dashboard', {
    params: { month: '2026-10' },
  })
  expect(screen.getByRole('button', { name: 'Next month' })).toBeEnabled()
})

test('a duplicate claim refreshes the server state without reporting a second reward', async () => {
  const user = userEvent.setup()
  vi.mocked(api.post).mockImplementation(async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        success: true,
        data: {
          ...checkinDashboard,
          checked_in_today: true,
          claimable: false,
          claim_reason: 'Already checked in today',
        },
      },
    })
    return { data: { success: false, message: 'Already checked in today' } }
  })
  await renderCheckin()
  await user.click(await screen.findByRole('button', { name: 'Check in now' }))
  expect(
    await screen.findByRole('button', { name: 'Checked in' })
  ).toBeDisabled()
  expect(screen.getByText('Already checked in today')).toHaveAttribute(
    'role',
    'status'
  )
  expect(toast.success).not.toHaveBeenCalled()
  expect(toast.error).toHaveBeenCalled()
  expect(api.post).toHaveBeenCalledExactlyOnceWith(
    '/api/extensions/checkin/claim',
    undefined,
    { params: undefined }
  )
})

test('human verification requires an explicit valid token and expires again after a failed claim', async () => {
  const user = userEvent.setup()
  let callbacks: Record<string, unknown> = {}
  window.turnstile = {
    render: vi.fn((_element, options) => {
      callbacks = options
      return 'test-widget'
    }),
    remove: vi.fn(),
  }
  vi.mocked(api.get).mockResolvedValue({
    data: {
      success: true,
      data: { ...checkinDashboard, verification_required: true },
    },
  })
  vi.mocked(api.post).mockResolvedValue({
    data: { success: false, message: 'Check-in is temporarily unavailable' },
  })
  await renderCheckin()
  await user.click(await screen.findByRole('button', { name: 'Check in now' }))
  const dialog = await screen.findByRole('dialog', { name: 'Security Check' })
  const submit = within(dialog).getByRole('button', {
    name: 'Verify and check in',
  })
  expect(submit).toBeDisabled()
  act(() => (callbacks.callback as (value: string) => void)('temporary-token'))
  expect(submit).toBeEnabled()
  expect(api.post).not.toHaveBeenCalled()
  act(() => (callbacks['expired-callback'] as () => void)())
  expect(submit).toBeDisabled()
  act(() => (callbacks.callback as (value: string) => void)('error-token'))
  act(() => (callbacks['error-callback'] as () => void)())
  expect(submit).toBeDisabled()
  act(() => (callbacks.callback as (value: string) => void)('valid-token'))
  await user.click(submit)
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledExactlyOnceWith(
      '/api/extensions/checkin/claim',
      undefined,
      { params: { turnstile: 'valid-token' } }
    )
  )
  await waitFor(() => expect(submit).toBeDisabled())
  expect(dialog).toBeVisible()
  expect(toast.success).not.toHaveBeenCalled()
  await user.click(
    within(dialog).getByRole('button', { name: 'Retry verification' })
  )
  expect(submit).toBeDisabled()
})

test('changing accounts closes an old verification challenge and does not retain reward history', async () => {
  const user = userEvent.setup()
  window.turnstile = { render: vi.fn(() => 'test-widget'), remove: vi.fn() }
  vi.mocked(api.get).mockResolvedValue({
    data: {
      success: true,
      data: { ...checkinDashboard, verification_required: true },
    },
  })
  await renderCheckin()
  await user.click(await screen.findByRole('button', { name: 'Check in now' }))
  expect(
    await screen.findByRole('dialog', { name: 'Security Check' })
  ).toBeVisible()
  vi.mocked(api.get).mockResolvedValue({
    data: {
      success: true,
      data: {
        ...checkinDashboard,
        records: [],
        claimable: false,
        eligibility: { ...checkinDashboard.eligibility, eligible: false },
      },
    },
  })
  act(() =>
    useAuthStore.getState().auth.setUser({ id: 8, username: 'bob', role: 1 })
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Security Check' })
    ).not.toBeInTheDocument()
  )
  expect(
    screen.queryByRole('gridcell', {
      name: 'Check-in on November 11, 2026: $0.01',
    })
  ).not.toBeInTheDocument()
  expect(
    await screen.findByRole('button', { name: 'Check in now' })
  ).toBeDisabled()
  expect(api.post).not.toHaveBeenCalled()
})

test('a zero recharge threshold explains that qualification has no expiry and omits recharge requirements', async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      success: true,
      data: {
        ...checkinDashboard,
        rules: {
          ...checkinDashboard.rules,
          threshold_amount: '0',
          eligibility_days: 30,
          renew_on_recharge: true,
        },
        eligibility: {
          ...checkinDashboard.eligibility,
          expires_at: 0,
          qualified_amount: '0',
          remaining_amount: '0',
        },
      },
    },
  })
  await renderCheckin()
  expect(
    await screen.findByRole('button', { name: 'Check in now' })
  ).toBeEnabled()
  expect(
    screen.getByText(
      'A zero recharge threshold removes recharge and qualification expiry requirements. Other checks still apply.'
    )
  ).toBeVisible()
  expect(screen.getAllByText('No recharge required').length).toBeGreaterThan(0)
  expect(screen.queryByText('Qualification duration')).not.toBeInTheDocument()
  expect(screen.queryByText('Eligible recharge period')).not.toBeInTheDocument()
  expect(
    screen.queryByText(
      'A new qualifying recharge renews the qualification period.'
    )
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})
