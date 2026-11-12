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
import i18next, { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import zhCN from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'

import { concurrencySettingsKey } from '../api'
import { concurrencySchema } from '../lib/schema'
import { ConcurrencySettingsPage } from '../settings-page'
import type { ConcurrencySettings, ConcurrencyStatus } from '../types'

const fixture: ConcurrencySettings = {
  revision: 2,
  enabled: false,
  default_user_limit: 5,
  default_channel_limit: 0,
  default_key_limit: 0,
  queue_timeout_ms: 0,
  max_queued_per_user: 0,
  lease_seconds: 120,
  groups: [],
  users: [],
  channels: [],
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

function renderSettings(
  status: ConcurrencyStatus = { mode: 'memory', items: [], max_items: 1000 },
  language = i18next
) {
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: { success: true, data: url.endsWith('/status') ? status : fixture },
  }))
  render(
    <I18nextProvider i18n={language}>
      <QueryClientProvider client={client}>
        <ConcurrencySettingsPage />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

it('uses the shipped Chinese translations and updates the settings when switching languages', async () => {
  const language = createInstance()
  await language.init({
    lng: 'zhCN',
    fallbackLng: 'en',
    keySeparator: false,
    nsSeparator: false,
    resources: { zhCN, en: { translation: {} } },
  })
  const user = userEvent.setup()
  renderSettings(undefined, language)

  expect(
    await screen.findByRole('switch', { name: '启用并发管理' })
  ).toBeVisible()
  expect(
    screen.getByRole('heading', { level: 1, name: '并发管理' })
  ).toBeVisible()
  expect(
    screen.getByRole('spinbutton', { name: '默认账户并发上限' })
  ).toHaveValue(5)
  expect(screen.getByRole('heading', { name: '实时并发' })).toBeVisible()
  expect(screen.getByText('暂无并发记录')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '渠道独立限额' }))
  expect(
    within(screen.getByRole('region', { name: '渠道独立限额' })).getByRole(
      'button',
      { name: '添加规则' }
    )
  ).toBeVisible()

  await act(() => language.changeLanguage('en'))
  expect(
    screen.getByRole('switch', { name: 'Enable concurrency management' })
  ).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Channel overrides' })
  ).toHaveAttribute('aria-expanded', 'true')

  await act(() => language.changeLanguage('zhCN'))
  expect(screen.getByRole('switch', { name: '启用并发管理' })).toBeVisible()
  expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  expect(
    screen.queryByText('Enable concurrency management')
  ).not.toBeInTheDocument()
})

it('keeps override rules collapsed and saves a channel rule after keyboard expansion', async () => {
  const user = userEvent.setup()
  renderSettings()
  const section = await screen.findByRole('button', {
    name: 'Channel overrides',
  })
  expect(section).toHaveAttribute('aria-expanded', 'false')
  expect(
    screen.queryByRole('spinbutton', { name: 'Channel ID' })
  ).not.toBeInTheDocument()
  section.focus()
  await user.keyboard('{Enter}')
  await user.click(
    within(screen.getByRole('region', { name: 'Channel overrides' })).getByRole(
      'button',
      { name: 'Add rule' }
    )
  )
  const channel = screen.getByRole('spinbutton', { name: 'Channel ID' })
  await user.clear(channel)
  await user.type(channel, '17')
  const capacity = screen.getByRole('spinbutton', { name: 'Concurrency limit' })
  await user.clear(capacity)
  await user.type(capacity, '12')
  await user.click(
    screen.getByRole('switch', { name: 'Enable concurrency management' })
  )
  const saved = {
    ...fixture,
    revision: 3,
    enabled: true,
    channels: [{ channel_id: 17, limit: 12, key_limit: 0 }],
  }
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, data: saved } })
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/status') ? { mode: 'memory', items: [] } : saved,
    },
  }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/extensions/concurrency/admin/settings',
      { ...saved, revision: 2 }
    )
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  )
})

