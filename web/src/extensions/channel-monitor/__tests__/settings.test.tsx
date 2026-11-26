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
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'

import { defaultProbeSettings } from '../lib/schema'
import { ChannelMonitorSettingsPage } from '../settings-page'
import type { MonitorSettingsResponse } from '../types'

const settings: MonitorSettingsResponse = {
  settings: { revision: 1, enabled: false, groups: [] },
  available_groups: [
    { group: 'public', ratio: 0.3 },
    { group: 'private', ratio: 0.5 },
  ],
}

afterEach(() => vi.restoreAllMocks())

function renderSettings(data = settings) {
  const client = createAppQueryClient()
  client.setDefaultOptions({
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  })
  vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data } })
  render(
    <QueryClientProvider client={client}>
      <ChannelMonitorSettingsPage />
    </QueryClientProvider>
  )
  return client
}

it('adds a private group to monitor publication without changing group access settings', async () => {
  const user = userEvent.setup()
  const client = renderSettings()
  const saved = {
    ...settings.settings,
    revision: 2,
    groups: [
      {
        group: 'private',
        display_name: '',
        description: '',
        badge: '',
        icon: '',
        promotion: null,
      },
    ],
    probe: defaultProbeSettings,
  }
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: { success: true, data: saved },
  })
  await user.click(
    await screen.findByRole('combobox', { name: 'Groups to display' })
  )
  await user.click(await screen.findByRole('option', { name: 'private' }))
  await user.keyboard('{Escape}')
  expect(screen.getByRole('button', { name: 'private' })).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/extensions/channel-monitor/admin/settings',
      { ...saved, revision: 1 }
    )
  )
  client.clear()
})

it('starts every selected group collapsed with its base multiplier visible', async () => {
  const client = renderSettings({
    ...settings,
    settings: {
      ...settings.settings,
      groups: settings.available_groups.map(({ group }) => ({
        group,
        display_name: '',
        description: '',
        badge: '',
        promotion: null,
      })),
    },
  })

  expect(await screen.findByRole('button', { name: 'public' })).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  expect(screen.getByRole('button', { name: 'private' })).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  expect(screen.getByRole('button', { name: 'public' })).toHaveTextContent(
    'Current base multiplier: ×0.3'
  )
  expect(screen.getByRole('button', { name: 'private' })).toHaveTextContent(
    'Current base multiplier: ×0.5'
  )
  expect(screen.queryByRole('textbox', { name: 'Display name' })).toBeNull()
  expect(
    screen.queryByRole('switch', { name: 'Enable public discount' })
  ).toBeNull()
  client.clear()
})

it('toggles groups independently with the mouse and keyboard', async () => {
  const user = userEvent.setup()
  const client = renderSettings({
    ...settings,
    settings: {
      ...settings.settings,
      groups: settings.available_groups.map(({ group }) => ({
        group,
        display_name: '',
        description: '',
        badge: '',
        promotion: null,
      })),
    },
  })
  const publicToggle = await screen.findByRole('button', { name: 'public' })
  const privateToggle = screen.getByRole('button', { name: 'private' })

  publicToggle.focus()
  await user.keyboard('{Enter}')
  expect(publicToggle).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('textbox', { name: 'Display name' })).toBeVisible()
  await user.click(privateToggle)
  expect(publicToggle).toHaveAttribute('aria-expanded', 'true')
  expect(privateToggle).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getAllByRole('textbox', { name: 'Display name' })).toHaveLength(
    2
  )

  publicToggle.focus()
  await user.keyboard(' ')
  expect(publicToggle).toHaveAttribute('aria-expanded', 'false')
  expect(privateToggle).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getAllByRole('textbox', { name: 'Display name' })).toHaveLength(
    1
  )
  client.clear()
})

