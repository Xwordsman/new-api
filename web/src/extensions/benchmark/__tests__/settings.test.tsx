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
