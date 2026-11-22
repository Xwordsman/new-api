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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'

import { EventsPanel } from '../components/events-panel'
import type { ProtectionEvent } from '../types'

const event: ProtectionEvent = {
  id: 71,
  user_id: 42,
  username: 'member42',
  token_id: 8,
  token_name: 'Personal key',
  created_at: 1795200000,
  ip: '192.0.2.10',
  model: 'gpt-4.1',
  group: 'premium',
  channel_id: 5,
  channel_name: 'Provider',
  request_id: 'request-71',
  protocol: 'openai',
  preview: 'Request excerpt',
  content_truncated: false,
  content_redacted: false,
  decision: 'block',
  finding: 'keyword_match',
  reason: 'custom_keyword',
  review: 'pending',
  upstream: 'not_sent',
  matches: [],
  restrictions: [],
  violation_count: 1,
  counted: true,
  revision: 8,
  digest: 'digest',
  uninspected: '',
}

function renderEvents() {
  return render(
    <QueryClientProvider client={client}>
      <EventsPanel />
    </QueryClientProvider>
  )
}

let client: QueryClient
beforeEach(() => {
  localStorage.clear()
  client = createAppQueryClient()
  client.setDefaultOptions({ queries: { retry: false, gcTime: 0 } })
})
afterEach(() => {
  client.clear()
  localStorage.clear()
  vi.restoreAllMocks()
})

it('refreshes the event list when the administrator submits unchanged filters', async () => {
  const user = userEvent.setup()
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValueOnce({
      data: { success: true, data: { items: [], total: 0, page: 1 } },
    })
    .mockResolvedValueOnce({
      data: { success: true, data: { items: [event], total: 1, page: 1 } },
    })
  renderEvents()
  expect(await screen.findByText('No protection events')).toBeVisible()
  await user.click(screen.getByRole('button', { name: /^(Filter|Search)$/ }))
  expect(await screen.findByRole('cell', { name: /member42/ })).toBeVisible()
  expect(get).toHaveBeenCalledTimes(2)
})

it('applies all selected filters from page one and preserves them when paging with an unsaved draft', async () => {
  const user = userEvent.setup()
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { items: [event], total: 41, page: 1 } },
  })
  renderEvents()
  await screen.findByRole('cell', { name: /member42/ })
  await user.click(screen.getByRole('button', { name: 'Go to next page' }))
  await waitFor(() =>
    expect(get).toHaveBeenLastCalledWith(expect.any(String), {
      params: {
        page: 2,
        user_id: '',
        token_id: '',
        decision: '',
        review: '',
        suspended: '',
      },
    })
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled()
  )
  await user.type(screen.getByRole('spinbutton', { name: 'User ID' }), '42')
  await user.type(screen.getByRole('spinbutton', { name: 'Key ID' }), '8')
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Decision' }),
    'block'
  )
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Review status' }),
    'pending'
  )
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'User status' }),
    'true'
  )
  await user.click(screen.getByRole('button', { name: 'Search' }))
  const selected = {
    user_id: '42',
    token_id: '8',
    decision: 'block',
    review: 'pending',
    suspended: 'true',
  }
  await waitFor(() =>
    expect(get).toHaveBeenLastCalledWith(expect.any(String), {
      params: { page: 1, ...selected },
    })
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled()
  )
  await user.clear(screen.getByRole('spinbutton', { name: 'User ID' }))
  await user.type(screen.getByRole('spinbutton', { name: 'User ID' }), '99')
  await user.click(screen.getByRole('button', { name: 'Go to next page' }))
  await waitFor(() =>
    expect(get).toHaveBeenLastCalledWith(expect.any(String), {
      params: { page: 2, ...selected },
    })
  )
})

it('resets the fields and reloads fresh default results even when the default query was recently cached', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get')
    .mockResolvedValueOnce({
      data: { success: true, data: { items: [], total: 0, page: 1 } },
    })
    .mockResolvedValueOnce({
      data: { success: true, data: { items: [event], total: 1, page: 1 } },
    })
    .mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          items: [{ ...event, username: 'new-member' }],
          total: 1,
          page: 1,
        },
      },
    })
  renderEvents()
  await screen.findByText('No protection events')
  await user.type(screen.getByRole('spinbutton', { name: 'User ID' }), '42')
  await user.click(screen.getByRole('button', { name: 'Search' }))
  await screen.findByRole('cell', { name: /member42/ })
  await user.click(screen.getByRole('button', { name: 'Reset' }))
  expect(await screen.findByRole('cell', { name: /new-member/ })).toBeVisible()
  expect(screen.getByRole('spinbutton', { name: 'User ID' })).toHaveValue(null)
  expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
})

