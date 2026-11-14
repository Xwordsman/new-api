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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { afterEach, expect, it, vi } from 'vitest'

import { SettingsPageProvider } from '@/features/system-settings/components/settings-page-context'
import type { GroupFormValues } from '@/features/system-settings/models/group-ratio-form'
import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'

import type { PricingSnapshot, PricingUpdate } from '../api'
import { promotionSchema } from '../schema'
import { GroupPricingWorkspace } from '../workspace'

const settings: PricingSnapshot = {
  options: {
    GroupRatio: '{"public":0.3,"vip":0.5}',
    GroupDisplayOrder: '["vip","public"]',
    TopupGroupRatio: '{"public":1.1}',
    UserUsableGroups: '{"public":"Public","vip":"VIP"}',
    GroupGroupRatio: '{"public":{"vip":0.4},"member":{"public":0.2}}',
    AutoGroups: '["public","vip"]',
    MaxTokenAutoGroups: '5',
    DefaultUseAutoGroup: 'false',
    'group_ratio_setting.group_special_usable_group':
      '{"public":{"+:vip":"VIP"},"member":{"+:public":"Public","-:public":"Hidden"}}',
  },
  promotions: { revision: 1, groups: [] },
}
const rule = {
  enabled: true,
  ratio: 0.24,
  label: '',
  starts_at: 0,
  ends_at: 0,
  daily_start: '',
  daily_end: '',
  timezone: 'Asia/Shanghai',
}
afterEach(() => vi.restoreAllMocks())

function Fixture() {
  const [actions, setActions] = useState<HTMLDivElement | null>(null)
  const form = useForm<GroupFormValues>()
  return (
    <SettingsPageProvider actionsContainer={actions}>
      <div ref={setActions} />
      <GroupPricingWorkspace form={form} />
    </SettingsPageProvider>
  )
}
function renderPricing(data = settings) {
  const client = createAppQueryClient()
  client.setDefaultOptions({
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  })
  vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data } })
  const put = vi.spyOn(api, 'put').mockImplementation(async (_path, update) => {
    const payload = update as PricingUpdate
    return {
      data: {
        success: true,
        data: {
          options: payload.options,
          promotions: {
            ...payload.promotions,
            revision: payload.promotions.revision + 1,
          },
        },
      },
    }
  })
  render(
    <QueryClientProvider client={client}>
      <Fixture />
    </QueryClientProvider>
  )
  return { client, put }
}

it('saves final public pricing and daily schedule together, including collapsed offers', async () => {
  const user = userEvent.setup()
  const { client, put } = renderPricing()
  const toggle = await screen.findByRole('button', {
    name: 'Public discount for public',
  })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  toggle.focus()
  await user.keyboard('{Enter}')
  await user.click(
    screen.getByRole('switch', { name: 'Enable public discount' })
  )
  expect(
    screen.getByRole('spinbutton', { name: 'Discounted multiplier' })
  ).toHaveValue(0.24)
  await user.type(
    screen.getByRole('textbox', { name: 'Offer label' }),
    'Evening offer'
  )
  fireEvent.change(screen.getByLabelText('Daily start time'), {
    target: { value: '18:00' },
  })
  fireEvent.change(screen.getByLabelText('Daily end time'), {
    target: { value: '22:00' },
  })
  await user.click(toggle)
  await user.click(screen.getByRole('button', { name: 'Save group settings' }))
  await waitFor(() => expect(put).toHaveBeenCalledOnce())
  expect(put).toHaveBeenCalledWith(
    '/api/extensions/group-pricing/admin/settings',
    expect.objectContaining({
      baseline: settings.options,
      renames: {},
      promotions: {
        revision: 1,
        groups: [
          {
            group: 'public',
            promotion: {
              ...rule,
              label: 'Evening offer',
              daily_start: '18:00',
              daily_end: '22:00',
            },
          },
        ],
      },
      options: expect.objectContaining({
        GroupRatio: settings.options.GroupRatio,
      }),
    })
  )
  client.clear()
})

