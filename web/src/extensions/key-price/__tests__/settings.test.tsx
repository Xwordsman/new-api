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
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'

import { KeyPriceSettingsPage } from '../settings-page'
import type { PriceSettings } from '../types'

const settings: PriceSettings = {
  revision: 4,
  enabled: true,
  default_protect: true,
  allow_opt_out: true,
  legacy_mode: 'ignore',
  increase_percent: 0,
  quote_ttl_seconds: 300,
}
let client: QueryClient

beforeEach(() => {
  client = createAppQueryClient()
  client.setDefaultOptions({
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  })
})
afterEach(() => {
  client.clear()
  vi.restoreAllMocks()
})

function renderSettings() {
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/settings')
        ? settings
        : { items: [], total: 0, page: 1 },
    },
  }))
  render(
    <QueryClientProvider client={client}>
      <KeyPriceSettingsPage />
    </QueryClientProvider>
  )
}

it('keeps protection history and its empty table inside a themed module', async () => {
  renderSettings()

  const history = screen
    .getByRole('heading', { name: 'Protection history' })
    .closest('.border')
  expect(history).toHaveClass('bg-card', 'rounded-xl')
  expect(history).toContainElement(
    await screen.findByText('No protection events yet')
  )
  expect(history).toContainElement(
    screen.getByRole('button', { name: 'Previous' })
  )
})

it('validates multiplier thresholds and quote lifetimes before saving all policy controls', async () => {
  const user = userEvent.setup()
  const saved = {
    ...settings,
    revision: 5,
    increase_percent: 10,
    quote_ttl_seconds: 600,
    allow_opt_out: false,
    legacy_mode: 'confirm',
  }
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, data: saved } })
  renderSettings()
  const threshold = await screen.findByRole('spinbutton', {
    name: 'Allowed increase (%)',
  })
  const ttl = screen.getByRole('spinbutton', {
    name: 'Confirmation quote validity (seconds)',
  })
  await user.clear(threshold)
  await user.type(threshold, '101')
  await user.clear(ttl)
  await user.type(ttl, '59')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(threshold).toHaveAttribute('aria-invalid', 'true'))
  expect(ttl).toHaveAttribute('aria-invalid', 'true')
  expect(
    screen.getAllByText('Check this value and the permitted limits')
  ).toHaveLength(2)
  expect(put).not.toHaveBeenCalled()
  await user.clear(threshold)
  await user.type(threshold, '10')
  await user.clear(ttl)
  await user.type(ttl, '600')
  await user.selectOptions(
    screen.getByRole('combobox', {
      name: 'Keys created before this plugin was installed',
    }),
    'confirm'
  )
  const optOut = screen.getByRole('switch', {
    name: 'Allow users to turn off protection for their Keys',
  })
  act(() => optOut.focus())
  await user.keyboard(' ')
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/settings')
        ? saved
        : { items: [], total: 0, page: 1 },
    },
  }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledExactlyOnceWith(
      '/api/extensions/key-price/admin/settings',
      { ...saved, revision: settings.revision }
    )
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  )
})

it('preserves pending edits during refresh and reloads a newer revision explicitly', async () => {
  const user = userEvent.setup()
  renderSettings()
  const threshold = await screen.findByRole('spinbutton', {
    name: 'Allowed increase (%)',
  })
  await user.clear(threshold)
  await user.type(threshold, '10')
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/settings')
        ? { ...settings, revision: 5, increase_percent: 20 }
        : { items: [], total: 0, page: 1 },
    },
  }))
  await act(() =>
    client.invalidateQueries({ queryKey: ['key-price', 'settings'] })
  )
  const reload = await screen.findByRole('button', {
    name: 'Reload saved settings',
  })
  expect(
    screen.getByRole('spinbutton', { name: 'Allowed increase (%)' })
  ).toHaveValue(10)
  await user.click(reload)
  expect(
    screen.getByRole('spinbutton', { name: 'Allowed increase (%)' })
  ).toHaveValue(20)
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
})
