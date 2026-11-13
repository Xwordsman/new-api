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

import { DrawSettingsForm } from '../components/settings-form'
import { useDrawStore } from '../draw-store'
import { LuckyDrawPage } from '../index'
import { drawSettingsSchema } from '../lib/schema'
import type { DrawDashboard, DrawResult, DrawSettings } from '../types'

let client: QueryClient
let dashboard: DrawDashboard
let savedResult: DrawResult | null
const initialConfig = useSystemConfigStore.getState()
const settings: DrawSettings = {
  version: 3,
  enabled: true,
  threshold_amount: '100',
  currency: 'CNY',
  recharge_mode: 'lifetime',
  lookback_days: 30,
  include_subscriptions: false,
  eligibility_days: 0,
  renew_on_recharge: true,
  daily_attempts: 1,
  timezone: 'Asia/Shanghai',
  starts_at: 0,
  ends_at: 0,
  allowed_groups: '',
  daily_budget_quota: 0,
  total_budget_quota: 0,
  user_cap_quota: 0,
  follow_registration_risk: true,
  require_turnstile: false,
  show_winners: false,
  prizes: [
    {
      id: 'a',
      name: 'Better luck next time',
      kind: 'none',
      quota: 0,
      weight: 500000,
      stock: 0,
      color: '#64748b',
    },
    {
      id: 'b',
      name: 'Small prize',
      kind: 'credit',
      quota: 5000,
      weight: 300000,
      stock: 0,
      color: '#0d9488',
    },
    {
      id: 'c',
      name: 'Bronze prize',
      kind: 'credit',
      quota: 25000,
      weight: 150000,
      stock: 0,
      color: '#2563eb',
    },
    {
      id: 'd',
      name: 'Silver prize',
      kind: 'credit',
      quota: 50000,
      weight: 40000,
      stock: 0,
      color: '#7c3aed',
    },
    {
      id: 'e',
      name: 'Gold prize',
      kind: 'credit',
      quota: 500000,
      weight: 9000,
      stock: 0,
      color: '#d97706',
    },
    {
      id: 'f',
      name: 'Grand prize',
      kind: 'credit',
      quota: 5000000,
      weight: 1000,
      stock: 0,
      color: '#e11d48',
    },
  ],
}

beforeEach(() => {
  localStorage.clear()
  useDrawStore.setState({ requests: {} })
  useAuthStore.getState().auth.setUser({ id: 7, username: 'alice', role: 1 })
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
  dashboard = {
    rules: structuredClone(settings),
    account: {
      user_id: 7,
      state: 'active',
      reason: '',
      updated_by: 0,
      updated_at: 0,
      attempts: 0,
      next_reset_at: 1794499200,
      total_draws: 0,
      total_quota: 0,
    },
    qualified_amount: '100',
    remaining_amount: '0',
    expires_at: 0,
    remaining_attempts: 1,
    reason: '',
    drawable: true,
    verification_required: false,
  }
  savedResult = null
  client = createAppQueryClient()
  client.setDefaultOptions({
    queries: { retry: false, gcTime: 0, staleTime: Infinity },
    mutations: { retry: false },
  })
  client.setQueryData(['status'], {
    extension_features: { lucky_draw: true },
    turnstile_site_key: 'test-site-key',
  })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (String(url).endsWith('/dashboard')) {
      return { data: { success: true, data: dashboard } }
    }
    if (String(url).includes('/result/')) {
      return { data: { success: true, data: savedResult } }
    }
    return { data: { success: true, data: { items: [], total: 0 } } }
  })
  vi.spyOn(api, 'post').mockImplementation(async (_url, input) => {
    const request = input as { request_key: string; version: number }
    savedResult = {
      record: {
        id: 10,
        user_id: 7,
        request_key: request.request_key,
        settings_version: request.version,
        prize_id: 'b',
        prize_name: 'Small prize',
        quota_awarded: 5000,
        created_at: 1794400000,
      },
      prizes: structuredClone(settings.prizes),
      replay: false,
    }
    return { data: { success: true, data: savedResult } }
  })
  vi.spyOn(toast, 'error').mockImplementation(() => 'error-toast')
  vi.spyOn(toast, 'success').mockImplementation(() => 'success-toast')
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(async () => {
  cleanup()
  client.clear()
  useDrawStore.setState({ requests: {} })
  useAuthStore.getState().auth.reset()
  useSystemConfigStore.setState(initialConfig)
  delete window.turnstile
  vi.restoreAllMocks()
  await i18next.changeLanguage('en')
  localStorage.clear()
})