it('retains unsaved group fields when collapsed and saves them while collapsed', async () => {
  const user = userEvent.setup()
  const data: MonitorSettingsResponse = {
    ...settings,
    settings: {
      ...settings.settings,
      groups: [
        {
          group: 'public',
          display_name: '',
          description: '',
          badge: '',
          promotion: null,
        },
      ],
    },
  }
  const client = renderSettings(data)
  const saved = {
    ...data.settings,
    revision: 2,
    groups: [{ ...data.settings.groups[0], display_name: 'Evening group' }],
  }
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: { success: true, data: saved },
  })
  const toggle = await screen.findByRole('button', { name: 'public' })
  await user.click(toggle)
  await user.type(
    screen.getByRole('textbox', { name: 'Display name' }),
    'Evening group'
  )
  await user.click(toggle)
  expect(screen.queryByRole('textbox', { name: 'Display name' })).toBeNull()
  await user.click(toggle)
  expect(screen.getByRole('textbox', { name: 'Display name' })).toHaveValue(
    'Evening group'
  )
  await user.click(toggle)
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/extensions/channel-monitor/admin/settings',
      { ...saved, revision: 1, probe: defaultProbeSettings }
    )
  )
  client.clear()
})

it('preserves unsaved metadata after a rejected save and resets the revision after success', async () => {
  const user = userEvent.setup()
  const data = {
    ...settings,
    settings: {
      revision: 3,
      enabled: true,
      groups: [
        {
          group: 'public',
          display_name: 'Original',
          description: '',
          badge: '',
          promotion: null,
        },
      ],
    },
  }
  const client = renderSettings(data)
  const saved = {
    ...data.settings,
    revision: 4,
    groups: [{ ...data.settings.groups[0], display_name: 'Changed' }],
  }
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValueOnce({
      data: {
        success: false,
        message: 'Channel monitor settings changed. Reload before saving.',
      },
    })
    .mockResolvedValueOnce({ data: { success: true, data: saved } })
  await user.click(await screen.findByRole('button', { name: 'public' }))
  const input = await screen.findByRole('textbox', { name: 'Display name' })
  await user.clear(input)
  await user.type(input, 'Changed')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(put).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  )
  expect(input).toHaveValue('Changed')
  vi.mocked(api.get).mockResolvedValue({
    data: { success: true, data: { ...data, settings: saved } },
  })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  )
  await user.click(screen.getByRole('button', { name: 'public' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Display name' }),
    ' again'
  )
  put.mockResolvedValue({ data: { success: false, message: 'Rejected' } })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(put).toHaveBeenLastCalledWith(
      '/api/extensions/channel-monitor/admin/settings',
      expect.objectContaining({ revision: 4 })
    )
  )
  client.clear()
})

it('keeps promotion editing in group pricing instead of monitor metadata', async () => {
  const client = renderSettings({
    ...settings,
    settings: {
      ...settings.settings,
      groups: [
        {
          group: 'public',
          display_name: '',
          description: '',
          badge: '',
          promotion: null,
        },
      ],
    },
  })
  await userEvent
    .setup()
    .click(await screen.findByRole('button', { name: 'public' }))
  expect(
    screen.queryByRole('switch', { name: 'Enable public discount' })
  ).toBeNull()
  expect(
    screen.getByText(
      'Manage public discounts in Group pricing. Removing a monitor group does not remove its discount.'
    )
  ).toBeVisible()
  client.clear()
})

it('saves a selected group icon and allows clearing it to restore automatic detection', async () => {
  const user = userEvent.setup()
  const data: MonitorSettingsResponse = {
    ...settings,
    settings: {
      ...settings.settings,
      groups: [
        {
          group: 'public',
          display_name: '',
          description: '',
          badge: '',
          promotion: null,
        },
      ],
    },
  }
  const client = renderSettings(data)
  const saved = {
    ...data.settings,
    revision: 2,
    groups: [{ ...data.settings.groups[0], icon: 'Claude.Color' }],
  }
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, data: saved } })
  await user.click(await screen.findByRole('button', { name: 'public' }))
  const input = screen.getByRole('combobox', { name: 'Group icon' })
  await user.type(input, 'Claude.Color')
  await user.click(await screen.findByRole('option', { name: 'Claude.Color' }))
  vi.mocked(api.get).mockResolvedValue({
    data: { success: true, data: { ...data, settings: saved } },
  })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(put).toHaveBeenLastCalledWith(
      '/api/extensions/channel-monitor/admin/settings',
      { ...saved, revision: 1, probe: defaultProbeSettings }
    )
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  )
  await user.click(screen.getByRole('button', { name: 'public' }))
  await user.click(screen.getByRole('button', { name: 'Clear' }))
  expect(screen.getByRole('combobox', { name: 'Group icon' })).toHaveValue('')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(put).toHaveBeenLastCalledWith(
      '/api/extensions/channel-monitor/admin/settings',
      {
        ...saved,
        groups: [{ ...saved.groups[0], icon: '' }],
        probe: defaultProbeSettings,
      }
    )
  )
  client.clear()
})

