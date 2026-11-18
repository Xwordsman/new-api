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
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'

import {
  emptyAppearance,
  type GroupDisplayOption,
  type GroupDisplaySettings,
} from '../types'
import { GroupDisplayWorkspace } from '../workspace'

const settings: GroupDisplaySettings = {
  revision: 1,
  categories: [{ id: 'openai', name: 'OpenAI', color: '#16a34a', icon: '' }],
  groups: {
    gpt: { ...emptyAppearance, display_name: 'GPT route', category: 'openai' },
  },
}
const options: GroupDisplayOption[] = [
  { value: 'gpt', label: 'gpt', ratio: 1 },
  { value: 'other', label: 'other', ratio: 2 },
]
afterEach(() => vi.restoreAllMocks())

function renderWorkspace(initial = settings, choices = options) {
  const client = createAppQueryClient()
  client.setDefaultOptions({
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  })
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValue({ data: { success: true, data: initial } })
  const put = vi
    .spyOn(api, 'put')
    .mockImplementation(async (_path, payload) => ({
      data: {
        success: true,
        data: { ...(payload as GroupDisplaySettings), revision: 2 },
      },
    }))
  render(
    <QueryClientProvider client={client}>
      <GroupDisplayWorkspace options={choices} />
    </QueryClientProvider>
  )
  return { client, get, put }
}

it('shows every group in an editable table and hides advanced fields until More is opened', async () => {
  const user = userEvent.setup()
  const { client } = renderWorkspace()
  const table = await screen.findByRole('table', {
    name: 'API key group appearance',
  })
  expect(within(table).getAllByRole('row')).toHaveLength(3)
  expect(
    within(table).getAllByRole('textbox', { name: 'Display name' })
  ).toHaveLength(2)
  const scrollRegion = screen.getByRole('region', {
    name: 'API key group appearance',
  })
  expect(scrollRegion).toHaveAttribute('tabindex', '0')
  expect(scrollRegion).toHaveClass('overflow-x-auto')
  expect(
    screen.queryByRole('textbox', { name: 'Accent color' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('textbox', { name: 'Category name' })
  ).not.toBeInTheDocument()
  const row = within(table).getAllByRole('row')[1]
  await user.click(within(row).getByRole('button', { name: 'More' }))
  const dialog = screen.getByRole('dialog', { name: 'More settings for gpt' })
  expect(
    within(dialog).getByRole('textbox', { name: 'Accent color' })
  ).toBeVisible()
  expect(
    within(dialog).queryByRole('textbox', { name: 'Display name' })
  ).not.toBeInTheDocument()
  client.clear()
})

it('edits multiple rows, previews names and tags, and saves using the original routing keys', async () => {
  const user = userEvent.setup()
  const { client, put } = renderWorkspace()
  const table = await screen.findByRole('table', {
    name: 'API key group appearance',
  })
  const rows = within(table).getAllByRole('row').slice(1)
  fireEvent.change(
    within(rows[0]).getByRole('textbox', { name: 'Display name' }),
    { target: { value: 'GPT premium' } }
  )
  fireEvent.change(
    within(rows[1]).getByRole('textbox', { name: 'Display name' }),
    { target: { value: 'Other premium' } }
  )
  await user.click(within(rows[0]).getByRole('switch', { name: 'Featured' }))
  await user.type(
    within(rows[0]).getByRole('textbox', { name: 'Tags' }),
    'Stable{Enter}'
  )
  await user.click(screen.getByRole('button', { name: 'Preview' }))
  const preview = screen.getByRole('dialog', { name: 'Live preview' })
  expect(
    within(preview).getByRole('option', { name: /GPT premium/ })
  ).toHaveTextContent('Stable')
  expect(
    within(preview).getByRole('option', { name: /GPT premium/ })
  ).toHaveTextContent('Featured')
  expect(
    within(preview).getByRole('option', { name: /Other premium/ })
  ).toBeVisible()
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: 'Save appearance' }))
  await waitFor(() => expect(put).toHaveBeenCalledOnce())
  const payload = put.mock.calls[0][1] as GroupDisplaySettings
  expect(payload.groups.gpt).toMatchObject({
    display_name: 'GPT premium',
    featured: true,
    tags: [{ label: 'Stable', color: '' }],
  })
  expect(payload.groups.other.display_name).toBe('Other premium')
  expect(payload.revision).toBe(1)
  expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
  client.clear()
})

