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
import { readFileSync } from 'node:fs'

import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next, { type i18n } from 'i18next'
import postcss from 'postcss'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { formatTimestamp } from '@/lib/format'
import { createAppQueryClient } from '@/lib/query-client'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { groupStatus } from '../hooks/use-run-statuses'
import { BenchmarkPage } from '../index'
import type { BenchmarkGroup, BenchmarkRun, Snapshot } from '../types'

const clients: QueryClient[] = []
let stylesheet: HTMLStyleElement
beforeEach(() => {
  const css = postcss.parse(readFileSync('src/styles/benchmark.css', 'utf8'))
  // jsdom has no container layout; responsive behavior is checked in-browser.
  css.walkAtRules('container', (rule) => {
    rule.remove()
  })
  stylesheet = document.createElement('style')
  stylesheet.textContent = css.toString()
  document.head.append(stylesheet)
})
afterEach(() => {
  stylesheet.remove()
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
  history_hours: 24,
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

it('keeps a structurally valid but unreviewed SVG pending instead of claiming normal intelligence', () => {
  expect(
    groupStatus({
      ...group,
      svg_enabled: true,
      runs: [
        { ...run, status: 'passed' },
        { ...run, id: 23, kind: 'svg', status: 'passed' },
      ],
    })
  ).toBe('pending')
})

it('does not let a successful manual regeneration hide an automatic candy failure', () => {
  expect(
    groupStatus({
      ...group,
      runs: [
        {
          ...run,
          id: 23,
          status: 'passed',
          manual: true,
          source_run_id: run.id,
        },
        run,
      ],
    })
  ).toBe('suspected')
})

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

it('shows upstream authorization failures instead of a normal status from previously passed results', async () => {
  renderPage({
    ...snapshot,
    groups: [
      {
        ...group,
        mode: 'upstream',
        last_sync_at: 1800000000,
        sync_error: 'upstream_unauthorized',
        runs: [{ ...run, status: 'passed' }],
      },
    ],
  })
  expect(
    await screen.findByText('Upstream authorization required')
  ).toBeVisible()
  expect(screen.getByText('Sync upstream results')).toBeVisible()
  const card = screen
    .getByRole('button', { name: 'gpt-public' })
    .closest('[data-slot="accordion-item"]') as HTMLElement
  expect(within(card).queryByText('Checks normal')).not.toBeInTheDocument()
})

it('marks stale upstream results without presenting them as healthy checks', async () => {
  renderPage({
    ...snapshot,
    groups: [
      {
        ...group,
        mode: 'upstream',
        last_sync_at: 1799900000,
        sync_stale: true,
        runs: [{ ...run, status: 'passed' }],
      },
    ],
  })
  expect(await screen.findByText('Upstream results out of date')).toBeVisible()
  const card = screen
    .getByRole('button', { name: 'gpt-public' })
    .closest('[data-slot="accordion-item"]') as HTMLElement
  expect(within(card).queryByText('Checks normal')).not.toBeInTheDocument()
})

it('identifies imported model results and hides paid regeneration and local grading for administrators', async () => {
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'admin', role: ROLE.ADMIN })
  const user = userEvent.setup()
  const imported: BenchmarkRun = {
    ...run,
    origin: 'apizn',
    status: 'passed',
    expected: '',
    upstream_group: 'Exact upstream group',
    upstream_url: 'https://ai.apizn.com/pelican/11419',
    synced_at: 1800000000,
  }
  const data = {
    ...snapshot,
    groups: [
      {
        ...group,
        mode: 'upstream' as const,
        runs: [imported],
        last_sync_at: 1800000000,
      },
    ],
  }
  const get = renderPage(data)
  get.mockImplementation(async (url) => {
    if (url.endsWith('/snapshot')) return { data: { success: true, data } }
    if (url.endsWith('/runs/21')) {
      return { data: { success: true, data: imported } }
    }
    return {
      data: {
        success: true,
        data: { items: [], total: 0, page: 1, page_size: 15 },
      },
    }
  })
  await user.click(await screen.findByRole('button', { name: 'gpt-public' }))
  expect(
    await screen.findByRole('link', { name: 'View upstream result' })
  ).toHaveAttribute('href', 'https://ai.apizn.com/pelican/11419')
  expect(screen.getByText('Upstream verdict')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Regenerate result' })
  ).not.toBeInTheDocument()
  expect(screen.queryByText(/Passing rule:/)).not.toBeInTheDocument()
})

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
  expect(screen.getByRole('button', { name: /^待评估/ })).toBeVisible()
  expect(screen.getByRole('region', { name: 'SVG结构通过率' })).toBeVisible()
  await act(() => translations.changeLanguage('en'))
  expect(screen.getByRole('heading', { name: 'Model benchmark' })).toBeVisible()
  expect(
    screen.getByRole('button', { name: /Candy logic · .*Answer mismatch/ })
  ).toBeVisible()
  expect(
    screen.getByRole('button', { name: /^Awaiting visual review/ })
  ).toBeVisible()
  expect(
    screen.getByRole('region', { name: 'SVG structure pass rate' })
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
  expect(await screen.findByText('The saved candy question')).toBeVisible()
  expect(screen.getByRole('button', { name: 'gpt-public' })).toHaveAttribute(
    'aria-expanded',
    'true'
  )
  expect(
    screen.getByRole('button', { name: /Candy logic · .*Answer mismatch/ })
  ).toHaveAttribute('aria-pressed', 'true')
  await user.click(screen.getByRole('button', { name: 'View original output' }))
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

it('expands and collapses group results from the keyboard', async () => {
  const user = userEvent.setup()
  renderPage()
  const toggle = await screen.findByRole('button', { name: 'gpt-public' })
  toggle.focus()
  await user.keyboard('{Enter}')
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(await screen.findByText('The saved candy question')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('The saved candy question')).not.toBeInTheDocument()
})

it('lets root view saved results and refresh the page without allowing a manual detection', async () => {
  const user = userEvent.setup()
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'root', role: ROLE.SUPER_ADMIN })
  renderPage()
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: { queued: true } } })
  await user.click(await screen.findByRole('button', { name: 'gpt-public' }))
  expect(await screen.findByText('The saved candy question')).toBeVisible()
  expect(screen.getByText('Expected answer')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Regenerate result' })
  ).toBeEnabled()
  expect(
    screen.queryByRole('button', { name: 'Retest group' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Refresh' }))
  expect(post).not.toHaveBeenCalled()
  expect(screen.getByRole('switch', { name: 'Auto refresh' })).toBeChecked()
})

it('keeps empty hourly slots visible instead of stretching a single result across the day', async () => {
  renderPage()
  const lanes = await screen.findAllByRole('region', { name: 'Candy logic' })
  const lane = lanes[0]
  expect(within(lane).getAllByRole('button')).toHaveLength(24)
  expect(
    within(lane).getAllByRole('button', { name: /No checks yet/ })
  ).toHaveLength(23)
  expect(
    within(lane).getByRole('button', { name: /Answer mismatch/ })
  ).toHaveAttribute('aria-pressed', 'false')
  const cells = within(lane).getAllByRole('button')[0]
    .parentElement as HTMLElement
  expect(getComputedStyle(cells).justifyContent).toBe('flex-start')
  expect(getComputedStyle(cells).gap).toBe('var(--benchmark-cell-gap)')
  for (const cell of within(lane).getAllByRole('button')) {
    const style = getComputedStyle(cell)
    expect(style.height).toBe('28px')
    expect(style.maxWidth).toBe('16px')
    expect(style.flexShrink).toBe('1')
  }
})

it('uses the configured 72-hour range with local scrolling and keeps detection frequency unchanged', async () => {
  renderPage({ ...snapshot, history_hours: 72, groups: [group] })
  const lane = await screen.findByRole('region', { name: 'Candy logic' })
  expect(within(lane).getAllByRole('button')).toHaveLength(72)
  expect(screen.getByText('Every 60 min')).toBeVisible()
  expect(screen.getByText('−36 hours')).toBeVisible()
  expect(
    screen.getByText(formatTimestamp(snapshot.updated_at - 72 * 3600))
  ).toBeVisible()
  const scroller = lane.closest('.benchmark-lanes') as HTMLElement
  expect(getComputedStyle(scroller).overflowX).toBe('auto')
})

it('keeps daily latency statistics unchanged when older results are included in the display range', async () => {
  renderPage({
    ...snapshot,
    history_hours: 72,
    groups: [
      {
        ...group,
        runs: [
          run,
          {
            ...run,
            id: 24,
            created_at: run.created_at - 49 * 3600,
            latency_ms: 100000,
          },
        ],
      },
    ],
  })
  expect(await screen.findByText('1.2s')).toBeVisible()
  const lane = screen.getByRole('region', { name: 'Candy logic' })
  expect(
    within(lane).getAllByRole('button', { name: /Answer mismatch/ })
  ).toHaveLength(2)
})

it('preserves saved question line breaks and caps the expanded SVG preview at 400 by 300 without limiting the dialog', async () => {
  const user = userEvent.setup()
  const question =
    'Saved question\n\n| Shape | Apple |\n| Circle | 7 |\n\nReturn one number.'
  const svg: BenchmarkRun = {
    ...run,
    id: 23,
    kind: 'svg',
    status: 'passed',
    prompt_name: 'Giraffe on a skateboard',
    output: '<svg><circle r="10"/></svg>',
  }
  const data = {
    ...snapshot,
    groups: [{ ...group, svg_enabled: true, runs: [run, svg] }],
  }
  const get = renderPage(data)
  get.mockImplementation(async (url) => {
    if (url.endsWith('/snapshot')) return { data: { success: true, data } }
    if (url.endsWith('/artworks')) {
      return { data: { success: true, data: { items: [], total: 0 } } }
    }
    return {
      data: {
        success: true,
        data: url.endsWith('/runs/23') ? svg : { ...run, prompt: question },
      },
    }
  })
  await user.click(await screen.findByRole('button', { name: 'gpt-public' }))
  const prompt = await screen.findByLabelText('Saved prompt')
  expect(prompt.textContent).toBe(question)
  expect(getComputedStyle(prompt).whiteSpace).toBe('pre-wrap')
  expect(screen.getByText('Model final answer')).toBeVisible()
  expect(screen.getByText(/final answer must exactly match 21/)).toBeVisible()
  const artwork = await screen.findByRole('figure', {
    name: 'Giraffe on a skateboard',
  })
  const preview = within(artwork)
    .getByTitle('SVG artwork preview')
    .closest('.benchmark-preview')
  expect(preview).not.toBeNull()
  expect(getComputedStyle(preview as Element).maxWidth).toBe('400px')
  expect(getComputedStyle(preview as Element).aspectRatio).toBe('4 / 3')
  expect(within(artwork).getByText('gpt-public')).toBeVisible()
  expect(within(artwork).getByText('1.2s')).toBeVisible()
  await user.click(
    within(artwork).getByRole('button', { name: 'View details' })
  )
  const dialog = await screen.findByRole('dialog', { name: 'Benchmark result' })
  const enlarged = within(dialog)
    .getByTitle('SVG artwork preview')
    .closest('.benchmark-preview')
  expect(enlarged).not.toBeNull()
  expect(getComputedStyle(enlarged as Element).maxWidth).not.toBe('400px')
})

it('shows an active SVG check as checking when the candy check has already passed', async () => {
  renderPage({
    ...snapshot,
    groups: [
      {
        ...group,
        svg_enabled: true,
        runs: [
          { ...run, kind: 'svg', id: 23, status: 'running' },
          { ...run, status: 'passed' },
        ],
      },
    ],
  })
  const toggle = await screen.findByRole('button', { name: 'gpt-public' })
  expect(
    within(
      toggle.closest('[data-slot="accordion-item"]') as HTMLElement
    ).getAllByText('Checking').length
  ).toBeGreaterThan(0)
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

it('hides regeneration from ordinary users even when an original result is open', async () => {
  const user = userEvent.setup()
  useAuthStore
    .getState()
    .auth.setUser({ id: 2, username: 'member', role: ROLE.USER })
  renderPage()
  expect(
    screen.queryByRole('button', { name: 'Clean up history' })
  ).not.toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: 'gpt-public' }))
  expect(await screen.findByText('The saved candy question')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Regenerate result' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'View original output' }))
  const dialog = await screen.findByRole('dialog', { name: 'Benchmark result' })
  expect(
    within(dialog).queryByRole('button', { name: 'Delete result' })
  ).not.toBeInTheDocument()
  expect(
    within(dialog).queryByRole('button', { name: 'Review visual quality' })
  ).not.toBeInTheDocument()
  expect(
    within(dialog).queryByRole('button', { name: 'Regenerate result' })
  ).not.toBeInTheDocument()
})

it('requires a reason for an adverse visual review and displays the saved assessment without changing structural status', async () => {
  const user = userEvent.setup()
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'admin', role: ROLE.ADMIN })
  let svg: BenchmarkRun = {
    ...run,
    kind: 'svg',
    status: 'passed',
    output: '<svg><circle/></svg>',
    quality: '',
  }
  const data = {
    ...snapshot,
    groups: [
      { ...group, candy_enabled: false, svg_enabled: true, runs: [svg] },
    ],
  }
  const get = renderPage(data)
  get.mockImplementation(async (url) => {
    if (url.endsWith('/snapshot')) return { data: { success: true, data } }
    if (url.endsWith('/artworks')) {
      return { data: { success: true, data: { items: [], total: 0 } } }
    }
    return { data: { success: true, data: svg } }
  })
  const put = vi.spyOn(api, 'put').mockImplementation(async () => {
    svg = {
      ...svg,
      quality: 'abnormal',
      quality_reason: 'Detached wheels',
      reviewed_at: 1800000010,
    }
    return { data: { success: true, data: { reviewed_at: svg.reviewed_at } } }
  })
  await user.click(await screen.findByRole('button', { name: 'gpt-public' }))
  await user.click(
    await screen.findByRole('button', { name: 'Review visual quality' })
  )
  const dialog = await screen.findByRole('dialog', {
    name: 'Review visual quality',
  })
  await user.selectOptions(
    within(dialog).getByRole('combobox', { name: 'Visual quality' }),
    'abnormal'
  )
  await user.click(within(dialog).getByRole('button', { name: 'Save review' }))
  expect(await within(dialog).findByRole('alert')).toBeVisible()
  expect(
    within(dialog).getByRole('textbox', { name: 'Review reason' })
  ).toHaveAttribute('aria-invalid', 'true')
  expect(put).not.toHaveBeenCalled()
  await user.type(
    within(dialog).getByRole('textbox', { name: 'Review reason' }),
    'Detached wheels'
  )
  await user.click(within(dialog).getByRole('button', { name: 'Save review' }))
  expect(
    await screen.findByText('Review reason: Detached wheels')
  ).toBeVisible()
  const result = screen
    .getByText('Review reason: Detached wheels')
    .closest('article')
  if (!result) throw new Error('The review must remain attached to its result')
  expect(within(result).getByText('Visual quality abnormal')).toBeVisible()
  expect(within(result).getByText('SVG structure passed')).toBeVisible()
  expect(put).toHaveBeenCalledExactlyOnceWith(
    '/api/extensions/benchmark/admin/runs/21/quality',
    { quality: 'abnormal', reason: 'Detached wheels', reviewed_at: 0 }
  )
})

