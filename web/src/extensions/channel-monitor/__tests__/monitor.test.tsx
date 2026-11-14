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
import { QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'

import { GroupRatio } from '../components/group-ratio'
import { ChannelMonitorPage } from '../index'
import type { MonitorGroup, MonitorMetrics, MonitorSnapshot } from '../types'

const metrics: MonitorMetrics = {
  outcomes: 0,
  successes: 0,
  success_rate: null,
  ttft_seconds: null,
  tokens_per_second: null,
  cache_hit_rate: null,
  ttft_samples: 0,
  speed_samples: 0,
  cache_samples: 0,
  latency_seconds: null,
  latency_samples: 0,
  fastest_ttft_seconds: null,
  max_tokens_per_second: null,
}
const group: MonitorGroup = {
  ...metrics,
  group: 'public',
  display_name: 'Public group',
  description: 'Standard access',
  badge: 'Discount',
  promotion: null,
  offer: { active: true, factor: 0.8, label: '', next_start: 0, ends_at: 0 },
  ratio: 0.24,
  base_ratio: 0.3,
  status: 'unknown',
  timeline: [],
  models: [{ ...metrics, model: 'gpt-monitor', enabled: true }],
  sample_limited: false,
  observed_from: 1700000000,
}
const snapshot: MonitorSnapshot = {
  enabled: true,
  window: '24h',
  updated_at: 1700000000,
  refresh_seconds: 30,
  consume_logs_enabled: true,
  error_logs_enabled: true,
  sample_limit_per_group: 10000,
  groups: [group],
  summary: metrics,
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function renderMonitor() {
  const client = createAppQueryClient()
  client.setDefaultOptions({ queries: { retry: false, gcTime: 0 } })
  const result = render(
    <QueryClientProvider client={client}>
      <ChannelMonitorPage />
    </QueryClientProvider>
  )
  return { ...result, client }
}

it.each([
  {
    icon: 'Claude.Color',
    models: ['gpt-4o', 'gemini-2.5-pro'],
    expected: 'Claude',
  },
  { icon: '', models: ['gpt-4o', 'o3'], expected: 'OpenAI' },
  { icon: '', models: ['claude-sonnet-4'], expected: 'Claude' },
  { icon: '', models: ['gemini-2.5-pro'], expected: 'Gemini' },
  { icon: '', models: ['gpt-4o', 'gemini-2.5-pro'], expected: 'Group icon' },
  { icon: '', models: ['custom-model'], expected: 'Group icon' },
  { icon: '', models: [], expected: 'Group icon' },
])(
  'shows $expected for icon "$icon" and enabled models $models',
  async ({ icon, models, expected }) => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          ...snapshot,
          groups: [
            {
              ...group,
              icon,
              models: [
                ...models.map((model) => ({
                  ...metrics,
                  model,
                  enabled: true,
                })),
                { ...metrics, model: 'grok-4', enabled: false },
              ],
            },
          ],
        },
      },
    })
    const view = renderMonitor()
    expect(await screen.findByRole('img', { name: expected })).toBeVisible()
    view.client.clear()
  }
)

it('shows the initial loading state and lets a failed request be retried', async () => {
  const user = userEvent.setup()
  let reject: (reason: Error) => void = () => undefined
  vi.spyOn(api, 'get')
    .mockReturnValueOnce(
      new Promise((_resolve, rejectRequest) => {
        reject = rejectRequest
      })
    )
    .mockResolvedValueOnce({ data: { success: true, data: snapshot } })
  const view = renderMonitor()
  expect(screen.getByText('Loading...')).toBeVisible()
  reject(new Error('Monitor unavailable'))
  await user.click(await screen.findByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('Public group')).toBeVisible()
  view.client.clear()
})

