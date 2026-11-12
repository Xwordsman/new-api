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
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next, { type i18n } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { BenchmarkPage } from '../index'
import type { BenchmarkGroup, BenchmarkRun, Snapshot } from '../types'

const clients: QueryClient[] = []
afterEach(() => {
  clients.forEach((client) => client.clear())
  clients.length = 0
  useAuthStore.getState().auth.setUser(null)
})

const run: BenchmarkRun = {
  id: 21,
  kind: 'candy',
  status: 'wrong_answer',
  created_at: 1800000000,
  latency_ms: 1200,
  prompt_name: '',
  group: 'gpt-public',
  model: 'gpt-5',
  prompt: 'The saved candy question',
  expected: '21',
  output: '29',
  error_code: 'wrong_answer',
  finished_at: 1800000002,
  input_tokens: 30,
  output_tokens: 8,
  manual: false,
}
const group: BenchmarkGroup = {
  group: 'gpt-public',
  model: 'gpt-5',
  enabled: true,
  interval_minutes: 0,
  candy_enabled: true,
  svg_enabled: false,
  interval_seconds: 3600,
  next_at: 1800003600,
  runs: [run],
  totals: {
    candy_total: 1,
    candy_passed: 0,
    svg_total: 0,
    svg_passed: 0,
    anomalies: 1,
  },
}
const snapshot: Snapshot = {
  enabled: true,
  updated_at: 1800000000,
  refresh_seconds: 15,
  groups: [
    group,
    {
      ...group,
      group: 'gpt-fast',
      runs: [{ ...run, id: 22, status: 'passed' }],
      totals: { ...group.totals, candy_passed: 1, anomalies: 0 },
    },
  ],
  summary: {
    candy_total: 2,
    candy_passed: 1,
    svg_total: 0,
    svg_passed: 0,
    anomalies: 1,
  },
}

function renderPage(data = snapshot, translations: i18n = i18next) {
  const client = createAppQueryClient()
  client.setDefaultOptions({
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  })
  clients.push(client)
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url.endsWith('/snapshot')) return { data: { success: true, data } }
    if (url.endsWith('/runs/21')) return { data: { success: true, data: run } }
    if (url.endsWith('/artworks')) {
      return {
        data: {
          success: true,
          data: { items: [], total: 0, page: 1, page_size: 15 },
        },
      }
    }
    throw new Error(`Unexpected URL ${url}`)
  })
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={translations}>
        <BenchmarkPage />
      </I18nextProvider>
    </QueryClientProvider>
  )
  return get
}

it('translates Chinese benchmark labels and statuses and updates them when the language changes', async () => {
  const translations = i18next.createInstance()
  await translations.use(initReactI18next).init({
    lng: 'zh',
    fallbackLng: 'en',
    keySeparator: false,
    nsSeparator: false,
    resources: { en, zh },
  })
  renderPage(snapshot, translations)
  expect(await screen.findByRole('heading', { name: '降智检测' })).toBeVisible()
  expect(
    await screen.findByRole('combobox', { name: '筛选检测分组' })
  ).toBeVisible()
  expect(
    screen.getByRole('button', { name: /糖果逻辑 · .*答案不符/ })
  ).toBeVisible()
  await act(() => translations.changeLanguage('en'))
  expect(screen.getByRole('heading', { name: 'Model benchmark' })).toBeVisible()
  expect(
    screen.getByRole('button', { name: /Candy logic · .*Answer mismatch/ })
  ).toBeVisible()
})

