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
  cleanup,
  render,
  screen,
  waitFor,
  within,
  act,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'

import { getSettings, redemptionStoreSettingsKey } from '../api'
import { RedemptionStoreSettingsPage } from '../settings-page'
import type { RedemptionStoreSettings } from '../types'

let client: QueryClient
let settings: RedemptionStoreSettings

beforeEach(() => {
  settings = { revision: 0, enabled: false, stores: [] }
  client = createAppQueryClient()
  client.setDefaultOptions({
    queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    mutations: { retry: false },
  })
  vi.spyOn(api, 'get').mockImplementation(async () => ({
    data: { success: true, data: structuredClone(settings) },
  }))
  vi.spyOn(api, 'put').mockImplementation(async (_url, data) => {
    settings = {
      ...(data as RedemptionStoreSettings),
      revision: settings.revision + 1,
    }
    return { data: { success: true, data: settings } }
  })
  vi.spyOn(toast, 'error').mockImplementation(() => 'error-toast')
  vi.spyOn(toast, 'success').mockImplementation(() => 'success-toast')
})

afterEach(() => {
  cleanup()
  client.clear()
  vi.restoreAllMocks()
})

function renderPage() {
  return render(
    <QueryClientProvider client={client}>
      <RedemptionStoreSettingsPage />
    </QueryClientProvider>
  )
}

test('an empty plugin can add multiple stores, toggle visibility, reorder and save', async () => {
  const user = userEvent.setup()
  renderPage()
  expect(await screen.findByText('No stores configured')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  await user.click(
    screen.getByRole('switch', { name: 'Enable redemption stores' })
  )
  await user.click(screen.getByRole('button', { name: 'Add store' }))
  const first = screen.getByRole('group', { name: 'Store 1' })
  expect(
    within(first).getByRole('button', { name: 'Move store up' })
  ).toBeDisabled()
  await user.type(
    within(first).getByRole('textbox', { name: 'Store name' }),
    'Main shop'
  )
  await user.type(
    within(first).getByRole('textbox', { name: 'Store URL' }),
    'https://main.example.com'
  )
  await user.click(screen.getByRole('button', { name: 'Add store' }))
  const second = screen.getByRole('group', { name: 'Store 2' })
  await user.type(
    within(second).getByRole('textbox', { name: 'Store name' }),
    'Backup shop'
  )
  await user.type(
    within(second).getByRole('textbox', { name: 'Store URL' }),
    'https://backup.example.com'
  )
  await user.click(
    within(second).getByRole('switch', { name: 'Show this store' })
  )
  await user.click(
    within(second).getByRole('button', { name: 'Move store up' })
  )
  expect(
    screen
      .getAllByRole('textbox', { name: 'Store name' })
      .map((input) => (input as HTMLInputElement).value)
  ).toEqual(['Backup shop', 'Main shop'])
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith('Redemption stores saved')
  )
  expect(api.put).toHaveBeenCalledWith(
    '/api/extensions/redemption-stores/admin/settings',
    {
      revision: 0,
      enabled: true,
      stores: [
        {
          id: expect.any(String),
          name: 'Backup shop',
          url: 'https://backup.example.com',
          description: '',
          enabled: false,
        },
        {
          id: expect.any(String),
          name: 'Main shop',
          url: 'https://main.example.com',
          description: '',
          enabled: true,
        },
      ],
    }
  )
  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
})

test('invalid purchase URLs show a field error and never reach the save endpoint', async () => {
  settings = {
    revision: 0,
    enabled: true,
    stores: [
      {
        id: 'primary',
        name: 'Shop',
        url: 'https://shop.example',
        description: '',
        enabled: true,
      },
    ],
  }
  const user = userEvent.setup()
  renderPage()
  const url = await screen.findByRole('textbox', { name: 'Store URL' })
  await user.clear(url)
  await user.type(url, 'javascript:alert(1)')
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  expect(
    await screen.findByText(
      'Enter a valid HTTP or HTTPS store URL without embedded credentials'
    )
  ).toBeVisible()
  expect(url).toHaveAttribute('aria-invalid', 'true')
  expect(api.put).not.toHaveBeenCalled()
})

test('removing a store requires confirmation and cancellation keeps its values', async () => {
  settings = {
    revision: 0,
    enabled: true,
    stores: [
      {
        id: 'primary',
        name: 'Shop',
        url: 'https://shop.example',
        description: '',
        enabled: true,
      },
    ],
  }
  const user = userEvent.setup()
  renderPage()
  await user.click(await screen.findByRole('button', { name: 'Remove store' }))
  let dialog = await screen.findByRole('alertdialog', { name: 'Remove store' })
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('textbox', { name: 'Store name' })).toHaveValue(
    'Shop'
  )
  await user.click(screen.getByRole('button', { name: 'Remove store' }))
  dialog = await screen.findByRole('alertdialog', { name: 'Remove store' })
  await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
  expect(await screen.findByText('No stores configured')).toBeVisible()
  expect(api.put).not.toHaveBeenCalled()
})

test('a failed save preserves the draft and a retry saves the same changes', async () => {
  const user = userEvent.setup()
  vi.mocked(api.put).mockResolvedValueOnce({
    data: {
      success: false,
      message: 'Redemption stores are temporarily unavailable',
    },
  })
  renderPage()
  await user.click(
    await screen.findByRole('switch', { name: 'Enable redemption stores' })
  )
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() => expect(toast.error).toHaveBeenCalled())
  expect(
    screen.getByRole('switch', { name: 'Enable redemption stores' })
  ).toBeChecked()
  expect(toast.success).not.toHaveBeenCalled()
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled()
  )
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith('Redemption stores saved')
  )
})

test('a newer server revision preserves unsaved changes until reload is confirmed', async () => {
  const user = userEvent.setup()
  renderPage()
  await user.click(
    await screen.findByRole('switch', { name: 'Enable redemption stores' })
  )
  settings = { revision: 1, enabled: false, stores: [] }
  await act(async () => {
    await client.fetchQuery({
      queryKey: redemptionStoreSettingsKey,
      queryFn: getSettings,
      staleTime: 0,
    })
  })
  expect(
    await screen.findByText('Redemption stores changed. Reload before saving.')
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  expect(
    screen.getByRole('switch', { name: 'Enable redemption stores' })
  ).toBeChecked()
  await user.click(
    screen.getByRole('button', { name: 'Reload saved settings' })
  )
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Reload saved settings',
  })
  await user.click(within(dialog).getByRole('button', { name: 'Reload' }))
  expect(
    screen.getByRole('switch', { name: 'Enable redemption stores' })
  ).not.toBeChecked()
  expect(api.put).not.toHaveBeenCalled()
})