it('selects a ready-made vendor and gradient style without creating categories or entering colors', async () => {
  const user = userEvent.setup()
  const { client, put } = renderWorkspace()
  const table = await screen.findByRole('table', {
    name: 'API key group appearance',
  })
  const row = within(table).getAllByRole('row')[2]
  const vendor = within(row).getByRole('combobox', { name: 'Vendor' })
  await user.click(vendor)
  await user.click(screen.getByRole('option', { name: 'Google' }))
  expect(vendor).toHaveValue('Google')
  await user.click(within(row).getByRole('combobox', { name: 'Style' }))
  await user.click(screen.getByRole('option', { name: 'Gradient highlight' }))
  await user.click(screen.getByRole('button', { name: 'Preview' }))
  const preview = screen.getByRole('dialog', { name: 'Live preview' })
  const entry = within(preview).getByRole('option', { name: /other/ })
  expect(entry).toHaveAttribute('data-border', 'gradient')
  expect(entry).toHaveAttribute('data-tinted', 'true')
  expect(entry.style.getPropertyValue('--group-color')).toBe('#4285f4')
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: 'Save appearance' }))
  await waitFor(() => expect(put).toHaveBeenCalledOnce())
  const payload = put.mock.calls[0][1] as GroupDisplaySettings
  expect(payload.categories).toEqual([
    settings.categories[0],
    { id: 'google', name: 'Google', icon: 'Gemini.Color', color: '#4285f4' },
  ])
  expect(payload.groups.other).toMatchObject({
    category: 'google',
    color: '',
    icon: '',
    background: true,
    border: 'gradient',
  })
  expect(payload.groups.other.gradient_to).toMatch(/^#[0-9a-f]{6}$/)
  client.clear()
})

it('keeps saved custom vendors, overrides, tag colors and hidden group metadata when another row is edited', async () => {
  const user = userEvent.setup()
  const custom = {
    ...settings,
    categories: [
      { id: 'legacy', name: 'OpenAI', icon: 'OpenAI', color: '#abcdef' },
    ],
    groups: {
      gpt: {
        ...settings.groups.gpt,
        category: 'legacy',
        icon: 'Claude',
        color: '#123456',
        tags: [{ label: 'Stable', color: '#38bdf8' }],
        border: 'solid' as const,
        background: true,
        sort_order: 7,
      },
      hidden: { ...emptyAppearance, display_name: 'Saved hidden group' },
    },
  }
  const { client, put } = renderWorkspace(custom)
  const table = await screen.findByRole('table', {
    name: 'API key group appearance',
  })
  const rows = within(table).getAllByRole('row').slice(1)
  expect(within(rows[0]).getByRole('combobox', { name: 'Style' })).toHaveValue(
    'Custom style'
  )
  await user.click(within(rows[0]).getByRole('combobox', { name: 'Vendor' }))
  expect(screen.getAllByRole('option', { name: 'OpenAI' })).toHaveLength(1)
  await user.click(screen.getByRole('option', { name: 'OpenAI' }))
  fireEvent.change(
    within(rows[1]).getByRole('textbox', { name: 'Display name' }),
    { target: { value: 'Edited' } }
  )
  await user.click(screen.getByRole('button', { name: 'Save appearance' }))
  await waitFor(() => expect(put).toHaveBeenCalledOnce())
  const payload = put.mock.calls[0][1] as GroupDisplaySettings
  expect(payload.categories).toEqual(custom.categories)
  expect(payload.groups.gpt).toEqual(custom.groups.gpt)
  expect(payload.groups.hidden).toEqual(custom.groups.hidden)
  client.clear()
})

it('loads refreshed saved appearance when the editor has no draft', async () => {
  const user = userEvent.setup()
  const { client, put } = renderWorkspace()
  const table = await screen.findByRole('table', {
    name: 'API key group appearance',
  })
  const name = within(table).getAllByRole('textbox', {
    name: 'Display name',
  })[0]
  await act(async () => {
    client.setQueryData(['group-display'], {
      ...settings,
      revision: 3,
      groups: {
        gpt: { ...settings.groups.gpt, display_name: 'Refreshed name' },
      },
    })
  })
  await waitFor(() => expect(name).toHaveValue('Refreshed name'))
  await user.click(screen.getByRole('button', { name: 'Save appearance' }))
  await waitFor(() => expect(put).toHaveBeenCalledOnce())
  expect(put.mock.calls[0][1]).toMatchObject({ revision: 3 })
  client.clear()
})

it('preserves a draft and its revision when saved appearance refreshes during editing', async () => {
  const user = userEvent.setup()
  const { client, put } = renderWorkspace()
  const table = await screen.findByRole('table', {
    name: 'API key group appearance',
  })
  const name = within(table).getAllByRole('textbox', {
    name: 'Display name',
  })[0]
  fireEvent.change(name, { target: { value: 'Keep my draft' } })
  await act(async () => {
    client.setQueryData(['group-display'], {
      ...settings,
      revision: 3,
      groups: {
        gpt: { ...settings.groups.gpt, display_name: 'Refreshed name' },
      },
    })
  })
  expect(name).toHaveValue('Keep my draft')
  await user.click(screen.getByRole('button', { name: 'Save appearance' }))
  await waitFor(() => expect(put).toHaveBeenCalledOnce())
  expect(put.mock.calls[0][1]).toMatchObject({
    revision: 1,
    groups: { gpt: { display_name: 'Keep my draft' } },
  })
  client.clear()
})