it('defaults probes off and saves selected models before allowing a manual probe', async () => {
  const user = userEvent.setup()
  const data: MonitorSettingsResponse = {
    settings: {
      revision: 1,
      enabled: true,
      groups: [
        {
          group: 'public',
          display_name: '',
          description: '',
          badge: '',
          promotion: null,
        },
      ],
    },
    available_groups: [
      { group: 'public', ratio: 0.3, models: ['text-small', 'text-large'] },
    ],
    probe_usage_24h: 3,
  }
  const client = renderSettings(data)
  const manual = await screen.findByRole('button', { name: 'Probe now' })
  expect(manual).toBeDisabled()
  expect(
    screen.getByRole('switch', { name: 'Enable automatic probes' })
  ).not.toBeChecked()
  expect(
    screen.getByRole('switch', { name: 'Only probe idle models' })
  ).toBeChecked()
  expect(
    screen.getByRole('spinbutton', { name: 'Probe interval (minutes)' })
  ).toHaveValue(30)
  expect(
    screen.getByRole('spinbutton', { name: 'Probe limit per rolling 24 hours' })
  ).toHaveValue(500)
  await user.click(screen.getByRole('button', { name: 'public' }))
  await user.click(
    screen.getByRole('combobox', { name: 'Probe models for public' })
  )
  await user.click(await screen.findByRole('option', { name: 'text-small' }))
  await user.keyboard('{Escape}')
  await user.click(
    screen.getByRole('switch', { name: 'Enable automatic probes' })
  )
  expect(manual).toBeDisabled()
  const saved = {
    ...data.settings,
    revision: 2,
    probe: { ...defaultProbeSettings, enabled: true },
    groups: [{ ...data.settings.groups[0], probe_models: ['text-small'] }],
  }
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, data: saved } })
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { task_id: 'probe-1', created: true } },
  })
  vi.mocked(api.get).mockResolvedValue({
    data: { success: true, data: { ...data, settings: saved } },
  })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/extensions/channel-monitor/admin/settings',
      { ...saved, revision: 1 }
    )
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Probe now' })).toBeEnabled()
  )
  expect(
    screen.getByText(
      '1 targets · up to 48 scheduled requests per day · 3 attempts in the last 24 hours'
    )
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Probe now' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/extensions/channel-monitor/admin/probe'
    )
  )
  client.clear()
})

it('rejects empty probe limits and clears automatic probing when monitoring is disabled', async () => {
  const user = userEvent.setup()
  const client = renderSettings({
    settings: {
      revision: 1,
      enabled: true,
      probe: { ...defaultProbeSettings, enabled: true },
      groups: [
        {
          group: 'public',
          display_name: '',
          description: '',
          badge: '',
          promotion: null,
          probe_models: ['text-small'],
        },
      ],
    },
    available_groups: [{ group: 'public', ratio: 0.3, models: ['text-small'] }],
  })
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: false, message: 'Rejected' } })
  const interval = await screen.findByRole('spinbutton', {
    name: 'Probe interval (minutes)',
  })
  await user.clear(interval)
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(
    await screen.findByText('Invalid channel monitor settings')
  ).toBeVisible()
  expect(put).not.toHaveBeenCalled()
  await user.type(interval, '30')
  await user.click(
    screen.getByRole('switch', { name: 'Enable channel monitor' })
  )
  const automatic = screen.getByRole('switch', {
    name: 'Enable automatic probes',
  })
  expect(automatic).not.toBeChecked()
  expect(automatic).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('button', { name: 'Probe now' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/extensions/channel-monitor/admin/settings',
      expect.objectContaining({
        enabled: false,
        probe: { ...defaultProbeSettings, enabled: false },
      })
    )
  )
  client.clear()
})
