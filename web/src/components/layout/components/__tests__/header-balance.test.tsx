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
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { CheckinPage } from '@/extensions/checkin'
import { checkinDashboard } from '@/extensions/checkin/__tests__/fixtures'
import type { UserProfile } from '@/features/profile/types'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { HeaderBalance } from '../header-balance'

const initialSystemConfig = useSystemConfigStore.getState()
const profile: UserProfile = {
  id: 1,
  username: 'alice',
  display_name: 'Alice',
  role: 1,
  group: 'default',
  quota: 61_725_000,
  used_quota: 6_250_000,
  request_count: 12,
  status: 1,
  aff_count: 0,
  aff_quota: 0,
  aff_history_quota: 0,
  created_time: 0,
}
let client: QueryClient

beforeEach(() => {
  localStorage.clear()
  useAuthStore.getState().auth.setUser({ id: 1, username: 'alice', role: 1 })
  useSystemConfigStore.getState().setConfig({
    currency: { ...DEFAULT_CURRENCY_CONFIG },
  })
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(['status'], { extension_features: { checkin: true } })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: profile },
  })
})

afterEach(async () => {
  cleanup()
  client.clear()
  useAuthStore.getState().auth.reset()
  useSystemConfigStore.setState(initialSystemConfig)
  vi.restoreAllMocks()
  await i18next.changeLanguage('en')
  localStorage.clear()
})