it('opens the invalid group advanced settings and prevents invalid colors from being saved', async () => {
  const user = userEvent.setup()
  const { client, put } = renderWorkspace()
  const table = await screen.findByRole('table', {
    name: 'API key group appearance',
  })
  await user.click(
    within(within(table).getAllByRole('row')[2]).getByRole('button', {
      name: 'More',
    })
  )
  fireEvent.change(screen.getByRole('textbox', { name: 'Accent color' }), {
    target: { value: 'invalid' },
  })
  await user.click(screen.getByRole('button', { name: 'Done' }))
  await user.click(screen.getByRole('button', { name: 'Save appearance' }))
  const dialog = await screen.findByRole('dialog', {
    name: 'More settings for other',
  })
  expect(
    within(dialog).getByRole('textbox', { name: 'Accent color' })
  ).toHaveAttribute('aria-invalid', 'true')
  expect(put).not.toHaveBeenCalled()
  client.clear()
})

it('retains a failed save draft and only replaces it after confirming reload', async () => {
  const user = userEvent.setup()
  const { client, put, get } = renderWorkspace()
  const table = await screen.findByRole('table', {
    name: 'API key group appearance',
  })
  const name = within(table).getAllByRole('textbox', {
    name: 'Display name',
  })[0]
  fireEvent.change(name, { target: { value: 'Keep my draft' } })
  put.mockResolvedValueOnce({
    data: {
      success: false,
      message: 'Group appearance changed. Reload before saving.',
    },
  })
  await user.click(screen.getByRole('button', { name: 'Save appearance' }))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Save appearance' })
    ).toBeEnabled()
  )
  expect(name).toHaveValue('Keep my draft')
  get.mockResolvedValueOnce({
    data: {
      success: true,
      data: {
        ...settings,
        revision: 2,
        groups: {
          gpt: { ...settings.groups.gpt, display_name: 'Latest saved name' },
        },
      },
    },
  })
  await user.click(
    screen.getByRole('button', { name: 'Reload saved appearance' })
  )
  expect(name).toHaveValue('Keep my draft')
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Continue',
    })
  )
  await waitFor(() => expect(name).toHaveValue('Latest saved name'))
  client.clear()
})

it('confirms custom vendor removal and preserves its groups other appearance fields', async () => {
  const user = userEvent.setup()
  const { client, put } = renderWorkspace()
  await screen.findByRole('table', { name: 'API key group appearance' })
  await user.click(screen.getByRole('button', { name: 'Custom vendors' }))
  const manager = screen.getByRole('dialog', { name: 'Custom vendors' })
  await user.click(
    within(manager).getByRole('button', { name: 'Remove category OpenAI' })
  )
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Continue',
    })
  )
  expect(
    within(manager).queryByRole('textbox', { name: 'Category name' })
  ).not.toBeInTheDocument()
  await user.click(within(manager).getByRole('button', { name: 'Done' }))
  await user.click(screen.getByRole('button', { name: 'Save appearance' }))
  await waitFor(() => expect(put).toHaveBeenCalledOnce())
  const payload = put.mock.calls[0][1] as GroupDisplaySettings
  expect(payload.categories).toEqual([])
  expect(payload.groups.gpt).toMatchObject({
    category: '',
    display_name: 'GPT route',
  })
  client.clear()
})

it('disables row edits and advanced controls while saving', async () => {
  const user = userEvent.setup()
  const { client, put } = renderWorkspace()
  const table = await screen.findByRole('table', {
    name: 'API key group appearance',
  })
  let finish: (value: unknown) => void = () => {}
  put.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await user.click(screen.getByRole('button', { name: 'Save appearance' }))
  expect(
    within(table).getAllByRole('textbox', { name: 'Display name' })[0]
  ).toBeDisabled()
  expect(
    within(table).getAllByRole('combobox', { name: 'Vendor' })[0]
  ).toBeDisabled()
  expect(
    within(table).getAllByRole('button', { name: 'More' })[0]
  ).toBeDisabled()
  finish({ data: { success: true, data: settings } })
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Save appearance' })
    ).toBeEnabled()
  )
  client.clear()
})

it('shows an empty table when there are no groups to customize', async () => {
  const { client } = renderWorkspace(
    { revision: 0, categories: [], groups: {} },
    []
  )
  const table = await screen.findByRole('table', {
    name: 'API key group appearance',
  })
  expect(
    within(table).getByText('No groups yet. Add a group to get started.')
  ).toBeVisible()
  expect(
    within(table).queryByRole('combobox', { name: 'Vendor' })
  ).not.toBeInTheDocument()
  client.clear()
})
