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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'

import { RequestProtectionSettingsPage } from '../settings-page'
import type { ProtectionSettings } from '../types'

const settings: ProtectionSettings = {
  revision: 4,
  enabled: true,
  mode: 'observe',
  groups: [],
  models: [],
  protocols: [],
  exempt_user_ids: [],
  max_body_bytes: 2097152,
  max_text_bytes: 262144,
  uninspected_action: 'observe',
  fail_closed: true,
  rules: [
    {
      id: 'example',
      name: 'Example override rule',
      enabled: true,
      kind: 'all',
      patterns: ['override', 'unrestricted'],
      sources: ['current'],
      action: 'observe',
      high_confidence: false,
      count_penalty: false,
    },
  ],
  window_minutes: 10,
  key_threshold: 3,
  key_suspend_minutes: 30,
  user_threshold: 10,
  user_suspend_minutes: 60,
  duplicate_seconds: 60,
  retention_days: 30,
  upstream_codes: [],
  alert_enabled: false,
  alert_emails: [],
  alert_minutes: 15,
  alert_threshold: 10,
}
let client: QueryClient

beforeEach(() => {
  client = createAppQueryClient()
  client.setDefaultOptions({
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: settings },
  })
})
afterEach(() => {
  client.clear()
  vi.restoreAllMocks()
})

function renderSettings() {
  render(
    <QueryClientProvider client={client}>
      <RequestProtectionSettingsPage />
    </QueryClientProvider>
  )
}

it('rejects invalid limits and saves the configured scope, restriction threshold and mode', async () => {
  const user = userEvent.setup()
  const saved = {
    ...settings,
    revision: 5,
    mode: 'enforce',
    groups: ['gpt', 'premium'],
    key_threshold: 5,
  } as const
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, data: saved } })
  renderSettings()
  const threshold = await screen.findByRole('spinbutton', {
    name: 'Key violation threshold',
  })
  await user.clear(threshold)
  await user.type(threshold, '-1')
  await user.click(screen.getAllByRole('button', { name: 'Save' })[0])
  await waitFor(() => expect(threshold).toHaveAttribute('aria-invalid', 'true'))
  expect(put).not.toHaveBeenCalled()
  await user.clear(threshold)
  await user.type(threshold, '5')
  await user.type(
    screen.getByRole('textbox', { name: 'Protected groups' }),
    'gpt\npremium'
  )
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Protection mode' }),
    'enforce'
  )
  vi.mocked(api.get).mockResolvedValue({ data: { success: true, data: saved } })
  await user.click(screen.getAllByRole('button', { name: 'Save' })[0])
  await waitFor(() =>
    expect(put).toHaveBeenCalledExactlyOnceWith(
      '/api/extensions/request-protection/admin/settings',
      { ...saved, revision: 4 }
    )
  )
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: 'Save' })[0]).toBeDisabled()
  )
})

it('preserves unsaved edits after a revision conflict and reloads only on explicit action', async () => {
  const user = userEvent.setup()
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: {
      success: false,
      message: 'Request protection changed. Reload and try again.',
    },
  })
  renderSettings()
  const threshold = await screen.findByRole('spinbutton', {
    name: 'Key violation threshold',
  })
  await user.clear(threshold)
  await user.type(threshold, '5')
  vi.mocked(api.get).mockResolvedValue({
    data: {
      success: true,
      data: { ...settings, revision: 5, key_threshold: 8 },
    },
  })
  await user.click(screen.getAllByRole('button', { name: 'Save' })[0])
  const reload = await screen.findByRole('button', {
    name: 'Reload saved settings',
  })
  expect(put).toHaveBeenCalledTimes(1)
  expect(threshold).toHaveValue(5)
  await user.click(reload)
  expect(threshold).toHaveValue(8)
  expect(screen.getAllByRole('button', { name: 'Save' })[0]).toBeDisabled()
})

it('runs unsaved rules locally without saving and keeps rule editors collapsed until expanded', async () => {
  const user = userEvent.setup()
  const put = vi.spyOn(api, 'put')
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      data: {
        decision: 'observe',
        eligible: false,
        hits: [],
        uninspected: '',
        digest: 'test-fingerprint',
      },
    },
  })
  renderSettings()
  const rule = await screen.findByRole('button', {
    name: 'Example override rule',
  })
  expect(rule).toHaveAttribute('aria-expanded', 'false')
  await user.click(rule)
  expect(rule).toHaveAttribute('aria-expanded', 'true')
  const patterns = screen.getByRole('textbox', {
    name: 'Patterns, one per line',
  })
  await user.clear(patterns)
  await user.type(patterns, 'custom marker')
  await user.click(screen.getByRole('button', { name: 'Run local test' }))
  expect(
    await screen.findByRole('heading', { name: 'Last local test result' })
  ).toBeVisible()
  expect(screen.getByText('No rules matched')).toBeVisible()
  expect(post).toHaveBeenCalledExactlyOnceWith(
    '/api/extensions/request-protection/admin/dry-run',
    expect.objectContaining({
      settings: {
        ...settings,
        rules: [{ ...settings.rules[0], patterns: ['custom marker'] }],
      },
    })
  )
  expect(put).not.toHaveBeenCalled()
})
