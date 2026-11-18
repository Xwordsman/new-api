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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'

import { benchmarkSettingsSchema } from '../lib/schema'
import { BenchmarkSettingsPage } from '../settings-page'
import type { SettingsResponse } from '../types'

const fixture: SettingsResponse = {
  settings: {
    revision: 2,
    enabled: false,
    interval_minutes: 60,
    history_hours: 48,
    timeout_seconds: 300,
    retention_days: 30,
    candy_max_tokens: 4096,
    svg_max_tokens: 16384,
    candy_prompt: 'Candy question',
    candy_answer: '21',
    svg_prompts: [
      { name: 'Octopus', prompt: 'Draw an octopus', enabled: true },
    ],
    groups: [
      {
        group: 'gpt-public',
        model: 'gpt-4o',
        enabled: true,
        interval_minutes: 0,
        candy_enabled: true,
        svg_enabled: true,
      },
    ],
  },
  available_groups: [
    { group: 'gpt-public', models: ['gpt-4o'] },
    { group: 'gpt-fast', models: ['gpt-5'] },
  ],
}

function renderSettings(data = fixture) {
  const client = createAppQueryClient()
  client.setDefaultOptions({
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  })
  vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data } })
  render(
    <QueryClientProvider client={client}>
      <BenchmarkSettingsPage />
    </QueryClientProvider>
  )
  return client
}

it('saves the history display range independently from global and group detection intervals', async () => {
  const user = userEvent.setup()
  const client = renderSettings()
  const range = await screen.findByRole('combobox', {
    name: 'History display range',
  })
  expect(range).toHaveValue('48')
  await user.selectOptions(range, '72')
  const saved = { ...fixture.settings, revision: 3, history_hours: 72 }
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, data: saved } })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/extensions/benchmark/admin/settings',
      {
        ...fixture.settings,
        history_hours: 72,
      }
    )
  )
  expect(
    screen.getByRole('spinbutton', { name: 'Default interval (minutes)' })
  ).toHaveValue(60)
  client.clear()
})

it('rejects unsupported history ranges without accepting arbitrary hours', () => {
  expect(
    benchmarkSettingsSchema.safeParse({
      ...fixture.settings,
      history_hours: 36,
    }).success
  ).toBe(false)
})

it('preserves local prompts and upstream settings when switching result sources and saves the selected source', async () => {
  const user = userEvent.setup()
  const client = renderSettings({
    ...fixture,
    upstream_channels: [
      {
        id: 29,
        name: 'Upstream A',
        groups: ['gpt-public'],
        token_name: 'BENCHMARK_UPSTREAM_TOKEN_29',
        token_configured: false,
      },
    ],
  })
  await user.click(await screen.findByRole('button', { name: 'gpt-public' }))
  const source = screen.getByRole('combobox', { name: 'Result source' })
  expect(source).toHaveValue('local')
  await user.selectOptions(source, 'upstream')
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Upstream channel' }),
    '29'
  )
  expect(screen.getByText(/Upstream credential missing/)).toBeVisible()
  expect(screen.getByText('BENCHMARK_UPSTREAM_TOKEN_29')).toBeVisible()
  await user.type(
    screen.getByRole('textbox', { name: 'Upstream group' }),
    'Exact upstream group'
  )
  await user.selectOptions(source, 'local')
  expect(
    screen.queryByRole('textbox', { name: 'Upstream group' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Candy question' })).toHaveValue(
    'Candy question'
  )
  await user.selectOptions(source, 'upstream')
  expect(screen.getByRole('textbox', { name: 'Upstream group' })).toHaveValue(
    'Exact upstream group'
  )
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: { success: true, data: { ...fixture.settings, revision: 3 } },
  })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/extensions/benchmark/admin/settings',
      {
        ...fixture.settings,
        groups: [
          {
            ...fixture.settings.groups[0],
            mode: 'upstream',
            upstream_channel: 29,
            upstream_group: 'Exact upstream group',
          },
        ],
      }
    )
  )
  client.clear()
})

