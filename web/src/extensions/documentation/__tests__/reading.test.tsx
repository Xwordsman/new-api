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
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'

import { documentationKey } from '../api'
import {
  ArticleMarkdown,
  ArticleTableOfContents,
} from '../components/article-markdown'
import { DocsArticle } from '../components/docs-article'
import { DocsLanding } from '../components/docs-landing'
import { MobileDocsNavigation } from '../components/docs-navigation'
import { DocsSearch } from '../components/docs-search'
import type { DocumentationIndex, DocumentationMetadata } from '../types'

const guide: DocumentationMetadata = {
  id: 'first',
  category_id: 'start',
  slug: 'first',
  title: 'Connect your SDK',
  description: 'Set the API address and key.',
  status: 'published',
  sort_order: 0,
  updated_at: 0,
}
const index: DocumentationIndex = {
  title: 'Developer guides',
  description: 'Integration guides for the gateway.',
  categories: [
    {
      id: 'start',
      title: 'Getting started',
      description: 'Connect in minutes.',
      sort_order: 0,
    },
  ],
  articles: [guide],
  variables: {
    site_name: 'New API',
    site_url: 'https://gateway.example',
    api_base_url: 'https://gateway.example/v1',
  },
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

function renderReading(children: ReactNode) {
  const root = createRootRoute()
  const home = createRoute({
    getParentRoute: () => root,
    path: '/docs',
    component: () => children,
  })
  const article = createRoute({
    getParentRoute: () => root,
    path: '/docs/guides/$slug',
    component: () => <h1>Reading guide</h1>,
  })
  const router = createRouter({
    routeTree: root.addChildren([home, article]),
    history: createMemoryHistory({ initialEntries: ['/docs'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return router
}

it('shows search matches without clipping them inside the landing hero and closes on Escape', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: [{ ...guide, excerpt: 'SDK setup' }] },
  })
  renderReading(<DocsLanding index={index} />)
  const input = await screen.findByRole('textbox', {
    name: 'Search documentation',
  })
  await user.type(input, 'sdk')
  const results = await screen.findByRole('region', {
    name: 'Documentation search results',
  })
  expect(
    await within(results).findByRole('link', { name: /Connect your SDK/ })
  ).toHaveAttribute('href', '/docs/guides/first')
  expect(input.closest('header')).not.toHaveClass('overflow-hidden')
  await user.keyboard('{Escape}')
  expect(
    screen.queryByRole('region', { name: 'Documentation search results' })
  ).not.toBeInTheDocument()
  expect(input).toHaveFocus()
  expect(input).toHaveValue('sdk')
  await user.type(input, ' api')
  expect(
    await screen.findByRole('region', { name: 'Documentation search results' })
  ).toBeVisible()
})

it('removes cached matches when a search refresh fails and restores them after retry', async () => {
  const user = userEvent.setup()
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValue({ data: { success: true, data: [guide] } })
  renderReading(<DocsSearch />)
  await user.type(
    await screen.findByRole('textbox', { name: 'Search documentation' }),
    'sdk'
  )
  expect(
    await screen.findByRole('link', { name: /Connect your SDK/ })
  ).toBeVisible()
  get.mockResolvedValue({
    data: { success: false, message: 'Search unavailable' },
  })
  await act(async () => {
    await client.invalidateQueries({
      queryKey: [...documentationKey, 'search'],
    })
  })
  expect(
    await screen.findByText('Search is temporarily unavailable')
  ).toBeVisible()
  expect(
    screen.queryByRole('link', { name: /Connect your SDK/ })
  ).not.toBeInTheDocument()
  get.mockResolvedValue({ data: { success: true, data: [guide] } })
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(
    await screen.findByRole('link', { name: /Connect your SDK/ })
  ).toBeVisible()
})

it('shows an empty state for no matches and prevents searches beyond ten terms', async () => {
  const user = userEvent.setup()
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValue({ data: { success: true, data: [] } })
  renderReading(<DocsSearch />)
  const input = await screen.findByRole('textbox', {
    name: 'Search documentation',
  })
  await user.type(input, 'unknown')
  expect(await screen.findByText('No matching articles')).toBeVisible()
  await user.clear(input)
  get.mockClear()
  await user.paste('one two three four five six seven eight nine ten eleven')
  expect(await screen.findByText('Use up to 10 search terms.')).toBeVisible()
  expect(get).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Clear search' }))
  expect(
    screen.queryByRole('region', { name: 'Documentation search results' })
  ).not.toBeInTheDocument()
})

it('navigates a search result with the keyboard and clears the search panel', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: [guide] },
  })
  const router = renderReading(<DocsSearch />)
  await user.type(
    await screen.findByRole('textbox', { name: 'Search documentation' }),
    'sdk'
  )
  const result = await screen.findByRole('link', { name: /Connect your SDK/ })
  act(() => result.focus())
  await user.keyboard('{Enter}')
  expect(
    await screen.findByRole('heading', { name: 'Reading guide' })
  ).toBeVisible()
  expect(router.state.location.pathname).toBe('/docs/guides/first')
})