it('uses the reference list typography without enlarging the page controls or summary cards', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        ...snapshot,
        groups: [
          {
            ...group,
            success_rate: 98.25,
            ttft_seconds: 1.23,
            tokens_per_second: 35.5,
            cache_hit_rate: 82.4,
          },
        ],
      },
    },
  })
  const view = renderMonitor()
  const name = await screen.findByRole('button', {
    name: 'Details for Public group',
  })
  expect(name).toHaveClass('text-sm', 'font-medium', 'leading-[21px]')
  const row = name.closest('tr')
  if (!row) throw new Error('Expected group table row')
  expect(within(row).getByText('Discount')).toHaveClass(
    'text-primary',
    'bg-primary/5',
    'text-[11.5px]'
  )
  expect(within(row).getByText(/public ·/)).toHaveClass('text-[11.5px]')
  expect(within(row).getByText('×0.24')).toHaveClass('text-primary')
  expect(
    within(row).getByText('Unknown').closest('[data-slot="status-badge"]')
  ).toHaveClass('text-[12.5px]', 'font-normal')
  expect(within(row).getByText('98.25%')).toHaveClass('text-[12.5px]')
  const cells = within(row).getAllByRole('cell')
  for (const index of [4, 5, 6]) {
    expect(cells[index]).toHaveClass('text-[13px]')
    expect(
      within(cells[index]).getByText(['s', 't/s', '%'][index - 4])
    ).toHaveClass('text-[10.5px]')
  }
  expect(screen.getByRole('table')).toHaveClass('[&_th]:text-xs')
  expect(screen.getByText('Auto refresh')).toHaveClass('text-xs')
  expect(screen.getByText('SUCCESS')).toHaveClass('text-[10px]')
  expect(
    screen.getByRole('textbox', { name: 'Search groups or models' })
  ).toHaveClass('text-xs')
  expect(
    screen.getByText(/Model base price × public group multiplier ·/)
  ).toHaveClass('text-[11px]')
  view.client.clear()
})

it.each([
  {
    data: { ...snapshot, enabled: false, groups: [] },
    title: 'Channel monitor is not enabled',
  },
  { data: { ...snapshot, groups: [] }, title: 'No matching groups' },
])(
  'explains the $title state without publishing unavailable data',
  async ({ data, title }) => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data } })
    const view = renderMonitor()
    expect(await screen.findByText(title)).toBeVisible()
    expect(screen.queryByText('Public group')).not.toBeInTheDocument()
    view.client.clear()
  }
)

it('searches models, filters status, sorts public ratios and expands public prices without claiming unobserved health', async () => {
  const user = userEvent.setup()
  const other: MonitorGroup = {
    ...group,
    group: 'fast',
    display_name: 'Fast group',
    badge: '',
    ratio: 0.1,
    status: 'healthy',
    models: [{ ...metrics, model: 'claude-monitor', enabled: true }],
  }
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/pricing') {
      return {
        data: {
          success: true,
          data: [
            {
              model_name: 'gpt-monitor',
              quota_type: 0,
              model_ratio: 1,
              completion_ratio: 2,
              enable_groups: ['public'],
            },
          ],
          vendors: [],
          group_ratio: { public: 0.12 },
          usable_group: { public: { desc: '', ratio: 0.12 } },
          supported_endpoint: {},
          auto_groups: [],
        },
      }
    }
    if (url === '/api/status') {
      return {
        data: { success: true, data: { price: 1, usd_exchange_rate: 1 } },
      }
    }
    return {
      data: { success: true, data: { ...snapshot, groups: [group, other] } },
    }
  })
  const view = renderMonitor()
  await screen.findByText('Public group')
  expect(screen.getByRole('button', { name: 'All' })).toHaveClass(
    'border-x-0',
    'border-t-0',
    'border-b-2'
  )
  await user.click(screen.getByRole('button', { name: 'Sort groups' }))
  await user.click(
    screen.getByRole('menuitemradio', { name: /Current multiplier/ })
  )
  expect(
    screen.getAllByRole('button', { name: /Models in / })[0]
  ).toHaveAccessibleName('Models in Fast group')
  await user.click(screen.getByRole('button', { name: 'Unknown' }))
  expect(screen.queryByText('Fast group')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'All' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Search groups or models' }),
    'gpt-monitor'
  )
  expect(screen.queryByText('Fast group')).not.toBeInTheDocument()
  const expand = screen.getByRole('button', { name: 'Models in Public group' })
  expect(expand).toHaveAttribute('aria-expanded', 'false')
  await user.click(expand)
  expect(expand).toHaveAttribute('aria-expanded', 'true')
  const details = screen.getByRole('region', { name: 'Public group' })
  expect(
    within(details).getByRole('heading', { name: /Group pricing/ })
  ).toBeVisible()
  expect(
    within(details).getByRole('heading', { name: /Available models/ })
  ).toBeVisible()
  expect(
    within(details).getByRole('heading', { name: /Period metrics/ })
  ).toBeVisible()
  expect(
    within(details).getByRole('heading', { name: /Service status/ })
  ).toBeVisible()
  const prices = await within(details).findByRole('button', {
    name: 'View prices for gpt-monitor',
  })
  await waitFor(() => expect(prices).toBeEnabled())
  expect(prices).toHaveTextContent('0.48')
  expect(prices).toHaveTextContent('0.96')
  expect(
    within(details).getByRole('button', { name: 'Copy model ID gpt-monitor' })
  ).toBeVisible()
  expect(within(details).queryByText('100%')).not.toBeInTheDocument()
  expect(within(details).getByText('8/10 of base price')).toBeVisible()
  await user.click(expand)
  expect(expand).toHaveAttribute('aria-expanded', 'false')
  expect(
    screen.queryByRole('region', { name: 'Public group' })
  ).not.toBeInTheDocument()
  view.client.clear()
})

