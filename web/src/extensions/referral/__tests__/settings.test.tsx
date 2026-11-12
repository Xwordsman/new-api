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
import { render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { useSidebarConfig } from '@/hooks/use-sidebar-config'
import { useSidebarData } from '@/hooks/use-sidebar-data'
import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { useAuthStore } from '@/stores/auth-store'

import { SettingsForm } from '../components/settings-form'
import type { ReferralSettings } from '../types'

afterEach(() => {
  localStorage.clear()
  useAuthStore.getState().auth.reset()
})

it('saves all four configurable rules and preserves edits after a rejected save', async () => {
  const user = userEvent.setup()
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValueOnce({
      data: { success: false, message: 'Invalid referral parameters' },
    })
    .mockResolvedValueOnce({ data: { success: true, data: null } })
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <SettingsForm
        settings={{
          enabled: true,
          rate_bps: 500,
          window_days: 30,
          cooling_hours: 24,
          cap_quota: 50_000_000,
          cny_per_usd: '7.2',
          version: 3,
          started_at: 1700000000,
        }}
      />
    </QueryClientProvider>
  )
  for (const [label, value] of [
    ['Reward rate (%)', '7.25'],
    ['Reward window (days)', '45'],
    ['Cooling period (hours)', '12'],
    ['Per-invitee cap (USD)', '150'],
  ]) {
    const input = screen.getByRole('spinbutton', { name: label })
    await user.clear(input)
    await user.type(input, value)
  }
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  )
  expect(
    screen.getByRole('spinbutton', { name: 'Reward rate (%)' })
  ).toHaveValue(7.25)
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(put).toHaveBeenCalledTimes(2))
  expect(put).toHaveBeenLastCalledWith(
    '/api/extensions/referral/admin/settings',
    expect.objectContaining({
      rate_bps: 725,
      window_days: 45,
      cooling_hours: 12,
      cap_quota: 75_000_000,
      version: 3,
    })
  )
})

it('keeps the referral entry after a rejected disable and hides it immediately after a successful save', async () => {
  const user = userEvent.setup()
  const features = {
    channel_monitor: true,
    benchmark: true,
    referrals: true,
    leaderboard: true,
  }
  let savedEnabled = true
  vi.spyOn(api, 'get').mockImplementation(async () => ({
    data: {
      success: true,
      data: {
        extension_features: { ...features, referrals: savedEnabled },
      },
    },
  }))
  vi.spyOn(api, 'put')
    .mockResolvedValueOnce({
      data: { success: false, message: 'Invalid referral parameters' },
    })
    .mockImplementation(async (_url, settings) => {
      savedEnabled = (settings as ReferralSettings).enabled
      return { data: { success: true, data: settings } }
    })
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  client.setQueryData(STATUS_QUERY_KEY, { extension_features: features })
  useAuthStore.getState().auth.setUser({ id: 1, username: 'root', role: 1 })
  function Wrapper(props: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {props.children}
      </QueryClientProvider>
    )
  }
  const sidebar = renderHook(
    () => useSidebarConfig(useSidebarData().navGroups),
    { wrapper: Wrapper }
  )
  const form = render(
    <SettingsForm
      settings={{
        enabled: true,
        rate_bps: 500,
        window_days: 30,
        cooling_hours: 24,
        cap_quota: 50_000_000,
        cny_per_usd: '7.2',
        version: 3,
        started_at: 1700000000,
      }}
    />,
    { wrapper: Wrapper }
  )
  await user.click(
    screen.getByRole('switch', { name: 'Enable referral program' })
  )
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  )
  expect(
    sidebar.result.current
      .flatMap((group) => group.items)
      .map((item) => item.title)
  ).toContain('Referral program')

  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(
      sidebar.result.current
        .flatMap((group) => group.items)
        .map((item) => item.title)
    ).not.toContain('Referral program')
  )
  expect(
    sidebar.result.current
      .flatMap((group) => group.items)
      .map((item) => item.title)
  ).toContain('Community leaderboard')
  form.unmount()
  sidebar.unmount()
  client.clear()
})
