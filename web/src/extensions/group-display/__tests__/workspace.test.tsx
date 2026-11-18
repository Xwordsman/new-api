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

import { emptyAppearance, type GroupDisplaySettings } from '../types'
import { GroupDisplayWorkspace } from '../workspace'

const settings: GroupDisplaySettings = {
  revision: 1,
  categories: [{ id: 'openai', name: 'OpenAI', color: '#16a34a', icon: '' }],
  groups: {
    gpt: { ...emptyAppearance, display_name: 'GPT route', category: 'openai' },
  },
}
afterEach(() => vi.restoreAllMocks())

function renderWorkspace() {
  const client = createAppQueryClient()
  client.setDefaultOptions({
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  })
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValue({ data: { success: true, data: settings } })
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
      <GroupDisplayWorkspace
        options={[
          { value: 'gpt', label: 'gpt', ratio: 1 },
          { value: 'other', label: 'other', ratio: 2 },
        ]}
      />
    </QueryClientProvider>
  )
  return { client, get, put }
}

it('previews names and colored tags immediately and saves metadata with the routing key', async () => {
  const user = userEvent.setup()
  const { client, put } = renderWorkspace()
  const name = await screen.findByRole('textbox', { name: 'Display name' })
  fireEvent.change(name, { target: { value: 'GPT premium' } })
  await user.click(screen.getByRole('switch', { name: 'Featured' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Tags' }),
    'Stable{Enter}'
  )
  fireEvent.change(screen.getByRole('textbox', { name: 'Color for Stable' }), {
    target: { value: '#38bdf8' },
  })
  const preview = screen.getByRole('complementary', { name: 'Live preview' })
  expect(
    within(preview).getByRole('option', { name: /GPT premium/ })
  ).toHaveTextContent('Stable')
  expect(
    within(preview).getByRole('option', { name: /GPT premium/ })
  ).toHaveTextContent('Featured')
  await user.click(screen.getByRole('button', { name: 'Save appearance' }))
  await waitFor(() => expect(put).toHaveBeenCalledOnce())
  const payload = put.mock.calls[0][1] as GroupDisplaySettings
  expect(payload.groups.gpt).toMatchObject({
    display_name: 'GPT premium',
    featured: true,
    tags: [{ label: 'Stable', color: '#38bdf8' }],
  })
  expect(payload.revision).toBe(1)
  expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
  client.clear()
})

it('marks invalid colors and prevents an invalid appearance from being submitted', async () => {
  const user = userEvent.setup()
  const { client, put } = renderWorkspace()
  await screen.findByRole('textbox', { name: 'Display name' })
  const accent = screen.getAllByRole('textbox', { name: 'Accent color' })[1]
  fireEvent.change(accent, { target: { value: 'invalid' } })
  await user.click(screen.getByRole('button', { name: 'Save appearance' }))
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(accent).toHaveAttribute('aria-invalid', 'true')
  expect(put).not.toHaveBeenCalled()
  client.clear()
})

it('retains a failed save draft and only replaces it after confirming reload', async () => {
  const user = userEvent.setup()
  const { client, put, get } = renderWorkspace()
  const name = await screen.findByRole('textbox', { name: 'Display name' })
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
  const dialog = screen.getByRole('alertdialog')
  expect(name).toHaveValue('Keep my draft')
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
  await waitFor(() => expect(name).toHaveValue('Latest saved name'))
  client.clear()
})

it('confirms category removal and moves its groups without losing other appearance fields', async () => {
  const user = userEvent.setup()
  const { client, put } = renderWorkspace()
  await screen.findByRole('textbox', { name: 'Display name' })
  await user.click(
    screen.getByRole('button', { name: 'Remove category OpenAI' })
  )
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Continue',
    })
  )
  expect(
    screen.queryByRole('textbox', { name: 'Category name' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Display name' })).toHaveValue(
    'GPT route'
  )
  await user.click(screen.getByRole('button', { name: 'Save appearance' }))
  await waitFor(() => expect(put).toHaveBeenCalledOnce())
  const payload = put.mock.calls[0][1] as GroupDisplaySettings
  expect(payload.categories).toEqual([])
  expect(payload.groups.gpt.category).toBe('')
  expect(payload.groups.gpt.display_name).toBe('GPT route')
  client.clear()
})