it('changes the time range and refreshes manually after automatic refresh is disabled', async () => {
  const user = userEvent.setup()
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        ...snapshot,
        error_logs_enabled: false,
        groups: [{ ...group, sample_limited: true }],
      },
    },
  })
  const view = renderMonitor()
  await screen.findByText('Public group')
  expect(
    screen.getByText(/Consumption and error logging must both be enabled/)
  ).toBeVisible()
  expect(screen.getByText(/High-traffic groups show the latest/)).toBeVisible()
  await user.click(screen.getByRole('switch', { name: 'Auto refresh' }))
  expect(screen.getByRole('switch', { name: 'Auto refresh' })).not.toBeChecked()
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Time range' }),
    '30d'
  )
  await waitFor(() =>
    expect(get).toHaveBeenLastCalledWith(
      '/api/extensions/channel-monitor/snapshot',
      { params: { window: '30d' } }
    )
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
  )
  get.mockClear()
  await user.click(screen.getByRole('button', { name: 'Refresh' }))
  await waitFor(() => expect(get).toHaveBeenCalledOnce())
  view.client.clear()
})

it('shows public discount details on hover, keyboard focus and touch without opening the group', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        ...snapshot,
        groups: [
          {
            ...group,
            offer: {
              ...group.offer,
              label: 'Evening offer',
              ends_at: 1700000000,
            },
          },
        ],
      },
    },
  })
  const view = renderMonitor()
  const trigger = await screen.findByRole('button', {
    name: 'Discount details for Public group',
  })
  await user.hover(trigger)
  const details = await screen.findByRole('region', {
    name: 'Discount details',
  })
  expect(within(details).getByText('Evening offer')).toBeVisible()
  expect(within(details).getByText('×0.24')).toBeVisible()
  expect(within(details).getByText('×0.3')).toBeVisible()
  expect(within(details).getByText('8/10 of base price')).toBeVisible()
  expect(within(details).getByText('Asia/Shanghai')).toBeVisible()
  expect(within(details).getByText('Activity end time')).toBeVisible()
  expect(
    within(details).queryByText('Current period ends')
  ).not.toBeInTheDocument()
  expect(within(details).getByText(/11\/15.*06:13/)).toHaveAttribute(
    'datetime',
    '2023-11-14T22:13:20.000Z'
  )
  await user.unhover(trigger)
  await waitFor(() => expect(details).not.toBeInTheDocument())
  // Focus the badge through the row's preceding name button.
  screen.getByRole('button', { name: 'Details for Public group' }).focus()
  await user.tab()
  expect(trigger).toHaveFocus()
  expect(
    await screen.findByRole('region', { name: 'Discount details' })
  ).toBeVisible()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
  await waitFor(() =>
    expect(
      screen.queryByRole('region', { name: 'Discount details' })
    ).not.toBeInTheDocument()
  )
  await user.pointer([
    { keys: '[TouchA]', target: trigger },
    { keys: '[/TouchA]' },
  ])
  const touchDetails = await screen.findByRole('region', {
    name: 'Discount details',
  })
  expect(touchDetails).toBeVisible()
  // JSDOM has no geometry for the hover card's safe-polygon pointer handling.
  // Dispatch the portal click directly to verify it does not toggle the row.
  fireEvent.click(within(touchDetails).getByText('Asia/Shanghai'))
  expect(
    screen.queryByRole('region', { name: 'Public group' })
  ).not.toBeInTheDocument()
  view.client.clear()
})