it('provides sanitized prose, reference links, matching table-of-contents targets and copyable code', async () => {
  const user = userEvent.setup()
  const clipboard = vi
    .spyOn(navigator.clipboard, 'writeText')
    .mockResolvedValue()
  const content =
    '# Connect\n\n[SDK guide][sdk]\n\n<script>alert(1)</script>\n\n## Request\n\n```shell\ncurl https://gateway.example/v1/models\n```\n\n[sdk]: /docs/guides/sdk'
  const view = render(
    <>
      <ArticleTableOfContents content={content} />
      <ArticleMarkdown
        content={content}
        baseUrl='https://gateway.example/docs/guides/first'
      />
    </>
  )
  expect(
    await screen.findByRole('link', { name: 'SDK guide' })
  ).toHaveAttribute('href', 'https://gateway.example/docs/guides/sdk')
  expect(view.container.querySelector('script')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Request' })).toHaveAttribute(
    'href',
    '#section-2'
  )
  expect(
    screen.getByRole('heading', { name: 'Request' }).closest('[id]')
  ).toHaveAttribute('id', 'section-2')
  await user.click(screen.getByRole('button', { name: 'Copy code' }))
  await waitFor(() =>
    expect(clipboard).toHaveBeenCalledWith(
      'curl https://gateway.example/v1/models'
    )
  )
})

it('offers Markdown downloads and neighboring guides after loading an article', async () => {
  const user = userEvent.setup()
  const clipboard = vi
    .spyOn(navigator.clipboard, 'writeText')
    .mockResolvedValue()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        article: { ...guide, content: '# SDK configuration' },
        previous: null,
        next: {
          ...guide,
          id: 'next',
          slug: 'advanced',
          title: 'Advanced configuration',
        },
        variables: index.variables,
      },
    },
  })
  renderReading(<DocsArticle slug='first' index={index} />)
  expect(
    await screen.findByRole('heading', { name: 'Connect your SDK' })
  ).toBeVisible()
  const download = screen.getByRole('button', { name: 'Download Markdown' })
  expect(download).toHaveAttribute(
    'href',
    '/api/extensions/docs/articles/first/markdown'
  )
  expect(download).toHaveAttribute('download', 'first.md')
  expect(
    screen.getByRole('link', { name: /Next guide.*Advanced configuration/ })
  ).toHaveAttribute('href', '/docs/guides/advanced')
  await user.click(screen.getByRole('button', { name: 'Copy Markdown' }))
  await waitFor(() =>
    expect(clipboard).toHaveBeenCalledWith('# SDK configuration')
  )
})

it('opens mobile navigation by keyboard and closes it after choosing an article', async () => {
  const user = userEvent.setup()
  renderReading(<MobileDocsNavigation index={index} slug='first' />)
  const trigger = await screen.findByRole('button', {
    name: 'Browse documentation',
  })
  act(() => trigger.focus())
  await user.keyboard('{Enter}')
  const dialog = await screen.findByRole('dialog', {
    name: 'Documentation navigation',
  })
  const current = within(dialog).getByRole('link', { name: 'Connect your SDK' })
  expect(current).toHaveAttribute('aria-current', 'page')
  await user.click(current)
  expect(
    await screen.findByRole('heading', { name: 'Reading guide' })
  ).toBeVisible()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