it('shows the latest result by default and lets a user switch to the original version', async () => {
  const user = userEvent.setup()
  const get = renderPage()
  const latest: BenchmarkRun = {
    ...run,
    id: 31,
    manual: true,
    source_run_id: run.id,
    status: 'passed',
    output: '21',
  }
  const versions = [latest, run]
  get.mockImplementation(async (url, config) => {
    if (url.endsWith('/snapshot')) {
      return { data: { success: true, data: snapshot } }
    }
    if (url.endsWith('/artworks')) {
      return { data: { success: true, data: { items: [], total: 0 } } }
    }
    const params = config?.params as { latest?: boolean } | undefined
    return {
      data: {
        success: true,
        data: { ...(params?.latest ? latest : run), versions },
      },
    }
  })
  await user.click(await screen.findByRole('button', { name: 'gpt-public' }))
  const select = await screen.findByRole('combobox', {
    name: 'Result versions',
  })
  expect(select).toHaveValue('latest')
  expect(screen.getByText('Manual regeneration')).toBeVisible()
  await user.selectOptions(select, '21')
  expect(await screen.findByText('29', { exact: true })).toBeVisible()
  expect(select).toHaveValue('21')
  expect(get).toHaveBeenCalledWith('/api/extensions/benchmark/runs/21', {
    params: { latest: false },
  })
})