it('shows the full expanded model list without a nested vertical scroll area', async () => {
  const user = userEvent.setup()
  const models = [
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-5',
    'gpt-5-mini',
    'gpt-5-nano',
    'o3',
    'o3-mini',
    'o4-mini',
  ]
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        ...snapshot,
        groups: [
          {
            ...group,
            models: models.map((model) => ({
              ...metrics,
              model,
              enabled: true,
            })),
          },
        ],
      },
    },
  })
  const view = renderMonitor()
  await user.click(
    await screen.findByRole('button', { name: 'Details for Public group' })
  )
  const list = screen.getByRole('list', { name: 'Available models' })
  expect(within(list).getAllByRole('listitem')).toHaveLength(11)
  expect(list).not.toHaveClass('max-h-72', 'overflow-y-auto')
  expect(
    within(list).getByRole('button', { name: 'Copy model ID o4-mini' })
  ).toBeVisible()
  view.client.clear()
})

it('opens scheduled regular pricing and distinguishes the next daily offer from the campaign deadline', async () => {
  const user = userEvent.setup()
  const now = Date.parse('2026-11-14T14:30:00Z')
  vi.spyOn(Date, 'now').mockReturnValue(now)
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        ...snapshot,
        groups: [
          {
            ...group,
            ratio: 0.3,
            offer: {
              ...group.offer,
              active: false,
              factor: 1,
              timezone: 'Asia/Shanghai',
              schedule: {
                evaluated_at: now / 1000,
                starts_at: 0,
                ends_at: Date.parse('2026-11-30T15:00:00Z') / 1000,
                daily_start: '21:00',
                daily_end: '22:00',
                period_start: Date.parse('2026-11-14T14:00:00Z') / 1000,
                period_end: Date.parse('2026-11-15T13:00:00Z') / 1000,
                next_factor: 0.1,
              },
            },
          },
        ],
      },
    },
  })
  const view = renderMonitor()
  await user.click(
    await screen.findByRole('button', {
      name: 'Pricing details for Public group',
    })
  )
  const details = await screen.findByRole('region', { name: 'Pricing details' })
  expect(within(details).getByText('Regular price')).toBeVisible()
  expect(within(details).getByText('Tomorrow 21:00')).toBeVisible()
  expect(within(details).getByText('22:30:00')).toBeVisible()
  expect(within(details).getByText('Discount ×0.03')).toBeVisible()
  expect(within(details).getByText('Activity end time')).toBeVisible()
  expect(within(details).getByText(/11\/30.*23:00/)).toBeVisible()
  expect(within(details).queryByText('Offer end time')).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Details for Public group' })
  ).toHaveAttribute('aria-expanded', 'false')
  view.client.clear()
})

