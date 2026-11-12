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
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'

import { DocumentationSettingsPage } from '../settings-page'
import type { DocumentationSettings } from '../types'

const settings: DocumentationSettings = {
  revision: 3,
  enabled: true,
  title: 'Developer guides',
  description: '',
  categories: [
    { id: 'start', title: 'Getting started', description: '', sort_order: 0 },
  ],
  articles: [
    {
      id: 'first',
      category_id: 'start',
      slug: 'first',
      title: 'First guide',
      description: '',
      content: 'Use {{api_base_url}} as your SDK base URL.',
      status: 'published',
      sort_order: 0,
      updated_at: 0,
    },
  ],
}
let client: QueryClient

beforeEach(() => {
  client = createAppQueryClient()
  client.setDefaultOptions({
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
})
afterEach(() => {
  client.clear()
  vi.restoreAllMocks()
})

function renderSettings(current = settings) {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: current },
  })
  const root = createRootRoute()
  const route = createRoute({
    getParentRoute: () => root,
    path: '/system-settings/documentation',
    component: DocumentationSettingsPage,
  })
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: ['/system-settings/documentation'],
    }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

it('saves a new empty draft and resets the dirty state only after successful saving', async () => {
  const user = userEvent.setup()
  const put = vi.spyOn(api, 'put').mockImplementation(async (_url, body) => ({
    data: {
      success: true,
      data: { ...(body as DocumentationSettings), revision: 4 },
    },
  }))
  renderSettings()
  await user.click(await screen.findByRole('button', { name: 'New article' }))
  expect(
    screen.getByRole('combobox', { name: 'Publication status' })
  ).toHaveValue('draft')
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/extensions/docs/admin/settings',
      expect.objectContaining({
        revision: 3,
        articles: [
          settings.articles[0],
          expect.objectContaining({
            title: 'Untitled article',
            content: '',
            status: 'draft',
          }),
        ],
      })
    )
  )
  expect(screen.getByRole('textbox', { name: 'Article title' })).toHaveValue(
    'Untitled article'
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  )
})

it('rejects publishing a blank draft and leaves its editable content in place', async () => {
  const user = userEvent.setup()
  const put = vi.spyOn(api, 'put')
  renderSettings()
  await user.click(await screen.findByRole('button', { name: 'New article' }))
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Publication status' }),
    'published'
  )
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  expect(
    await screen.findByText(
      'Keep each article within 128 KB and add content before publishing.'
    )
  ).toBeVisible()
  expect(put).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: 'Article title' })).toHaveValue(
    'Untitled article'
  )
})

it('keeps unsaved edits after a conflicting save and reloads only after confirmation', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'put').mockResolvedValue({
    data: {
      success: false,
      message: 'Documentation changed. Reload before saving.',
    },
  })
  renderSettings()
  const title = await screen.findByRole('textbox', {
    name: 'Documentation title',
  })
  await user.clear(title)
  await user.type(title, 'Local draft')
  vi.mocked(api.get).mockResolvedValue({
    data: {
      success: true,
      data: { ...settings, revision: 4, title: 'Server title' },
    },
  })
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  const reload = await screen.findByRole('button', {
    name: 'Reload saved settings',
  })
  expect(title).toHaveValue('Local draft')
  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  await user.click(reload)
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Discard unsaved documentation changes?',
  })
  expect(title).toHaveValue('Local draft')
  await user.click(
    within(dialog).getByRole('button', { name: 'Reload saved settings' })
  )
  expect(title).toHaveValue('Server title')
  expect(
    screen.queryByText(
      'Saving failed. Your edits are kept. Reload saved settings if another administrator changed them.'
    )
  ).not.toBeInTheDocument()
})

it('previews API base URL variables with the protocol prefix and keeps the original Markdown unchanged', async () => {
  const user = userEvent.setup()
  const put = vi.spyOn(api, 'put')
  renderSettings()
  await user.click(await screen.findByRole('tab', { name: 'Preview' }))
  const preview = await screen.findByRole('tabpanel', { name: 'Preview' })
  expect(preview).toHaveTextContent(
    `Use ${window.location.origin}/v1 as your SDK base URL.`
  )
  expect(
    within(preview).getByRole('link', { name: `${window.location.origin}/v1` })
  ).toHaveAttribute('href', `${window.location.origin}/v1`)
  await user.click(screen.getByRole('tab', { name: 'Markdown source' }))
  expect(
    await screen.findByRole('textbox', { name: 'Article Markdown content' })
  ).toHaveTextContent('Use {{api_base_url}} as your SDK base URL.')
  expect(put).not.toHaveBeenCalled()
})

it('prevents deleting a category while an article still uses it', async () => {
  const user = userEvent.setup()
  renderSettings()
  await user.click(await screen.findByRole('tab', { name: 'Categories' }))
  expect(screen.getByRole('button', { name: 'Delete category' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Add category' }))
  const deleteButtons = screen.getAllByRole('button', {
    name: 'Delete category',
  })
  expect(deleteButtons[1]).toBeEnabled()
})

it('moves an article within its own category and saves the displayed order', async () => {
  const user = userEvent.setup()
  const put = vi.spyOn(api, 'put').mockImplementation(async (_url, body) => ({
    data: {
      success: true,
      data: { ...(body as DocumentationSettings), revision: 4 },
    },
  }))
  renderSettings({
    ...settings,
    categories: [
      ...settings.categories,
      { id: 'advanced', title: 'Advanced', description: '', sort_order: 1 },
    ],
    articles: [
      settings.articles[0],
      {
        ...settings.articles[0],
        id: 'other',
        slug: 'other',
        category_id: 'advanced',
        title: 'Other guide',
        sort_order: 1,
      },
      {
        ...settings.articles[0],
        id: 'second',
        slug: 'second',
        title: 'Second guide',
        sort_order: 2,
      },
    ],
  })
  expect(
    await screen.findByRole('button', { name: 'Move article up' })
  ).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Move article down' }))
  expect(
    screen
      .getAllByRole('button', { name: /^(First|Second) guide$/ })
      .map((button) => button.textContent)
  ).toEqual(['Second guide', 'First guide'])
  expect(screen.getByRole('textbox', { name: 'Article title' })).toHaveValue(
    'First guide'
  )
  expect(
    screen.getByRole('button', { name: 'Move article down' })
  ).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/extensions/docs/admin/settings',
      expect.objectContaining({
        articles: [
          expect.objectContaining({ id: 'other', sort_order: 0 }),
          expect.objectContaining({ id: 'second', sort_order: 1 }),
          expect.objectContaining({ id: 'first', sort_order: 2 }),
        ],
      })
    )
  )
})