async function renderDraw() {
  const root = createRootRoute()
  const route = createRoute({
    getParentRoute: () => root,
    path: '/lucky-draw',
    component: LuckyDrawPage,
  })
  const wallet = createRoute({
    getParentRoute: () => root,
    path: '/wallet',
    component: () => <h1>Wallet</h1>,
  })
  const router = createRouter({
    routeTree: root.addChildren([route, wallet]),
    history: createMemoryHistory({ initialEntries: ['/lucky-draw'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

test('mounting never submits a draw, and disabled activities hide the draw button', async () => {
  dashboard.rules.enabled = false
  dashboard.drawable = false
  await renderDraw()
  expect(await screen.findByText('Lucky draw is not enabled')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Draw now' })
  ).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

test('insufficient recharge blocks drawing and shows the server reason', async () => {
  dashboard.drawable = false
  dashboard.reason = 'Lucky draw recharge requirement has not been met'
  dashboard.qualified_amount = '20'
  dashboard.remaining_amount = '80'
  await renderDraw()
  expect(await screen.findByRole('button', { name: 'Draw now' })).toBeDisabled()
  expect(screen.getByText(dashboard.reason)).toHaveAttribute('role', 'status')
  expect(api.post).not.toHaveBeenCalled()
})

test('rare prize probabilities keep four decimals and update when the interface language changes', async () => {
  dashboard.rules.prizes[0].weight += 999
  dashboard.rules.prizes[5].weight = 1
  await renderDraw()
  for (const [language, probability] of [
    ['en', '0.0001%'],
    ['zhCN', '0.0001%'],
    ['zhTW', '0.0001%'],
    ['fr', '0,0001%'],
    ['ru', '0,0001%'],
    ['ja', '0.0001%'],
    ['vi', '0,0001%'],
    ['invalid_locale', '0.0001%'],
  ]) {
    await act(() => i18next.changeLanguage(language))
    const probabilities = await screen.findByRole('list', {
      name: i18next.t('Prize probabilities'),
    })
    expect(
      within(probabilities).getByText((text) => text.endsWith(probability))
    ).toBeVisible()
  }
})

test('a network failure retries the same identity and updates the wallet only after a saved result', async () => {
  const user = userEvent.setup()
  vi.mocked(api.post).mockRejectedValueOnce(new Error('Network unavailable'))
  await renderDraw()
  const drawButton = await screen.findByRole('button', { name: 'Draw now' })
  expect(api.post).not.toHaveBeenCalled()
  await user.click(drawButton)
  await waitFor(() => expect(toast.error).toHaveBeenCalled())
  await waitFor(() => expect(drawButton).toBeEnabled())
  expect(
    await screen.findByText(
      'An unfinished draw was found. Retry to recover the same result.'
    )
  ).toBeVisible()
  const first = vi.mocked(api.post).mock.calls[0][1] as { request_key: string }
  await user.click(drawButton)
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2))
  expect(vi.mocked(api.post).mock.calls[1][1]).toEqual(first)
  const skip = screen.queryByRole('button', { name: 'Skip animation' })
  if (skip) await user.click(skip)
  expect(
    await screen.findByText('Credited to your wallet: $0.01')
  ).toBeVisible()
  expect(useDrawStore.getState().requests[7]).toMatchObject({
    key: first.request_key,
    resolved: true,
  })
})

test('refresh recovers the original prize snapshot even after the activity is disabled without posting', async () => {
  const key = 'saved-request-0001'
  useDrawStore.getState().remember(7, { key, version: 2, resolved: false })
  savedResult = {
    record: {
      id: 9,
      user_id: 7,
      request_key: key,
      settings_version: 2,
      prize_id: 'old',
      prize_name: 'Original prize',
      quota_awarded: 5000,
      created_at: 1794400000,
    },
    prizes: [{ ...settings.prizes[1], id: 'old', name: 'Original prize' }],
    replay: true,
  }
  dashboard.rules.enabled = false
  dashboard.drawable = false
  await renderDraw()
  expect(
    await screen.findByText('Credited to your wallet: $0.01')
  ).toBeVisible()
  expect(screen.getAllByText('Original prize').length).toBeGreaterThan(0)
  expect(
    screen.queryByRole('button', { name: 'Skip animation' })
  ).not.toBeInTheDocument()
  expect(api.get).toHaveBeenCalledWith(
    `/api/extensions/lucky-draw/result/${key}`,
    { params: undefined }
  )
  expect(api.post).not.toHaveBeenCalled()
})

test('human verification expires on failure and requires a new explicit proof', async () => {
  const user = userEvent.setup()
  let callbacks: Record<string, unknown> = {}
  window.turnstile = {
    render: vi.fn((_element, options) => {
      callbacks = options
      return 'test-widget'
    }),
    remove: vi.fn(),
  }
  dashboard.verification_required = true
  vi.mocked(api.post).mockResolvedValue({
    data: {
      success: false,
      message: 'Complete human verification before drawing',
    },
  })
  await renderDraw()
  await user.click(await screen.findByRole('button', { name: 'Draw now' }))
  const dialog = await screen.findByRole('dialog', { name: 'Security Check' })
  const submit = within(dialog).getByRole('button', { name: 'Verify and draw' })
  expect(submit).toBeDisabled()
  expect(api.post).not.toHaveBeenCalled()
  act(() => (callbacks.callback as (v: string) => void)('temporary-proof'))
  expect(submit).toBeEnabled()
  act(() => (callbacks['expired-callback'] as () => void)())
  expect(submit).toBeDisabled()
  act(() => (callbacks.callback as (v: string) => void)('valid-proof'))
  await user.click(submit)
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
  expect(vi.mocked(api.post).mock.calls[0][1]).toMatchObject({
    version: 3,
    turnstile: 'valid-proof',
  })
  await waitFor(() => expect(submit).toBeDisabled())
})

test('changing accounts drops the visible old result and never retries it as the new user', async () => {
  const key = 'alice-request-0001'
  useDrawStore.getState().remember(7, { key, version: 2, resolved: false })
  savedResult = {
    record: {
      id: 9,
      user_id: 7,
      request_key: key,
      settings_version: 2,
      prize_id: 'b',
      prize_name: 'Alice prize',
      quota_awarded: 5000,
      created_at: 1794400000,
    },
    prizes: settings.prizes,
    replay: true,
  }
  await renderDraw()
  expect(await screen.findByText('Alice prize')).toBeVisible()
  savedResult = null
  act(() =>
    useAuthStore.getState().auth.setUser({ id: 8, username: 'bob', role: 1 })
  )
  await waitFor(() =>
    expect(screen.queryByText('Alice prize')).not.toBeInTheDocument()
  )
  expect(api.post).not.toHaveBeenCalled()
})

test('settings preserve unsaved edits when refreshed and submit a precise probability total', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'put').mockImplementation(async (_url, input) => ({
    data: { success: true, data: { ...(input as DrawSettings), version: 5 } },
  }))
  const view = render(
    <QueryClientProvider client={client}>
      <DrawSettingsForm settings={structuredClone(settings)} />
    </QueryClientProvider>
  )
  const threshold = screen.getByRole('textbox', {
    name: 'Recharge requirement',
  })
  await user.clear(threshold)
  await user.type(threshold, '200')
  view.rerender(
    <QueryClientProvider client={client}>
      <DrawSettingsForm
        settings={{
          ...structuredClone(settings),
          version: 4,
          threshold_amount: '300',
        }}
      />
    </QueryClientProvider>
  )
  expect(threshold).toHaveValue('200')
  expect(
    screen.getByText('Lucky draw settings changed. Reload before continuing.')
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Save settings' }))
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1))
  expect(vi.mocked(api.put).mock.calls[0][1]).toMatchObject({
    version: 3,
    threshold_amount: '200',
  })
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith('Lucky draw settings saved')
  )
})

test('settings reject incomplete odds, invalid groups and a no-win-only pool', () => {
  expect(drawSettingsSchema.safeParse(settings).success).toBe(true)
  const badOdds = structuredClone(settings)
  badOdds.prizes[0].weight -= 1
  expect(drawSettingsSchema.safeParse(badOdds).success).toBe(false)
  expect(
    drawSettingsSchema.safeParse({
      ...settings,
      allowed_groups: 'default, other',
    }).success
  ).toBe(false)
  const empty = structuredClone(settings)
  empty.prizes.forEach((p) => {
    p.weight = 0
  })
  empty.prizes[0].weight = 1000000
  expect(drawSettingsSchema.safeParse(empty).success).toBe(false)
})

test('an incomplete probability total displays its exact value and disables saving', () => {
  const incomplete = structuredClone(settings)
  incomplete.prizes[0].weight -= 1
  render(
    <QueryClientProvider client={client}>
      <DrawSettingsForm settings={incomplete} />
    </QueryClientProvider>
  )
  expect(screen.getByText('Total probability: 99.9999%')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled()
})