it.each([
  { endsAt: 0, startsIn: -3600 },
  { endsAt: Date.parse('2026-11-30T15:00:00Z') / 1000, startsIn: -3600 },
  { endsAt: Date.parse('2026-11-30T15:00:00Z') / 1000, startsIn: 86400 },
])(
  'shows fixed-offer dates without daily periods when ending at $endsAt and starting in $startsIn seconds',
  async ({ endsAt, startsIn }) => {
    const user = userEvent.setup()
    const now = Date.parse('2026-11-14T13:30:00Z')
    vi.spyOn(Date, 'now').mockReturnValue(now)
    render(
      <GroupRatio
        receivedAt={now}
        group={{
          ...group,
          ratio: startsIn > 0 ? group.base_ratio : group.ratio,
          offer: {
            ...group.offer,
            active: startsIn <= 0,
            timezone: 'Asia/Shanghai',
            schedule: {
              evaluated_at: now / 1000,
              starts_at: now / 1000 + startsIn,
              ends_at: endsAt,
              daily_start: '',
              daily_end: '',
              period_start: startsIn > 0 ? 0 : now / 1000 + startsIn,
              period_end: startsIn > 0 ? now / 1000 + startsIn : endsAt,
              next_factor: startsIn > 0 ? 0.8 : 1,
            },
          },
        }}
      />
    )
    const detailsName = startsIn > 0 ? 'Pricing details' : 'Discount details'
    await user.click(
      screen.getByRole('button', { name: `${detailsName} for Public group` })
    )
    const details = await screen.findByRole('region', { name: detailsName })
    expect(within(details).getByText('Activity end time')).toBeVisible()
    expect(within(details).getByText('Asia/Shanghai')).toBeVisible()
    if (endsAt) {
      expect(within(details).getByText(/11\/30.*23:00/)).toHaveAttribute(
        'datetime',
        '2026-11-30T15:00:00.000Z'
      )
    } else {
      expect(within(details).getByText('No end time')).toBeVisible()
    }
    if (startsIn > 0) {
      expect(within(details).getByText('Next discount starts')).toBeVisible()
      expect(within(details).getByText(/11\/15.*21:30/)).toHaveAttribute(
        'datetime',
        '2026-11-15T13:30:00.000Z'
      )
    } else {
      expect(
        within(details).queryByText('Next discount starts')
      ).not.toBeInTheDocument()
    }
    for (const label of [
      'Current period',
      'Current period ends',
      'Next period',
    ]) {
      expect(within(details).queryByText(label)).not.toBeInTheDocument()
    }
    expect(within(details).queryByRole('timer')).not.toBeInTheDocument()
  }
)

it('counts down from server time while the multiplier details are open', async () => {
  vi.useFakeTimers()
  const receivedAt = Date.parse('2026-11-14T12:00:00Z')
  const serverNow = Date.parse('2026-11-14T13:59:58Z') / 1000
  vi.setSystemTime(receivedAt)
  render(
    <GroupRatio
      receivedAt={receivedAt}
      group={{
        ...group,
        offer: {
          ...group.offer,
          schedule: {
            evaluated_at: serverNow,
            starts_at: 0,
            ends_at: Date.parse('2026-11-30T15:00:00Z') / 1000,
            daily_start: '21:00',
            daily_end: '22:00',
            period_start: serverNow - 3598,
            period_end: serverNow + 2,
            next_factor: 1,
          },
        },
      }}
    />
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Discount details for Public group' })
  )
  await act(() => vi.advanceTimersByTimeAsync(100))
  expect(screen.getByText('Today 22:00')).toBeVisible()
  expect(screen.getByText('00:00:02')).toBeVisible()
  expect(screen.getByText('Regular price ×0.3')).toBeVisible()
  await act(() => vi.advanceTimersByTimeAsync(1000))
  expect(screen.getByText('00:00:01')).toBeVisible()
  await act(() => vi.advanceTimersByTimeAsync(1000))
  expect(screen.getByText('00:00:00')).toBeVisible()
})

it('refreshes the displayed multiplier at a period boundary even with metric auto-refresh disabled', async () => {
  vi.useFakeTimers()
  const now = Date.parse('2026-11-14T13:59:58Z')
  vi.setSystemTime(now)
  const schedule = {
    evaluated_at: now / 1000,
    starts_at: 0,
    ends_at: now / 1000 + 2,
    daily_start: '21:00',
    daily_end: '22:00',
    period_start: now / 1000 - 3598,
    period_end: now / 1000 + 2,
    next_factor: 1,
  }
  const scheduled: MonitorGroup = {
    ...group,
    offer: {
      ...group.offer,
      schedule,
    },
  }
  vi.spyOn(api, 'get')
    .mockResolvedValueOnce({
      data: { success: true, data: { ...snapshot, groups: [scheduled] } },
    })
    .mockResolvedValue({
      data: {
        success: true,
        data: {
          ...snapshot,
          groups: [
            {
              ...scheduled,
              ratio: 0.3,
              offer: {
                ...scheduled.offer,
                active: false,
                factor: 1,
                schedule: {
                  ...schedule,
                  evaluated_at: now / 1000 + 2,
                  period_start: now / 1000 + 2,
                  period_end: 0,
                },
              },
            },
          ],
        },
      },
    })
  const view = renderMonitor()
  await act(() => vi.advanceTimersByTimeAsync(100))
  const discount = screen.getByRole('button', {
    name: 'Discount details for Public group',
  })
  expect(discount).toHaveTextContent('×0.24')
  fireEvent.click(screen.getByRole('switch', { name: 'Auto refresh' }))
  expect(screen.getByRole('switch', { name: 'Auto refresh' })).not.toBeChecked()
  await act(() => vi.advanceTimersByTimeAsync(2000))
  const regular = screen.getByRole('button', {
    name: 'Pricing details for Public group',
  })
  expect(regular).toHaveTextContent('×0.3')
  fireEvent.click(regular)
  await act(() => vi.advanceTimersByTimeAsync(100))
  expect(screen.getByText('No upcoming change')).toBeVisible()
  expect(screen.queryByRole('timer')).not.toBeInTheDocument()
  view.client.clear()
})

