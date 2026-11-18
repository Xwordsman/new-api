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

it('creates a colored category, adds existing groups, and expands their tags and featured settings', async () => {
  const user = userEvent.setup()
  const { client, put } = renderWorkspace({
    revision: 0,
    categories: [],
    groups: {},
  })
  await user.click(await screen.findByRole('button', { name: 'Add category' }))
  const categoryDialog = screen.getByRole('dialog', { name: 'Add category' })
  await user.type(
    within(categoryDialog).getByRole('textbox', { name: 'Category name' }),
    'Google'
  )
  fireEvent.change(within(categoryDialog).getByLabelText('Category color'), {
    target: { value: '#4285f4' },
  })
  await user.click(
    within(categoryDialog).getByRole('button', { name: 'Add category' })
  )
  const category = screen.getByRole('region', { name: 'Google' })
  await user.click(
    within(category).getByRole('button', { name: 'Add system groups' })
  )
  const picker = screen.getByRole('dialog', { name: 'Add groups to Google' })
  await user.click(
    within(picker).getByRole('combobox', { name: 'System groups' })
  )
  await user.click(screen.getByRole('option', { name: 'gpt' }))
  await user.keyboard('{Escape}')
  await user.click(
    within(picker).getByRole('button', { name: 'Add selected groups' })
  )
  const toggle = within(category).getByRole('button', {
    name: 'Configure group gpt',
  })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(
    screen.queryByRole('textbox', { name: 'Tags' })
  ).not.toBeInTheDocument()
  await user.click(toggle)
  fireEvent.change(screen.getByRole('textbox', { name: 'Display name' }), {
    target: { value: 'GPT premium' },
  })
  await user.type(
    screen.getByRole('textbox', { name: 'Tags' }),
    'Stable{Enter}'
  )
  await user.click(screen.getByRole('switch', { name: 'Featured' }))
  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(
    screen.queryByRole('textbox', { name: 'Display name' })
  ).not.toBeInTheDocument()
  await user.click(toggle)
  expect(screen.getByRole('textbox', { name: 'Display name' })).toHaveValue(
    'GPT premium'
  )
  expect(screen.getByRole('switch', { name: 'Featured' })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await user.click(screen.getByRole('button', { name: 'Preview' }))
  const preview = screen.getByRole('dialog', { name: 'Live preview' })
  const row = within(preview).getByRole('option', { name: /GPT premium/ })
  expect(row).toHaveAttribute('data-featured', 'true')
  expect(within(row).getByRole('img', { name: 'Featured' })).toBeVisible()
  expect(row).toHaveTextContent('Stable')
  expect(row.style.getPropertyValue('--group-color')).toBe('#4285f4')
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: 'Save appearance' }))
  await waitFor(() => expect(put).toHaveBeenCalledOnce())
  const payload = put.mock.calls[0][1] as GroupDisplaySettings
  expect(payload.categories).toEqual([
    { id: expect.any(String), name: 'Google', color: '#4285f4', icon: '' },
  ])
  expect(payload.groups.gpt).toMatchObject({
    category: payload.categories[0].id,
    display_name: 'GPT premium',
    featured: true,
    tags: [{ label: 'Stable', color: '' }],
  })
  expect(Object.keys(payload.groups)).toEqual(['gpt'])
  client.clear()
})

it('only offers unassigned system groups and never creates routing keys from search text', async () => {
  const user = userEvent.setup()
  const { client } = renderWorkspace()
  const category = await screen.findByRole('region', { name: 'OpenAI' })
  await user.click(
    within(category).getByRole('button', { name: 'Add system groups' })
  )
  const picker = screen.getByRole('dialog', { name: 'Add groups to OpenAI' })
  const search = within(picker).getByRole('combobox', { name: 'System groups' })
  await user.click(search)
  expect(screen.queryByRole('option', { name: 'gpt' })).not.toBeInTheDocument()
  expect(screen.getByRole('option', { name: 'other' })).toBeVisible()
  await user.type(search, 'invented-route{Enter}')
  expect(
    screen.queryByRole('option', { name: /invented-route/ })
  ).not.toBeInTheDocument()
  expect(
    within(picker).getByRole('button', { name: 'Add selected groups' })
  ).toBeDisabled()
  client.clear()
})

it('keeps category colors, group overrides, tag colors and hidden metadata while editing a group', async () => {
  const user = userEvent.setup()
  const custom: GroupDisplaySettings = {
    ...settings,
    groups: {
      gpt: {
        ...settings.groups.gpt,
        icon: 'Claude',
        color: '#123456',
        border: 'solid',
        background: true,
        sort_order: 7,
        tags: [{ label: 'Stable', color: '#38bdf8' }],
      },
      hidden: { ...emptyAppearance, display_name: 'Saved hidden group' },
    },
  }
  const { client, put } = renderWorkspace(custom)
  await user.click(
    await screen.findByRole('button', { name: 'Configure group gpt' })
  )
  fireEvent.change(screen.getByRole('textbox', { name: 'Short description' }), {
    target: { value: 'Edited' },
  })
  await user.click(screen.getByRole('button', { name: 'Save appearance' }))
  await waitFor(() => expect(put).toHaveBeenCalledOnce())
  const payload = put.mock.calls[0][1] as GroupDisplaySettings
  expect(payload.categories).toEqual(custom.categories)
  expect(payload.groups.gpt).toEqual({
    ...custom.groups.gpt,
    description: 'Edited',
  })
  expect(payload.groups.hidden).toEqual(custom.groups.hidden)
  client.clear()
})