it('submits filters with Enter and rejects nonpositive user IDs', async () => {
  const user = userEvent.setup()
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { items: [], total: 0, page: 1 } },
  })
  renderEvents()
  await screen.findByText('No protection events')
  const input = screen.getByRole('spinbutton', { name: 'User ID' })
  await user.type(input, '0{Enter}')
  expect(input).toBeInvalid()
  await user.click(screen.getByRole('button', { name: 'Search' }))
  expect(get).toHaveBeenCalledTimes(1)
  await user.clear(input)
  await user.type(input, '42{Enter}')
  await waitFor(() =>
    expect(get).toHaveBeenLastCalledWith(expect.any(String), {
      params: {
        page: 1,
        user_id: '42',
        token_id: '',
        decision: '',
        review: '',
        suspended: '',
      },
    })
  )
})

it('shows a busy list and disables duplicate searches until the refresh finishes', async () => {
  const user = userEvent.setup()
  let finish!: (value: {
    data: {
      success: boolean
      data: { items: ProtectionEvent[]; total: number; page: number }
    }
  }) => void
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValueOnce({
      data: { success: true, data: { items: [event], total: 1, page: 1 } },
    })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
  renderEvents()
  await screen.findByRole('cell', { name: /member42/ })
  await user.click(screen.getByRole('button', { name: 'Search' }))
  expect(
    screen.getByRole('region', { name: 'Protection logs' })
  ).toHaveAttribute('aria-busy', 'true')
  expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled()
  expect(screen.getByRole('cell', { name: /member42/ })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Search' }))
  expect(get).toHaveBeenCalledTimes(2)
  finish({ data: { success: true, data: { items: [], total: 0, page: 1 } } })
  await screen.findByText('No protection events')
  expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled()
  expect(
    screen.getByRole('region', { name: 'Protection logs' })
  ).toHaveAttribute('aria-busy', 'false')
})

it('keeps the selected columns after reopening the event list', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { items: [event], total: 1, page: 1 } },
  })
  const view = renderEvents()
  await screen.findByRole('cell', { name: /member42/ })
  expect(
    screen.queryByRole('columnheader', { name: 'API Key' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'View' }))
  await user.click(
    await screen.findByRole('menuitemcheckbox', { name: 'API Key' })
  )
  await user.keyboard('{Escape}')
  expect(screen.getByRole('columnheader', { name: 'API Key' })).toBeVisible()
  view.unmount()
  renderEvents()
  expect(
    await screen.findByRole('columnheader', { name: 'API Key' })
  ).toBeVisible()
})

it('truncates long request summaries while opening the stored content from the row', async () => {
  const user = userEvent.setup()
  const preview =
    'A long stored request containing quoted content and instructions that must remain compact within its table column.'
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/events/71')
        ? { request_content: 'Full stored request content', audits: [] }
        : { items: [{ ...event, preview }], total: 1, page: 1 },
    },
  }))
  renderEvents()
  const summary = await screen.findByRole('button', { name: preview })
  expect(within(summary).getByText(preview)).toHaveClass('truncate')
  expect(summary).toHaveClass('max-w-60')
  await user.click(summary)
  const details = await screen.findByRole('dialog')
  expect(
    await within(details).findByText('Full stored request content')
  ).toBeVisible()
})

it('offers retry on mobile after a failed query and keeps event details accessible', async () => {
  const user = userEvent.setup()
  const matchMedia = window.matchMedia
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...matchMedia(query),
    matches: query === '(max-width: 640px)',
  }))
  vi.spyOn(api, 'get')
    .mockResolvedValueOnce({
      data: {
        success: false,
        message: 'Request protection is temporarily unavailable',
      },
    })
    .mockImplementation(async (url) => ({
      data: {
        success: true,
        data: url.endsWith('/events/71')
          ? { request_content: 'Stored content on mobile', audits: [] }
          : { items: [event], total: 1, page: 1 },
      },
    }))
  renderEvents()
  expect(await screen.findByText('Failed to load logs')).toBeVisible()
  expect(screen.queryByText('No protection events')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('navigation', { name: 'Page' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('member42')).toBeVisible()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'View details' }))
  const details = await screen.findByRole('dialog')
  expect(
    await within(details).findByText('Stored content on mobile')
  ).toBeVisible()
})