it('only offers discount details for a currently reduced public multiplier and explains an unlimited offer', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        ...snapshot,
        groups: [
          group,
          {
            ...group,
            group: 'standard',
            display_name: 'Standard group',
            ratio: group.base_ratio,
            offer: { ...group.offer, active: false },
          },
        ],
      },
    },
  })
  const view = renderMonitor()
  await user.click(
    await screen.findByRole('button', {
      name: 'Discount details for Public group',
    })
  )
  expect(await screen.findByText('No end time')).toBeVisible()
  expect(
    screen.queryByRole('button', {
      name: 'Discount details for Standard group',
    })
  ).not.toBeInTheDocument()
  view.client.clear()
})

it('keeps all historical bars and the success percentage on one fluid line', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        ...snapshot,
        groups: [
          {
            ...group,
            success_rate: 99.47,
            timeline: Array.from({ length: 48 }, (_, index) => ({
              start: 1700000000 + index * 1800,
              end: 1700000000 + (index + 1) * 1800,
              status: 'healthy',
              outcomes: 100,
              successes: 100,
              success_rate: 100,
            })),
          },
        ],
      },
    },
  })
  const view = renderMonitor()
  const percentage = await screen.findByText('99.47%')
  expect(percentage).toHaveClass('shrink-0', 'tabular-nums')
  expect(percentage.parentElement).toHaveClass('flex', 'flex-nowrap', 'w-full')
  const history = within(
    screen.getByRole('cell', { name: /99.47%/ })
  ).getByRole('group', {
    name: 'Observed history',
  })
  expect(history).toHaveClass('flex-1', 'w-full', 'min-w-0')
  expect(within(history).getAllByRole('button')).toHaveLength(48)
  expect(screen.getByRole('table')).toHaveClass('min-w-260', 'table-fixed')
  expect(screen.getByRole('table').parentElement).toHaveClass('overflow-x-auto')
  await user.click(within(history).getAllByRole('button')[0])
  expect(
    screen.getByRole('button', { name: 'Details for Public group' })
  ).toHaveAttribute('aria-expanded', 'false')
  view.client.clear()
})

it.each([
  { state: 'populated', groups: [group] },
  { state: 'empty', groups: [] },
])(
  'keeps the $state monitor filters and results on one card outside the page heading',
  async ({ groups }) => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: { ...snapshot, groups } },
    })
    const view = renderMonitor()
    const search = await screen.findByRole('textbox', {
      name: 'Search groups or models',
    })
    const content = screen.getByRole('region', { name: 'Channel monitor' })
    expect(content).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto')
    expect(within(content).queryByRole('heading', { level: 1 })).toBeNull()
    const controls = screen.getByRole('group', { name: 'Filters' })
    expect(controls).toContainElement(search)
    expect(controls).toContainElement(
      screen.getByRole('button', { name: 'Sort groups' })
    )
    const surface = search.closest('[data-slot="card"]')
    expect(surface).toHaveClass('bg-card', 'rounded-xl', 'min-w-0')
    expect(surface).toContainElement(controls)
    expect(surface).toContainElement(
      screen.getByRole('group', { name: 'All statuses' })
    )
    if (groups.length > 0) {
      expect(surface).toContainElement(screen.getByRole('table'))
    } else {
      expect(surface).toContainElement(screen.getByText('No matching groups'))
    }
    view.client.clear()
  }
)