it('edits category color and removes a group without losing its tags or display name', async () => {
  const user = userEvent.setup()
  const { client, put } = renderWorkspace()
  await user.click(
    await screen.findByRole('button', { name: 'Edit category OpenAI' })
  )
  const dialog = screen.getByRole('dialog', { name: 'Edit category' })
  fireEvent.change(within(dialog).getByLabelText('Category color'), {
    target: { value: '#ff0000' },
  })
  await user.click(within(dialog).getByRole('button', { name: 'Done' }))
  await user.click(screen.getByRole('button', { name: 'Configure group gpt' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Tags' }),
    'Stable{Enter}'
  )
  await user.click(screen.getByRole('button', { name: 'Remove from category' }))
  expect(
    screen.queryByRole('button', { name: 'Configure group gpt' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Save appearance' }))
  await waitFor(() => expect(put).toHaveBeenCalledOnce())
  const payload = put.mock.calls[0][1] as GroupDisplaySettings
  expect(payload.categories[0].color).toBe('#ff0000')
  expect(payload.groups.gpt).toMatchObject({
    category: '',
    display_name: 'GPT route',
    tags: [{ label: 'Stable', color: '' }],
  })
  client.clear()
})

it('loads refreshed saved appearance when the editor has no draft', async () => {
  const user = userEvent.setup()
  const { client, put } = renderWorkspace()
  await user.click(
    await screen.findByRole('button', { name: 'Configure group gpt' })
  )
  const name = screen.getByRole('textbox', { name: 'Display name' })
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
  await user.click(
    await screen.findByRole('button', { name: 'Configure group gpt' })
  )
  const name = screen.getByRole('textbox', { name: 'Display name' })
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

it('rejects an empty category name before adding it', async () => {
  const user = userEvent.setup()
  const { client } = renderWorkspace()
  await user.click(await screen.findByRole('button', { name: 'Add category' }))
  const dialog = screen.getByRole('dialog', { name: 'Add category' })
  await user.click(within(dialog).getByRole('button', { name: 'Add category' }))
  expect(
    within(dialog).getByRole('textbox', { name: 'Category name' })
  ).toHaveAttribute('aria-invalid', 'true')
  expect(dialog).toBeVisible()
  client.clear()
})

it('retains a failed save draft and only replaces it after confirming reload', async () => {
  const user = userEvent.setup()
  const { client, put, get } = renderWorkspace()
  await user.click(
    await screen.findByRole('button', { name: 'Configure group gpt' })
  )
  const name = screen.getByRole('textbox', { name: 'Display name' })
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

it('confirms category removal and preserves all affected group appearance fields', async () => {
  const user = userEvent.setup()
  const initial = {
    ...settings,
    groups: {
      ...settings.groups,
      hidden: { ...emptyAppearance, category: 'openai', featured: true },
    },
  }
  const { client, put } = renderWorkspace(initial)
  const category = await screen.findByRole('region', { name: 'OpenAI' })
  await user.click(
    await screen.findByRole('button', { name: 'Remove category OpenAI' })
  )
  expect(category).toBeInTheDocument()
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Continue',
    })
  )
  expect(
    screen.queryByRole('region', { name: 'OpenAI' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Save appearance' }))
  await waitFor(() => expect(put).toHaveBeenCalledOnce())
  const payload = put.mock.calls[0][1] as GroupDisplaySettings
  expect(payload.categories).toEqual([])
  expect(payload.groups.gpt).toMatchObject({
    category: '',
    display_name: 'GPT route',
  })
  expect(payload.groups.hidden).toEqual({
    ...initial.groups.hidden,
    category: '',
  })
  client.clear()
})

it('disables category and expanded group edits while saving', async () => {
  const user = userEvent.setup()
  const { client, put } = renderWorkspace()
  await user.click(
    await screen.findByRole('button', { name: 'Configure group gpt' })
  )
  let finish: (value: unknown) => void = () => {}
  put.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await user.click(screen.getByRole('button', { name: 'Save appearance' }))
  expect(screen.getByRole('textbox', { name: 'Display name' })).toBeDisabled()
  const featured = screen.getByRole('switch', { name: 'Featured' })
  expect(featured).toHaveAttribute('aria-disabled', 'true')
  await user.click(featured)
  expect(featured).toHaveAttribute('aria-checked', 'false')
  expect(
    screen.getByRole('button', { name: 'Edit category OpenAI' })
  ).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Add system groups' })
  ).toBeDisabled()
  finish({ data: { success: true, data: settings } })
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Save appearance' })
    ).toBeEnabled()
  )
  client.clear()
})

it('explains how to start when no categories or system groups exist', async () => {
  const { client } = renderWorkspace(
    { revision: 0, categories: [], groups: {} },
    []
  )
  expect(await screen.findByText('Create your first category')).toBeVisible()
  expect(
    screen.getByText(
      'No system groups are available yet. Add them in Pricing and access first.'
    )
  ).toBeVisible()
  client.clear()
})
