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
import { useAuthStore } from '@/stores/auth-store'

import { leaderboardQueryKey } from '../api'
import { leaderboardSettingsSchema, settingsToForm } from '../lib/schema'
import { LeaderboardSettingsPage } from '../settings-page'
import type { SettingsResponse } from '../types'

const fixture: SettingsResponse = {
  updated_at: 1800000000,
  settings: {
    revision: 2,
    enabled: true,
    interval_minutes: 30,
    top_n: 10,
    invitations: true,
    income: true,
    tokens: true,
    savings: true,
    cyber: true,
    mask_names: true,
    exclude_admins: true,
    excluded_user_ids: [],
    invitation_paid_only: true,
    warning_retention_days: 90,
    model_prefixes: ['gpt-', 'o3'],
    safety_codes: ['content_policy_violation'],
  },
}
let client: QueryClient

beforeEach(() => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'root', role: 100 })
  client = createAppQueryClient()
  client.setDefaultOptions({
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  })
})
afterEach(() => {
  client.clear()
  useAuthStore.getState().auth.reset()
  vi.restoreAllMocks()
})

function renderSettings() {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: fixture },
  })
  render(
    <QueryClientProvider client={client}>
      <LeaderboardSettingsPage />
    </QueryClientProvider>
  )
}

it('keeps advanced rules collapsed initially and saves edited rules and parsed user IDs', async () => {
  const user = userEvent.setup()
  renderSettings()
  const advanced = await screen.findByRole('button', {
    name: 'Privacy and counting rules',
  })
  expect(advanced).toHaveAttribute('aria-expanded', 'false')
  expect(
    screen.queryByRole('textbox', { name: 'Excluded user IDs' })
  ).not.toBeInTheDocument()
  advanced.focus()
  await user.keyboard('{Enter}')
  expect(advanced).toHaveAttribute('aria-expanded', 'true')
  const retention = screen.getByRole('spinbutton', {
    name: 'Warning retention (days)',
  })
  await user.clear(retention)
  await user.type(retention, '120')
  await user.type(
    screen.getByRole('textbox', { name: 'Excluded user IDs' }),
    '12, 34{Enter}56'
  )
  await user.click(advanced)
  const saved = {
    ...fixture.settings,
    revision: 3,
    warning_retention_days: 120,
    excluded_user_ids: [12, 34, 56],
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
      '/api/extensions/leaderboard/admin/settings',
      { ...saved, revision: 2 }
    )
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  )
})

it('expands invalid rules and preserves edits after the server rejects a save', async () => {
  const user = userEvent.setup()
  renderSettings()
  const advanced = await screen.findByRole('button', {
    name: 'Privacy and counting rules',
  })
  await user.click(advanced)
  const prefixes = screen.getByRole('textbox', {
    name: 'Safety warning model prefixes',
  })
  await user.clear(prefixes)
  await user.click(advanced)
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: {
      success: false,
      message: 'Leaderboard settings changed. Reload before saving.',
    },
  })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(advanced).toHaveAttribute('aria-expanded', 'true'))
  expect(prefixes).toHaveAttribute('aria-invalid', 'true')
  expect(put).not.toHaveBeenCalled()
  await user.type(prefixes, 'gpt-5')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(put).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  )
  expect(prefixes).toHaveValue('gpt-5')
})

it('preserves unsaved edits across a settings refresh and explicitly reloads a newer revision', async () => {
  const user = userEvent.setup()
  renderSettings()
  const interval = await screen.findByRole('spinbutton', {
    name: 'Refresh interval (minutes)',
  })
  await user.clear(interval)
  await user.type(interval, '60')
  vi.mocked(api.get).mockResolvedValue({
    data: {
      success: true,
      data: {
        ...fixture,
        settings: { ...fixture.settings, revision: 3, interval_minutes: 120 },
      },
    },
  })
  await act(async () => {
    await client.invalidateQueries({ queryKey: leaderboardQueryKey })
  })
  expect(interval).toHaveValue(60)
  await user.click(
    await screen.findByRole('button', { name: 'Reload saved settings' })
  )
  expect(interval).toHaveValue(120)
  expect(
    screen.queryByRole('button', { name: 'Reload saved settings' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
})

it('rejects invalid intervals, unsafe IDs, wildcard codes and missing active safety rules', () => {
  const values = settingsToForm(fixture.settings)
  expect(leaderboardSettingsSchema.safeParse(values).success).toBe(true)
  for (const invalid of [
    { interval_minutes: 0 },
    { top_n: 51 },
    { excluded_users: '9007199254740992' },
    { excluded_users: '-1' },
    { model_prefixes_text: 'gpt-*' },
    { safety_codes_text: 'content\u2003filter' },
    { safety_codes_text: '' },
  ]) {
    expect(
      leaderboardSettingsSchema.safeParse({ ...values, ...invalid }).success
    ).toBe(false)
  }
  expect(
    leaderboardSettingsSchema.safeParse({
      ...values,
      cyber: false,
      model_prefixes_text: '',
      safety_codes_text: '',
    }).success
  ).toBe(true)
})