async function renderBalance(initialEntry = '/') {
  const root = createRootRoute({
    component: () => (
      <>
        <HeaderBalance />
        <Outlet />
      </>
    ),
  })
  const profileRoute = createRoute({
    getParentRoute: () => root,
    path: '/checkin',
    component: CheckinPage,
  })
  const indexRoute = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => null,
  })
  const walletRoute = createRoute({
    getParentRoute: () => root,
    path: '/wallet',
    component: () => <h1>Wallet</h1>,
  })
  const router = createRouter({
    routeTree: root.addChildren([indexRoute, profileRoute, walletRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return router
}

test('hovering the balance reveals the account amounts and its link opens the wallet', async () => {
  const user = userEvent.setup()
  const router = await renderBalance()
  const balance = await screen.findByRole('link', { name: 'Balance: $123.45' })

  expect(balance).toHaveAttribute('href', '/wallet')
  expect(screen.queryByText('Available Balance')).not.toBeInTheDocument()
  await user.hover(balance)
  expect(await screen.findByText('Available Balance')).toBeVisible()
  expect(screen.getByText('Total Usage')).toBeVisible()
  expect(screen.getByText('$12.5')).toBeVisible()
  expect(screen.getByRole('link', { name: 'Wallet' })).toHaveAttribute(
    'href',
    '/wallet'
  )

  await user.click(balance)
  expect(await screen.findByRole('heading', { name: 'Wallet' })).toBeVisible()
  expect(router.state.location.pathname).toBe('/wallet')
  expect(router.state.location.hash).toBe('')
  await waitFor(() =>
    expect(screen.queryByText('Available Balance')).not.toBeInTheDocument()
  )
})

test('keyboard focus reveals the balance details and Enter navigates to the wallet', async () => {
  const user = userEvent.setup()
  const router = await renderBalance()
  const balance = await screen.findByRole('link', { name: 'Balance: $123.45' })

  await user.tab()
  expect(balance).toHaveFocus()
  expect(await screen.findByText('Available Balance')).toBeVisible()
  await user.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByText('Available Balance')).not.toBeInTheDocument()
  )
  await user.keyboard('{Enter}')
  await waitFor(() => expect(router.state.location.pathname).toBe('/wallet'))
})

test.each([
  { quota: 0, amount: '$0' },
  { quota: -1_000_000, amount: '-$2' },
  { quota: 6_150, amount: '$0.0123' },
])(
  'a quota of $quota displays $amount without losing its sign or precision',
  async ({ quota, amount }) => {
    vi.mocked(api.get).mockResolvedValue({
      data: { success: true, data: { ...profile, quota } },
    })
    await renderBalance()
    expect(
      await screen.findByRole('link', { name: `Balance: ${amount}` })
    ).toHaveTextContent(amount)
  }
)

test('long balances can shrink in the header while the dropdown keeps the full amount', async () => {
  const user = userEvent.setup()
  vi.mocked(api.get).mockResolvedValue({
    data: { success: true, data: { ...profile, quota: 61_728_394_560_000 } },
  })
  await renderBalance()
  const balance = await screen.findByRole('link', {
    name: 'Balance: $123,456,789.12',
  })

  expect(balance).toHaveClass('min-w-8', 'shrink')
  expect(screen.getByText('$123,456,789.12')).toHaveClass(
    'truncate',
    'hidden',
    'min-[360px]:block'
  )
  expect(balance.querySelector('svg')).toHaveClass(
    'min-[360px]:hidden',
    'sm:block'
  )
  await user.hover(balance)
  await screen.findByText('Available Balance')
  expect(screen.getAllByText('$123,456,789.12')).toHaveLength(2)
})

test('a failed balance request shows an unavailable amount and reopening retries it', async () => {
  const user = userEvent.setup()
  vi.mocked(api.get).mockResolvedValue({
    data: { success: false, message: 'Balance temporarily unavailable' },
  })
  await renderBalance()
  const balance = await screen.findByRole('link', { name: 'Balance: -' })
  await user.hover(balance)

  expect(await screen.findByRole('status')).toHaveTextContent(
    'Failed to load profile'
  )
  expect(balance).not.toHaveTextContent('$0')
  await user.unhover(balance)
  await waitFor(() =>
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  )
  vi.mocked(api.get).mockResolvedValue({
    data: { success: true, data: profile },
  })
  await user.hover(balance)
  expect(
    await screen.findByRole('link', { name: 'Balance: $123.45' })
  ).toBeVisible()
  await waitFor(() =>
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  )
})

test.each([true, false])(
  'with check-in enabled=%s, both balance links lead to the wallet',
  async (checkinEnabled) => {
    const user = userEvent.setup()
    client.setQueryData(['status'], { checkin_enabled: checkinEnabled })
    const router = await renderBalance()
    const balance = await screen.findByRole('link', {
      name: 'Balance: $123.45',
    })

    expect(balance).toHaveAttribute('href', '/wallet')
    await user.hover(balance)
    const walletLink = await screen.findByRole('link', { name: 'Wallet' })
    expect(walletLink).toHaveAttribute('href', '/wallet')
    await user.click(walletLink)
    expect(await screen.findByRole('heading', { name: 'Wallet' })).toBeVisible()
    expect(router.state.location.pathname).toBe('/wallet')
    await waitFor(() =>
      expect(screen.queryByText('Available Balance')).not.toBeInTheDocument()
    )
  }
)

test('changing the signed-in account never displays the previous account balance', async () => {
  await renderBalance()
  await screen.findByRole('link', { name: 'Balance: $123.45' })
  vi.mocked(api.get).mockResolvedValue({
    data: { success: true, data: { ...profile, id: 2, quota: 1_000_000 } },
  })
  act(() =>
    useAuthStore.getState().auth.setUser({ id: 2, username: 'bob', role: 1 })
  )

  expect(
    screen.queryByRole('link', { name: 'Balance: $123.45' })
  ).not.toBeInTheDocument()
  expect(await screen.findByRole('link', { name: 'Balance: $2' })).toBeVisible()
  act(() => useAuthStore.getState().auth.reset())
  expect(
    screen.queryByRole('link', { name: /^Balance:/ })
  ).not.toBeInTheDocument()
})

test('changing the display currency refreshes the header and dropdown amounts', async () => {
  const user = userEvent.setup()
  await renderBalance()
  const balance = await screen.findByRole('link', { name: 'Balance: $123.45' })
  await user.hover(balance)
  await screen.findByText('Available Balance')

  act(() =>
    useSystemConfigStore.getState().setConfig({
      currency: {
        ...DEFAULT_CURRENCY_CONFIG,
        quotaDisplayType: 'CNY',
        usdExchangeRate: 7,
      },
    })
  )
  expect(screen.getByRole('link', { name: 'Balance: ¥864.15' })).toBeVisible()
  expect(screen.getByText('¥87.5')).toBeVisible()
})

test('successful check-in refreshes the balance immediately', async () => {
  const user = userEvent.setup()
  let quota = profile.quota
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url === '/api/user/self' ? { ...profile, quota } : checkinDashboard,
    },
  }))
  vi.spyOn(api, 'post').mockImplementation(async () => {
    quota += 500_000
    return { data: { success: true, data: { quota_awarded: 500_000 } } }
  })
  await renderBalance('/checkin')
  await screen.findByRole('link', { name: 'Balance: $123.45' })
  await user.click(await screen.findByRole('button', { name: 'Check in now' }))

  expect(
    await screen.findByRole('link', { name: 'Balance: $124.45' })
  ).toBeVisible()
})