it('keeps deletion confirmation open on failure and closes a deleted result after a successful retry', async () => {
  const user = userEvent.setup()
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'admin', role: ROLE.ADMIN })
  const get = renderPage()
  const remove = vi
    .spyOn(api, 'delete')
    .mockResolvedValueOnce({
      data: { success: false, message: 'Unable to load benchmark data' },
    })
    .mockImplementation(async () => {
      get.mockImplementation(async (url) => ({
        data: {
          success: true,
          data: url.endsWith('/artworks')
            ? { items: [], total: 0 }
            : { ...snapshot, groups: [] },
        },
      }))
      return {
        data: { success: true, data: { deleted_count: 1, next_run_id: 0 } },
      }
    })
  await user.click(await screen.findByRole('button', { name: 'gpt-public' }))
  await user.click(
    await screen.findByRole('button', { name: 'View original output' })
  )
  const result = await screen.findByRole('dialog', { name: 'Benchmark result' })
  await user.click(
    await within(result).findByRole('button', { name: 'Delete result' })
  )
  const confirm = await screen.findByRole('alertdialog', {
    name: 'Delete this benchmark result?',
  })
  expect(remove).not.toHaveBeenCalled()
  await user.click(
    within(confirm).getByRole('button', { name: 'Delete result' })
  )
  await waitFor(() =>
    expect(
      within(confirm).getByRole('button', { name: 'Delete result' })
    ).toBeEnabled()
  )
  expect(confirm).toBeVisible()
  await user.click(
    within(confirm).getByRole('button', { name: 'Delete result' })
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Benchmark result' })
    ).not.toBeInTheDocument()
  )
  expect(remove).toHaveBeenLastCalledWith(
    '/api/extensions/benchmark/admin/runs/21'
  )
})