it('preserves offers and references across repeated visual renames and a JSON editor remount', async () => {
  const user = userEvent.setup()
  const { client, put } = renderPricing({
    ...settings,
    promotions: { revision: 1, groups: [{ group: 'public', promotion: rule }] },
  })
  const input = (
    await screen.findAllByRole<HTMLInputElement>('textbox', {
      name: 'Group name',
    })
  ).find((field) => field.value === 'public')
  if (!input) throw new Error('Expected public group name input')
  await user.clear(input)
  await user.type(input, 'gpt-1')
  await user.tab()
  expect(
    screen.getByRole('button', { name: 'Public discount for gpt-1' })
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Switch to JSON' }))
  expect(
    screen.getByRole('textbox', { name: 'Inter-group overrides' })
  ).toHaveValue(
    JSON.stringify({ 'gpt-1': { vip: 0.4 }, member: { 'gpt-1': 0.2 } })
  )
  await user.click(screen.getByRole('button', { name: 'Switch to Visual' }))
  const renamed = screen
    .getAllByRole<HTMLInputElement>('textbox', { name: 'Group name' })
    .find((field) => field.value === 'gpt-1')
  if (!renamed) throw new Error('Expected gpt-1 group name input')
  await user.clear(renamed)
  await user.type(renamed, 'gpt')
  await user.tab()
  await user.click(screen.getByRole('button', { name: 'Move gpt up' }))
  await user.click(screen.getByRole('button', { name: 'Save group settings' }))
  await waitFor(() => expect(put).toHaveBeenCalledOnce())
  const update = put.mock.calls[0][1] as PricingUpdate
  expect(update.renames).toEqual({ public: 'gpt' })
  expect(JSON.parse(update.options.GroupRatio)).toEqual({ gpt: 0.3, vip: 0.5 })
  expect(JSON.parse(update.options.TopupGroupRatio)).toEqual({ gpt: 1.1 })
  expect(JSON.parse(update.options.GroupDisplayOrder)).toEqual(['gpt', 'vip'])
  expect(JSON.parse(update.options.AutoGroups)).toEqual(['gpt', 'vip'])
  expect(JSON.parse(update.options.GroupGroupRatio)).toEqual({
    gpt: { vip: 0.4 },
    member: { gpt: 0.2 },
  })
  expect(
    JSON.parse(update.options['group_ratio_setting.group_special_usable_group'])
  ).toEqual({
    gpt: { '+:vip': 'VIP' },
    member: { '+:gpt': 'Public', '-:gpt': 'Hidden' },
  })
  expect(update.promotions.groups).toEqual([{ group: 'gpt', promotion: rule }])
  client.clear()
})

it('expands invalid offers with accessible feedback and retains drafts after a rejected save', async () => {
  const user = userEvent.setup()
  const { client, put } = renderPricing({
    ...settings,
    promotions: { revision: 1, groups: [{ group: 'public', promotion: rule }] },
  })
  const toggle = await screen.findByRole('button', {
    name: 'Public discount for public',
  })
  await user.click(toggle)
  const input = screen.getByRole('spinbutton', {
    name: 'Discounted multiplier',
  })
  fireEvent.change(input, { target: { value: '0' } })
  await user.click(toggle)
  await user.click(screen.getByRole('button', { name: 'Save group settings' }))
  expect(
    await screen.findByText('Enter a positive discounted multiplier.')
  ).toBeVisible()
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(input).toHaveAccessibleDescription(
    /Enter a positive discounted multiplier/
  )
  expect(put).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: '0.12' } })
  put.mockResolvedValueOnce({
    data: {
      success: false,
      message: 'Group pricing changed. Reload before saving.',
    },
  })
  await user.click(screen.getByRole('button', { name: 'Save group settings' }))
  await waitFor(() => expect(put).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Save group settings' })
    ).toBeEnabled()
  )
  expect(input).toHaveValue(0.12)
  await user.click(screen.getByRole('button', { name: 'Save group settings' }))
  await waitFor(() => expect(put).toHaveBeenCalledTimes(2))
  expect((put.mock.calls[1][1] as PricingUpdate).promotions).toEqual({
    revision: 1,
    groups: [{ group: 'public', promotion: { ...rule, ratio: 0.12 } }],
  })
  client.clear()
})

it('reverts renames with invalid related JSON and safely returns to the visual editor', async () => {
  const user = userEvent.setup()
  const { client } = renderPricing({
    ...settings,
    promotions: { revision: 1, groups: [{ group: 'public', promotion: rule }] },
  })
  await user.click(
    await screen.findByRole('button', { name: 'Switch to JSON' })
  )
  fireEvent.input(
    screen.getByRole('textbox', { name: 'Inter-group overrides' }),
    { target: { value: '[null]' } }
  )
  await user.click(screen.getByRole('button', { name: 'Switch to Visual' }))
  const name = screen
    .getAllByRole<HTMLInputElement>('textbox', { name: 'Group name' })
    .find((field) => field.value === 'public')
  if (!name) throw new Error('Expected public group name input')
  await user.clear(name)
  await user.type(name, 'gpt')
  await user.tab()
  expect(name).toHaveValue('public')
  expect(
    screen.getByRole('button', { name: 'Public discount for public' })
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Public discount for gpt' })
  ).toBeNull()
  client.clear()
})

it('blocks editing while loading and offers retry after a settings load failure', async () => {
  const client = createAppQueryClient()
  client.setDefaultOptions({ queries: { retry: false, gcTime: 0 } })
  let reject: (reason: Error) => void = () => {}
  vi.spyOn(api, 'get')
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        })
    )
    .mockResolvedValue({ data: { success: true, data: settings } })
  render(
    <QueryClientProvider client={client}>
      <Fixture />
    </QueryClientProvider>
  )
  expect(
    screen.queryByRole('button', { name: 'Save group settings' })
  ).toBeNull()
  reject(new Error('Offline'))
  await userEvent
    .setup()
    .click(await screen.findByRole('button', { name: 'Retry' }))
  expect(
    await screen.findByRole('button', { name: 'Save group settings' })
  ).toBeEnabled()
  client.clear()
})

it.each([
  { patch: { ratio: 0 }, message: 'Enter a positive discounted multiplier.' },
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
])('rejects invalid public offer $patch', ({ patch, message }) => {
  const result = promotionSchema.safeParse({ ...rule, ...patch })
  expect(result.success).toBe(false)
  if (!result.success) {
    expect(result.error.issues.map((issue) => issue.message)).toContain(message)
  }
})