it('filters groups by status and selection, then opens the saved question and original answer from the timeline', async () => {
  const user = userEvent.setup()
  renderPage()
  expect(
    await screen.findByRole('button', { name: 'gpt-public' })
  ).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByRole('button', { name: 'gpt-fast' })).toBeVisible()
  await user.click(
    within(screen.getByRole('group', { name: 'All statuses' })).getByRole(
      'button',
      { name: /Suspected degradation/ }
    )
  )
  expect(
    screen.queryByRole('button', { name: 'gpt-fast' })
  ).not.toBeInTheDocument()
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Benchmark group filter' }),
    'gpt-fast'
  )
  expect(screen.getByText('No matching groups')).toBeVisible()
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Benchmark group filter' }),
    'gpt-public'
  )
  await user.click(
    screen.getByRole('button', { name: /Candy logic · .*Answer mismatch/ })
  )
  const dialog = await screen.findByRole('dialog', { name: 'Benchmark result' })
  expect(
    await within(dialog).findByText('The saved candy question')
  ).toBeVisible()
  expect(within(dialog).getByText('Expected answer')).toBeVisible()
  expect(within(dialog).getByText('21', { exact: true })).toBeVisible()
  expect(within(dialog).getAllByText('29', { exact: true })).toHaveLength(2)
  expect(
    within(dialog).getByRole('button', { name: 'Copy prompt' })
  ).toBeEnabled()
})

it('lets the root administrator expand a group and queue a retest without modifying automatic settings', async () => {
  const user = userEvent.setup()
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'root', role: ROLE.SUPER_ADMIN })
  renderPage()
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: { queued: true } } })
  await user.click(await screen.findByRole('button', { name: 'gpt-public' }))
  await user.click(screen.getByRole('button', { name: 'Retest group' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/extensions/benchmark/admin/run', {
      group: 'gpt-public',
    })
  )
  expect(screen.getByRole('switch', { name: 'Auto refresh' })).toBeChecked()
})

it('paginates the artwork gallery and resets to the first page when the group filter changes', async () => {
  const user = userEvent.setup()
  const get = renderPage()
  get.mockImplementation(async (url, config) => {
    if (url.endsWith('/snapshot')) {
      return { data: { success: true, data: snapshot } }
    }
    if (url.endsWith('/artworks')) {
      const params = config?.params as { page?: number } | undefined
      const page = params?.page ?? 1
      return {
        data: {
          success: true,
          data: {
            items: [
              {
                ...run,
                id: 30 + page,
                kind: 'svg',
                status: 'passed',
                prompt_name: `Artwork page ${page}`,
              },
            ],
            total: 16,
            page,
            page_size: 15,
          },
        },
      }
    }
    return {
      data: {
        success: true,
        data: { ...run, output: '<svg><circle r="10"/></svg>' },
      },
    }
  })
  const gallery = await screen.findByRole('region', {
    name: 'SVG artwork gallery',
  })
  await waitFor(() =>
    expect(within(gallery).getByRole('button', { name: 'Next' })).toBeEnabled()
  )
  expect(
    within(gallery).getByRole('button', { name: 'Previous' })
  ).toBeDisabled()
  await user.click(within(gallery).getByRole('button', { name: 'Next' }))
  expect(
    await within(gallery).findByRole('button', { name: 'Artwork page 2' })
  ).toBeVisible()
  expect(within(gallery).getByRole('button', { name: 'Next' })).toBeDisabled()
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Benchmark group filter' }),
    'gpt-fast'
  )
  expect(
    await within(
      screen.getByRole('region', { name: 'SVG artwork gallery' })
    ).findByRole('button', { name: 'Artwork page 1' })
  ).toBeVisible()
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith('/api/extensions/benchmark/artworks', {
      params: { page: 1, group: 'gpt-fast' },
    })
  )
})

it('offers retry after an API failure and explains when the feature is disabled', async () => {
  const user = userEvent.setup()
  const get = renderPage({ ...snapshot, enabled: false, groups: [] })
  get.mockRejectedValueOnce(new Error('Network unavailable'))
  // The initial request is already in flight; explicitly refresh to exercise
  // the same failure path that a later automatic refresh would take.
  expect(
    await screen.findByText('Model benchmark is not enabled')
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Refresh' }))
  const retry = await screen.findByRole('button', { name: 'Retry' })
  await user.click(retry)
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Retry' })
    ).not.toBeInTheDocument()
  )
  expect(
    screen.getByText(
      'The administrator can configure checks in Plugins → Model benchmark.'
    )
  ).toBeVisible()
})