it('previews a group history selection and deletes exactly those versions after confirmation', async () => {
  const user = userEvent.setup()
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'admin', role: ROLE.ADMIN })
  renderPage()
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValueOnce({
      data: { success: true, data: { count: 2, ids: [21, 31] } },
    })
    .mockResolvedValueOnce({
      data: { success: true, data: { deleted_count: 2 } },
    })
  await user.click(
    await screen.findByRole('button', { name: 'Clean up history' })
  )
  const dialog = await screen.findByRole('dialog', {
    name: 'Clean up benchmark history',
  })
  await user.selectOptions(
    within(dialog).getByRole('combobox', { name: 'Group' }),
    'gpt-public'
  )
  await user.click(
    within(dialog).getByRole('button', { name: 'Preview cleanup' })
  )
  const confirm = await screen.findByRole('alertdialog', {
    name: 'Delete selected benchmark results?',
  })
  expect(post).toHaveBeenCalledTimes(1)
  const selection = post.mock.calls[0][1] as {
    group: string
    after: number
    before: number
    preview: boolean
  }
  expect(selection).toMatchObject({ group: 'gpt-public', preview: true })
  await user.click(
    within(confirm).getByRole('button', { name: 'Delete results' })
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Clean up benchmark history' })
    ).not.toBeInTheDocument()
  )
  expect(post).toHaveBeenLastCalledWith(
    '/api/extensions/benchmark/admin/cleanup',
    { ...selection, preview: false, ids: [21, 31] }
  )
})