it('requires an exact upstream group and channel while allowing sync without local SVG prompts', () => {
  const settings = {
    ...fixture.settings,
    svg_prompts: [],
    groups: [
      {
        ...fixture.settings.groups[0],
        mode: 'upstream',
        upstream_channel: 29,
        upstream_group: 'Exact upstream group',
      },
    ],
  }
  expect(benchmarkSettingsSchema.safeParse(settings).success).toBe(true)
  expect(
    benchmarkSettingsSchema.safeParse({
      ...settings,
      groups: [{ ...settings.groups[0], upstream_group: '' }],
    }).success
  ).toBe(false)
  expect(
    benchmarkSettingsSchema.safeParse({
      ...settings,
      groups: [{ ...settings.groups[0], upstream_channel: 0 }],
    }).success
  ).toBe(false)
})

it('starts at 60 minutes with group settings collapsed and preserves edits across collapse and save', async () => {
  const user = userEvent.setup()
  const client = renderSettings()
  const toggle = await screen.findByRole('button', { name: 'gpt-public' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(
    screen.getByRole('spinbutton', { name: 'Default interval (minutes)' })
  ).toHaveValue(60)
  expect(
    screen.queryByRole('textbox', { name: 'Model' })
  ).not.toBeInTheDocument()
  toggle.focus()
  await user.keyboard('{Enter}')
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const interval = screen.getByRole('spinbutton', {
    name: 'Group interval (minutes)',
  })
  await user.clear(interval)
  await user.type(interval, '120')
  await user.click(toggle)
  await user.click(screen.getByRole('button', { name: 'Add prompt' }))
  await user.type(
    screen.getAllByRole('textbox', { name: 'Prompt name' })[1],
    'Clock'
  )
  await user.type(
    screen.getAllByRole('textbox', { name: 'SVG prompt' })[1],
    'Draw a clock'
  )
  const saved = {
    ...fixture.settings,
    revision: 3,
    groups: [{ ...fixture.settings.groups[0], interval_minutes: 120 }],
    svg_prompts: [
      ...fixture.settings.svg_prompts,
      { name: 'Clock', prompt: 'Draw a clock', enabled: true },
    ],
  }
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, data: saved } })
  vi.mocked(api.get).mockResolvedValue({
    data: { success: true, data: { ...fixture, settings: saved } },
  })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/extensions/benchmark/admin/settings',
      { ...saved, revision: 2 }
    )
  )
  client.clear()
})

it('shows an actionable validation error when enabled SVG groups have no active prompt', async () => {
  const user = userEvent.setup()
  const client = renderSettings()
  const put = vi.spyOn(api, 'put')
  await user.click(await screen.findByRole('button', { name: 'Remove prompt' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(
    await screen.findByRole('alert', { name: 'SVG prompt library' })
  ).toHaveTextContent('Invalid benchmark settings')
  expect(put).not.toHaveBeenCalled()
  client.clear()
})

it('expands invalid group fields and retains pending edits after a rejected save', async () => {
  const user = userEvent.setup()
  const client = renderSettings()
  const toggle = await screen.findByRole('button', { name: 'gpt-public' })
  await user.click(toggle)
  const model = screen.getByRole('textbox', { name: 'Model' })
  await user.clear(model)
  await user.click(toggle)
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByRole('textbox', { name: 'Model' })).toHaveAttribute(
    'aria-invalid',
    'true'
  )
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await user.type(model, 'gpt-5')
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: {
      success: false,
      message: 'Benchmark settings changed. Reload before saving.',
    },
  })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(put).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  )
  expect(model).toHaveValue('gpt-5')
  client.clear()
})

it('validates prompt bytes, Unicode name lengths and duplicate groups consistently with the server', () => {
  expect(
    benchmarkSettingsSchema.safeParse({
      ...fixture.settings,
      svg_prompts: [
        { name: '章'.repeat(160), prompt: '绘'.repeat(10666), enabled: true },
      ],
    }).success
  ).toBe(true)
  expect(
    benchmarkSettingsSchema.safeParse({
      ...fixture.settings,
      candy_prompt: '绘'.repeat(10667),
    }).success
  ).toBe(false)
  expect(
    benchmarkSettingsSchema.safeParse({
      ...fixture.settings,
      svg_prompts: [{ name: '🐙'.repeat(161), prompt: 'Draw', enabled: true }],
    }).success
  ).toBe(false)
  expect(
    benchmarkSettingsSchema.safeParse({
      ...fixture.settings,
      groups: [fixture.settings.groups[0], fixture.settings.groups[0]],
    }).success
  ).toBe(false)
  expect(
    benchmarkSettingsSchema.safeParse({
      ...fixture.settings,
      groups: [{ ...fixture.settings.groups[0], group: 'auto' }],
    }).success
  ).toBe(false)
})
