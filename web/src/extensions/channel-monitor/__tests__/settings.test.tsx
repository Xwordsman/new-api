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

import { monitorSettingsSchema } from '../lib/schema'
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
      { ...saved, revision: 1 }
    )
  )
  client.clear()
})

it('saves a scheduled public discount even when the monitor is hidden', async () => {
  const user = userEvent.setup()
  const client = renderSettings()
  const saved = {
    revision: 2,
    enabled: false,
    groups: [
      {
        group: 'public',
        display_name: 'Public label',
        description: '',
        badge: 'Limited offer',
        promotion: {
          enabled: true,
          factor: 0.8,
          label: 'Evening offer',
          starts_at: 0,
          ends_at: 0,
          daily_start: '18:00',
          daily_end: '22:00',
          timezone: 'Asia/Shanghai',
        },
      },
    ],
  }
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, data: saved } })
  await screen.findByRole('switch', { name: 'Enable channel monitor' })
  await user.click(screen.getByRole('combobox', { name: 'Groups to display' }))
  await user.click(screen.getByRole('option', { name: 'public' }))
  await user.keyboard('{Escape}')
  expect(screen.getByRole('button', { name: 'public' })).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  await user.click(screen.getByRole('button', { name: 'public' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Display name' }),
    'Public label'
  )
  await user.type(
    screen.getByRole('textbox', { name: 'Group badge' }),
    'Limited offer'
  )
  await user.click(
    screen.getByRole('switch', { name: 'Enable public discount' })
  )
  expect(
    screen.getByRole('spinbutton', { name: 'Discount factor' })
  ).toHaveValue(0.8)
  await user.type(
    screen.getByRole('textbox', { name: 'Offer label' }),
    'Evening offer'
  )
  await user.type(screen.getByLabelText('Daily start time'), '18:00')
  await user.type(screen.getByLabelText('Daily end time'), '22:00')
  expect(
    screen.getByRole('button', { name: 'Offer starts' })
  ).toHaveTextContent('No time limit')
  expect(screen.getByRole('button', { name: 'Offer ends' })).toHaveTextContent(
    'No time limit'
  )
  expect(screen.getByText(/×0.3 × 0.8 = ×0.24/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/extensions/channel-monitor/admin/settings',
      { ...saved, revision: 1 }
    )
  )
  client.clear()
})

it('blocks a zero discount and associates validation feedback with the input', async () => {
  const user = userEvent.setup()
  const client = renderSettings({
    ...settings,
    settings: {
      revision: 1,
      enabled: true,
      groups: [
        {
          group: 'public',
          display_name: '',
          description: '',
          badge: '',
          promotion: {
            enabled: true,
            factor: 0.8,
            label: '',
            starts_at: 0,
            ends_at: 0,
            daily_start: '',
            daily_end: '',
            timezone: 'Asia/Shanghai',
          },
        },
      ],
    },
  })
  const put = vi.spyOn(api, 'put')
  const toggle = await screen.findByRole('button', { name: 'public' })
  await user.click(toggle)
  const input = await screen.findByRole('spinbutton', {
    name: 'Discount factor',
  })
  await user.clear(input)
  await user.type(input, '0')
  await user.click(toggle)
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(
    await screen.findByText(
      'Enter a discount factor greater than 0 and at most 1.'
    )
  ).toBeVisible()
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(input).toHaveAccessibleDescription(
    /Enter a discount factor greater than 0 and at most 1\./
  )
  expect(put).not.toHaveBeenCalled()
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

it.each([
  {
    patch: { factor: 1.1 },
    message: 'Enter a discount factor greater than 0 and at most 1.',
  },
  {
    patch: { starts_at: 200, ends_at: 100 },
    message: 'Offer end must be after its start.',
  },
  { patch: { daily_start: '25:00' }, message: 'Use HH:mm for daily times.' },
  {
    patch: { daily_start: '18:00' },
    message: 'Enter both daily times and use different start and end times.',
  },
  {
    patch: { daily_start: '18:00', daily_end: '18:00' },
    message: 'Enter both daily times and use different start and end times.',
  },
  {
    patch: { timezone: 'not/a-timezone' },
    message: 'Enter a valid IANA time zone.',
  },
])(
  'rejects invalid schedule $patch before it can be saved',
  ({ patch, message }) => {
    const result = monitorSettingsSchema.safeParse({
      revision: 1,
      enabled: true,
      groups: [
        {
          group: 'public',
          display_name: '',
          badge: '',
          description: '',
          promotion: {
            enabled: true,
            factor: 0.8,
            label: '',
            starts_at: 0,
            ends_at: 0,
            daily_start: '',
            daily_end: '',
            timezone: 'Asia/Shanghai',
            ...patch,
          },
        },
      ],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        message
      )
    }
  }
)