it('returns the artwork gallery to the last available page after history deletion reduces its page count', async () => {
  const user = userEvent.setup()
  let total = 16
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
            items:
              page === 1 || total > 15
                ? [
                    {
                      ...run,
                      id: 30 + page,
                      kind: 'svg',
                      status: 'passed',
                      prompt_name: `Artwork page ${page}`,
                    },
                  ]
                : [],
            total,
            page,
            page_size: 15,
          },
        },
      }
    }
    return { data: { success: true, data: run } }
  })
  const gallery = await screen.findByRole('region', {
    name: 'SVG artwork gallery',
  })
  await waitFor(() =>
    expect(within(gallery).getByRole('button', { name: 'Next' })).toBeEnabled()
  )
  await user.click(within(gallery).getByRole('button', { name: 'Next' }))
  expect(
    await within(gallery).findByRole('button', { name: 'Artwork page 2' })
  ).toBeVisible()
  total = 1
  await act(async () => {
    await clients[0].invalidateQueries({ queryKey: ['benchmark', 'artworks'] })
  })
  expect(
    await within(gallery).findByRole('button', { name: 'Artwork page 1' })
  ).toBeVisible()
  expect(
    within(gallery).getByRole('button', { name: 'Previous' })
  ).toBeDisabled()
})

it('queues an administrator regeneration once, opens the new record and preserves access to the original result and automatic schedule', async () => {
  const user = userEvent.setup()
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'admin', role: ROLE.ADMIN })
  const get = renderPage()
  const queued: BenchmarkRun = {
    ...run,
    id: 31,
    source_run_id: run.id,
    manual: true,
    status: 'running',
    output: '',
    error_code: '',
    finished_at: 0,
  }
  get.mockImplementation(async (url) => {
    if (url.endsWith('/snapshot')) {
      return { data: { success: true, data: snapshot } }
    }
    if (url.endsWith('/artworks')) {
      return {
        data: {
          success: true,
          data: { items: [], total: 0, page: 1, page_size: 15 },
        },
      }
    }
    return {
      data: { success: true, data: url.endsWith('/runs/31') ? queued : run },
    }
  })
  let complete: (value: unknown) => void = () => {}
  const post = vi.spyOn(api, 'post').mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve
      })
  )
  await user.click(await screen.findByRole('button', { name: 'gpt-public' }))
  await user.click(
    await screen.findByRole('button', { name: 'Regenerate result' })
  )
  const confirm = await screen.findByRole('alertdialog', {
    name: 'Regenerate this result?',
  })
  expect(
    within(confirm).getByText(
      /Automatic detection times and prompt rotation stay unchanged/
    )
  ).toBeVisible()
  await user.click(
    within(confirm).getByRole('button', { name: 'Regenerate result' })
  )
  expect(
    within(confirm).getByRole('button', { name: 'Regenerate result' })
  ).toBeDisabled()
  expect(within(confirm).getByRole('button', { name: 'Cancel' })).toBeDisabled()
  expect(post).toHaveBeenCalledExactlyOnceWith(
    '/api/extensions/benchmark/admin/runs/21/regenerate'
  )
  await act(async () => {
    complete({ data: { success: true, data: queued } })
  })
  const dialog = await screen.findByRole('dialog', { name: 'Benchmark result' })
  expect(await within(dialog).findByText('Manual regeneration')).toBeVisible()
  expect(
    within(dialog).getByRole('button', { name: 'Regenerate result' })
  ).toBeDisabled()
  expect(
    within(dialog).getByRole('button', { name: 'Delete result' })
  ).toBeDisabled()
  expect(
    within(dialog).queryByRole('button', { name: 'Review visual quality' })
  ).not.toBeInTheDocument()
  expect(
    clients[0].getQueryData<Snapshot>(['benchmark', 'snapshot'])?.groups[0]
      .next_at
  ).toBe(group.next_at)
  await user.click(
    within(dialog).getByRole('button', { name: 'View original result' })
  )
  expect(
    await within(dialog).findByText('The saved candy question')
  ).toBeVisible()
  expect(within(dialog).getAllByText('29', { exact: true })).toHaveLength(2)
  expect(
    within(dialog).getByRole('button', { name: 'Regenerate result' })
  ).toBeEnabled()
  expect(post).toHaveBeenCalledTimes(1)
})

