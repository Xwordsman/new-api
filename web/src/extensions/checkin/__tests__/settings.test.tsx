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
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { CHECKIN_QUERY_KEY } from '../api'
import { CheckinSettingsPage } from '../settings-page'
import type { CheckinSettings } from '../types'
import { checkinSettings } from './fixtures'

let client: QueryClient
const initialConfig = useSystemConfigStore.getState()

beforeEach(() => {
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
  client = createAppQueryClient()
  client.setDefaultOptions({
    queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    mutations: { retry: false },
  })
  client.setQueryData(['status'], { extension_features: { checkin: true } })
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/settings')
        ? checkinSettings
        : { items: [], total: 0, page: 1, page_size: 10 },
    },
  }))
  vi.spyOn(api, 'put').mockImplementation(async (_url, data) => ({
    data: { success: true, data: { ...(data as CheckinSettings), version: 2 } },
  }))
  vi.spyOn(toast, 'error').mockImplementation(() => 'error-toast')
  vi.spyOn(toast, 'success').mockImplementation(() => 'success-toast')
})

afterEach(() => {
  cleanup()
  client.clear()
  useSystemConfigStore.setState(initialConfig)
  vi.restoreAllMocks()
})

test('fixed rewards save the displayed USD amount as quota and refresh the feature status', async () => {
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <CheckinSettingsPage />
    </QueryClientProvider>
  )
  const reward = await screen.findByRole('spinbutton', {
    name: 'Daily reward (USD)',
  })
  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  expect(
    screen.getByRole('spinbutton', { name: 'Maximum daily reward (USD)' })
  ).toBeDisabled()
  await user.clear(reward)
  await user.type(reward, '0.025')
  await user.click(
    screen.getByRole('switch', { name: 'Enable check-in plugin' })
  )
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/api/extensions/checkin/settings', {
      ...checkinSettings,
      enabled: false,
      reward_min_quota: 12_500,
      reward_max_quota: 12_500,
    })
  )
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith('Check-in settings saved')
  )
  expect(client.getQueryState(['status'])?.isInvalidated).toBe(true)
})

test('random rewards reject an inverted range and save the corrected quota bounds', async () => {
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <CheckinSettingsPage />
    </QueryClientProvider>
  )
  await user.click(await screen.findByRole('combobox', { name: 'Reward mode' }))
  await user.click(screen.getByRole('option', { name: 'Random reward' }))
  const min = screen.getByRole('spinbutton', {
    name: 'Minimum daily reward (USD)',
  })
  const max = screen.getByRole('spinbutton', {
    name: 'Maximum daily reward (USD)',
  })
  await user.clear(min)
  await user.type(min, '0.05')
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  expect(
    await screen.findByText(
      'Maximum reward must be at least the minimum reward'
    )
  ).toBeVisible()
  expect(api.put).not.toHaveBeenCalled()
  await user.clear(max)
  await user.type(max, '0.10')
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith(
      '/api/extensions/checkin/settings',
      expect.objectContaining({
        reward_mode: 'random',
        reward_min_quota: 25_000,
        reward_max_quota: 50_000,
      })
    )
  )
})

test('invalid time zones and decimal payment thresholds show field errors without a request', async () => {
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <CheckinSettingsPage />
    </QueryClientProvider>
  )
  const timezone = await screen.findByRole('textbox', {
    name: 'Check-in time zone',
  })
  const threshold = screen.getByRole('textbox', {
    name: 'Minimum verified recharge',
  })
  await user.clear(timezone)
  await user.type(timezone, 'Invalid/Zone')
  await user.clear(threshold)
  await user.type(threshold, '-50')
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  expect(await screen.findByText('Enter a valid IANA time zone')).toBeVisible()
  expect(
    screen.getByText(
      'Enter a non-negative amount with up to six decimal places'
    )
  ).toBeVisible()
  expect(api.put).not.toHaveBeenCalled()
})

test('a concurrent settings update preserves unsaved edits until reload is confirmed', async () => {
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <CheckinSettingsPage />
    </QueryClientProvider>
  )
  const threshold = await screen.findByRole('textbox', {
    name: 'Minimum verified recharge',
  })
  await user.clear(threshold)
  await user.type(threshold, '60')
  act(() =>
    client.setQueryData([...CHECKIN_QUERY_KEY, 'settings'], {
      ...checkinSettings,
      version: 2,
      threshold_amount: '70',
    })
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Your edits are preserved'
  )
  expect(threshold).toHaveValue('60')
  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  await user.click(
    screen.getByRole('button', { name: 'Reload latest settings' })
  )
  let dialog = await screen.findByRole('alertdialog', {
    name: 'Reload latest settings',
  })
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(threshold).toHaveValue('60')
  await user.click(
    screen.getByRole('button', { name: 'Reload latest settings' })
  )
  dialog = await screen.findByRole('alertdialog', {
    name: 'Reload latest settings',
  })
  await user.click(within(dialog).getByRole('button', { name: 'Reload' }))
  await waitFor(() => expect(threshold).toHaveValue('70'))
  expect(api.put).not.toHaveBeenCalled()
})

test('a failed settings save keeps entered values and can be retried', async () => {
  const user = userEvent.setup()
  vi.mocked(api.put).mockResolvedValueOnce({
    data: { success: false, message: 'Check-in is temporarily unavailable' },
  })
  render(
    <QueryClientProvider client={client}>
      <CheckinSettingsPage />
    </QueryClientProvider>
  )
  const threshold = await screen.findByRole('textbox', {
    name: 'Minimum verified recharge',
  })
  await user.clear(threshold)
  await user.type(threshold, '60')
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() => expect(toast.error).toHaveBeenCalled())
  expect(threshold).toHaveValue('60')
  expect(toast.success).not.toHaveBeenCalled()
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled()
  )
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith('Check-in settings saved')
  )
  expect(api.put).toHaveBeenLastCalledWith(
    '/api/extensions/checkin/settings',
    expect.objectContaining({ threshold_amount: '60', version: 1 })
  )
})

test('zero recharge threshold disables dormant qualification expiry settings while preserving their values', async () => {
  const user = userEvent.setup()
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/settings')
        ? {
            ...checkinSettings,
            threshold_amount: '0',
            eligibility_days: 30,
            renew_on_recharge: true,
          }
        : { items: [], total: 0, page: 1, page_size: 10 },
    },
  }))
  render(
    <QueryClientProvider client={client}>
      <CheckinSettingsPage />
    </QueryClientProvider>
  )
  const duration = await screen.findByRole('spinbutton', {
    name: 'Qualification duration (days, 0 means no expiry)',
  })
  const renewal = screen.getByRole('switch', {
    name: 'Renew qualification after recharge',
  })
  expect(duration).toBeDisabled()
  expect(duration).toHaveValue(30)
  expect(renewal).toHaveAttribute('aria-disabled', 'true')
  expect(renewal).toBeChecked()
  expect(
    screen.getByText(
      'A zero recharge threshold removes recharge and qualification expiry requirements. Other checks still apply.'
    )
  ).toBeVisible()
  const threshold = screen.getByRole('textbox', {
    name: 'Minimum verified recharge',
  })
  await user.clear(threshold)
  await user.type(threshold, '50')
  expect(duration).toBeEnabled()
  expect(duration).toHaveValue(30)
  expect(renewal).not.toHaveAttribute('aria-disabled', 'true')
  expect(renewal).toBeChecked()
})