it.each([
  {
    label: 'Request success rate',
    direction: 'High → low',
    order: ['Alpha', 'Beta', 'Unknown'],
  },
  {
    label: 'Time to first token',
    direction: 'Low → high',
    order: ['Alpha', 'Beta', 'Unknown'],
  },
  {
    label: 'Generation speed',
    direction: 'High → low',
    order: ['Beta', 'Alpha', 'Unknown'],
  },
  {
    label: 'Cache hit rate',
    direction: 'High → low',
    order: ['Beta', 'Alpha', 'Unknown'],
  },
  {
    label: 'Current multiplier',
    direction: 'Low → high',
    order: ['Beta', 'Alpha', 'Unknown'],
  },
  { label: 'Name', direction: 'A→Z', order: ['Alpha', 'Beta', 'Unknown'] },
  {
    label: 'Configured order',
    direction: '',
    order: ['Beta', 'Unknown', 'Alpha'],
  },
])(
  'selects $label from the dropdown, updates the order and keeps missing metrics last',
  async ({ label, direction, order }) => {
    const user = userEvent.setup()
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          ...snapshot,
          groups: [
            {
              ...group,
              group: 'beta',
              display_name: 'Beta',
              success_rate: 90,
              ttft_seconds: 3,
              tokens_per_second: 30,
              cache_hit_rate: 80,
              ratio: 0.5,
            },
            { ...group, group: 'Unknown', display_name: '', ratio: 2 },
            {
              ...group,
              group: 'alpha',
              display_name: 'Alpha',
              success_rate: 98,
              ttft_seconds: 0,
              tokens_per_second: 0,
              cache_hit_rate: 0,
              ratio: 1,
            },
          ],
        },
      },
    })
    const view = renderMonitor()
    const trigger = await screen.findByRole('button', { name: 'Sort groups' })
    expect(trigger).toHaveTextContent('Request success rate')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu', { name: 'Sort groups' })
    expect(
      within(menu).getByRole('menuitemradio', { checked: true })
    ).toHaveTextContent('Request success rate')
    await user.click(
      within(menu).getByRole('menuitemradio', {
        name: `${label} ${direction}`.trim(),
      })
    )
    await waitFor(() =>
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
    )
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveTextContent(label)
    if (direction) expect(trigger).toHaveTextContent(direction)
    expect(
      screen
        .getAllByRole('button', { name: /Models in / })
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual(order.map((name) => `Models in ${name}`))
    await user.click(trigger)
    expect(
      screen.getByRole('menuitemradio', { checked: true })
    ).toHaveTextContent(label)
    view.client.clear()
  }
)

it('opens the sort dropdown by keyboard and restores focus when Escape dismisses it', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: snapshot },
  })
  const view = renderMonitor()
  const trigger = await screen.findByRole('button', { name: 'Sort groups' })
  trigger.focus()
  await user.keyboard('{ArrowDown}')
  expect(await screen.findByRole('menu', { name: 'Sort groups' })).toBeVisible()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  view.client.clear()
})

it('opens details from the row, preserves nested controls and allows keyboard collapse', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: snapshot },
  })
  const view = renderMonitor()
  const name = await screen.findByRole('button', {
    name: 'Details for Public group',
  })
  const row = screen.getByRole('row', { name: /Public group/ })
  await user.click(within(row).getAllByRole('cell')[2])
  expect(
    await screen.findByRole('region', { name: 'Public group' })
  ).toBeVisible()
  expect(name).toHaveAttribute('aria-expanded', 'true')
  name.focus()
  await user.keyboard('{Enter}')
  expect(name).toHaveAttribute('aria-expanded', 'false')
  await user.click(within(row).getAllByRole('cell')[3])
  expect(name).toHaveAttribute('aria-expanded', 'true')
  await user.click(
    screen.getByRole('button', { name: 'Copy model ID gpt-monitor' })
  )
  expect(name).toHaveAttribute('aria-expanded', 'true')
  await user.click(within(row).getAllByRole('cell')[2])
  expect(name).toHaveAttribute('aria-expanded', 'false')
  view.client.clear()
})