it.each(['passed', 'request_failed'] as const)(
  'lets an administrator regenerate a %s SVG result and keeps the confirmation open on a rejected request',
  async (status) => {
    const user = userEvent.setup()
    useAuthStore
      .getState()
      .auth.setUser({ id: 1, username: 'root', role: ROLE.SUPER_ADMIN })
    const svg: BenchmarkRun = {
      ...run,
      kind: 'svg',
      status,
      prompt_name: 'Saved drawing',
      output: status === 'passed' ? '<svg><circle/></svg>' : '',
    }
    const data = {
      ...snapshot,
      groups: [
        { ...group, candy_enabled: false, svg_enabled: true, runs: [svg] },
      ],
    }
    const get = renderPage(data)
    get.mockImplementation(async (url) => {
      if (url.endsWith('/snapshot')) return { data: { success: true, data } }
      if (url.endsWith('/artworks')) {
        return { data: { success: true, data: { items: [], total: 0 } } }
      }
      return { data: { success: true, data: svg } }
    })
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        success: false,
        message: 'A benchmark regeneration is already running or queued',
      },
    })
    await user.click(await screen.findByRole('button', { name: 'gpt-public' }))
    await user.click(
      await screen.findByRole('button', { name: 'Regenerate result' })
    )
    const confirm = await screen.findByRole('alertdialog', {
      name: 'Regenerate this result?',
    })
    await user.click(
      within(confirm).getByRole('button', { name: 'Regenerate result' })
    )
    await waitFor(() =>
      expect(
        within(confirm).getByRole('button', { name: 'Regenerate result' })
      ).toBeEnabled()
    )
    expect(confirm).toBeVisible()
    expect(screen.queryByText('Manual regeneration')).not.toBeInTheDocument()
    expect(post).toHaveBeenCalledExactlyOnceWith(
      '/api/extensions/benchmark/admin/runs/21/regenerate'
    )
  }
)