it('reveals invalid hidden rules and retains edits after a revision conflict', async () => {
  const user = userEvent.setup()
  renderSettings()
  const section = await screen.findByRole('button', { name: 'User overrides' })
  await user.click(section)
  await user.click(
    within(screen.getByRole('region', { name: 'User overrides' })).getByRole(
      'button',
      { name: 'Add rule' }
    )
  )
  const userID = screen.getByRole('spinbutton', { name: 'User ID' })
  await user.click(section)
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: {
      success: false,
      message: 'Concurrency settings changed. Reload before saving.',
    },
  })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(section).toHaveAttribute('aria-expanded', 'true'))
  expect(userID).toHaveAttribute('aria-invalid', 'true')
  expect(
    screen.getByText('Check this value and the permitted limits')
  ).toBeInTheDocument()
  expect(put).not.toHaveBeenCalled()
  await user.clear(userID)
  await user.type(userID, '42')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(put).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  )
  expect(userID).toHaveValue(42)
})

it('preserves pending edits on refresh and loads a newer revision only on explicit reload', async () => {
  const user = userEvent.setup()
  renderSettings()
  const limit = await screen.findByRole('spinbutton', {
    name: 'Default account concurrency',
  })
  await user.clear(limit)
  await user.type(limit, '8')
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/status')
        ? { mode: 'redis', items: [] }
        : { ...fixture, revision: 3, default_user_limit: 10 },
    },
  }))
  await act(async () => {
    await client.invalidateQueries({ queryKey: concurrencySettingsKey })
  })
  expect(limit).toHaveValue(8)
  await user.click(
    await screen.findByRole('button', { name: 'Reload saved settings' })
  )
  expect(limit).toHaveValue(10)
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
})

it('blocks partially enabled queues and permits removing an override to restore defaults', async () => {
  const user = userEvent.setup()
  renderSettings()
  const wait = await screen.findByRole('spinbutton', {
    name: 'Maximum queue wait (milliseconds)',
  })
  await user.clear(wait)
  await user.type(wait, '1000')
  const put = vi.spyOn(api, 'put')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(
    await screen.findAllByText(
      'Set both queue limits to zero or both above zero'
    )
  ).toHaveLength(2)
  expect(put).not.toHaveBeenCalled()
  const groupSection = screen.getByRole('region', {
    name: 'Account group overrides',
  })
  await user.click(
    within(groupSection).getByRole('button', { name: 'Add rule' })
  )
  await user.type(screen.getByRole('textbox', { name: 'Account group' }), 'vip')
  await user.click(
    within(groupSection).getByRole('button', { name: 'Remove rule' })
  )
  expect(
    within(groupSection).getByText('No override rules. Default limits apply.')
  ).toBeInTheDocument()
})

it('shows Redis occupancy with safe credential fingerprints and unlimited capacity labels', async () => {
  renderSettings({
    mode: 'redis',
    max_items: 1000,
    items: [
      { resource: 'user:42', active: 2, limit: 5, admitted: 20, rejected: 3 },
      {
        resource: 'channel:17:key:abcdef1234567890',
        active: 1,
        limit: 0,
        admitted: 10,
        rejected: 0,
      },
      {
        resource: 'wait:user:42',
        active: 1,
        limit: 2,
        admitted: 4,
        rejected: 1,
      },
    ],
  })
  expect(await screen.findByText('Redis shared counters')).toBeInTheDocument()
  expect(screen.getByRole('cell', { name: 'User #42' })).toBeInTheDocument()
  expect(
    screen.getByRole('cell', { name: 'Account queue #42' })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('cell', {
      name: 'Channel #17 · Credential fingerprint abcdef123456',
    })
  ).toBeInTheDocument()
  expect(screen.getByRole('cell', { name: 'Unlimited' })).toBeInTheDocument()
})

it('rejects duplicate rules, invalid capacity and overlong UTF-8 groups before submission', () => {
  expect(concurrencySchema.safeParse(fixture).success).toBe(true)
  for (const invalid of [
    { default_user_limit: -1 },
    { default_key_limit: 100001 },
    { lease_seconds: 29 },
    { queue_timeout_ms: 1000 },
    { max_queued_per_user: 1 },
    {
      users: [
        { user_id: 42, limit: 5 },
        { user_id: 42, limit: 10 },
      ],
    },
    { groups: [{ group: '组'.repeat(22), limit: 5 }] },
    { groups: [{ group: ' vip', limit: 5 }] },
    { channels: [{ channel_id: 0, limit: 0, key_limit: 0 }] },
  ]) {
    expect(
      concurrencySchema.safeParse({ ...fixture, ...invalid }).success
    ).toBe(false)
  }
})
