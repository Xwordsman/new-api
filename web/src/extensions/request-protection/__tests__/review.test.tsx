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
import { RestrictionsPanel } from '../components/restrictions-panel'
import { ProtectionReviewDialog } from '../components/review-dialog'

let client: QueryClient
beforeEach(() => {
  client = createAppQueryClient()
  client.setDefaultOptions({
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  })
})
afterEach(() => {
  client.clear()
  vi.restoreAllMocks()
})

it('shows user safety holds as manual release and opens the selected user release dialog', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        items: [
          {
            id: 'user:206',
            group: 'premium',
            user_id: 206,
            token_id: 0,
            until: 253402300799,
            manual_review: true,
            cause_event_id: 9,
          },
        ],
        total: 1,
        page: 1,
      },
    },
  })
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  render(
    <QueryClientProvider client={client}>
      <RestrictionsPanel />
    </QueryClientProvider>
  )
  expect(await screen.findByText('Until manual release')).toBeVisible()
  expect(screen.getByText('premium')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Release restriction' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Review reason' }),
    'User reviewed with upstream'
  )
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/extensions/request-protection/admin/release',
      { subject_id: 'user:206', note: 'User reviewed with upstream' }
    )
  )
})

it('requires a review reason and preserves it when the server rejects the review', async () => {
  const user = userEvent.setup()
  const close = vi.fn()
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValueOnce({
      data: {
        success: false,
        message: 'Request protection is temporarily unavailable',
      },
    })
    .mockResolvedValueOnce({ data: { success: true } })
  render(
    <QueryClientProvider client={client}>
      <ProtectionReviewDialog
        action={{ kind: 'review', event: 7, verdict: 'false_positive' }}
        onClose={close}
      />
    </QueryClientProvider>
  )
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  const note = screen.getByRole('textbox', { name: 'Review reason' })
  expect(note).toHaveAttribute('aria-invalid', 'true')
  expect(post).not.toHaveBeenCalled()
  await user.type(note, 'Legitimate quoted research')
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled()
  )
  expect(note).toHaveValue('Legitimate quoted research')
  expect(close).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(post).toHaveBeenLastCalledWith(
    '/api/extensions/request-protection/admin/review',
    {
      event_id: 7,
      verdict: 'false_positive',
      note: 'Legitimate quoted research',
    }
  )
})

it('releases only the selected plugin restriction with the administrator reason', async () => {
  const user = userEvent.setup()
  const close = vi.fn()
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  render(
    <QueryClientProvider client={client}>
      <ProtectionReviewDialog
        action={{ kind: 'release', subject: 'key:42' }}
        onClose={close}
      />
    </QueryClientProvider>
  )
  await user.type(
    screen.getByRole('textbox', { name: 'Review reason' }),
    'Reviewed with account owner'
  )
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(post).toHaveBeenCalledExactlyOnceWith(
    '/api/extensions/request-protection/admin/release',
    { subject_id: 'key:42', note: 'Reviewed with account owner' }
  )
})

it('shows an empty event list and prevents paging past its boundaries', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { items: [], total: 0, page: 1 } },
  })
  render(
    <QueryClientProvider client={client}>
      <EventsPanel />
    </QueryClientProvider>
  )
  expect(await screen.findByText('No protection events')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Go to previous page' })
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Go to next page' })).toBeDisabled()
})

it('recovers an event query after a server failure through the shared retry action', async () => {
  const user = userEvent.setup()
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValueOnce({
      data: {
        success: false,
        message: 'Request protection is temporarily unavailable',
      },
    })
    .mockResolvedValueOnce({
      data: { success: true, data: { items: [], total: 0, page: 1 } },
    })
  render(
    <QueryClientProvider client={client}>
      <EventsPanel />
    </QueryClientProvider>
  )
  await user.click(await screen.findByRole('button', { name: /retry/i }))
  expect(await screen.findByText('No protection events')).toBeVisible()
  expect(get).toHaveBeenCalledTimes(2)
})

it('lists named users and channels in columns and pauses only the user selected from event details', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/events/71')
        ? {
            request_content: '[current]\nActual request text',
            content_truncated: true,
            content_redacted: true,
            audits: [],
          }
        : {
            items: [
              {
                preview: 'Actual request text',
                restrictions: [],
                violation_count: 1,
                id: 71,
                user_id: 42,
                token_id: 8,
                username: 'member42',
                token_name: 'Personal key',
                channel_id: 5,
                channel_name: 'Business provider',
                ip: '192.0.2.10',
                created_at: 1795200000,
                group: 'premium',
                model: 'gpt-4.1',
                protocol: 'openai',
                decision: 'block',
                finding: 'violation',
                reason: 'harmful_attack',
                review: 'confirmed',
                upstream: 'not_sent',
                request_id: 'request-71',
                counted: true,
                revision: 5,
                digest: 'digest',
                uninspected: '',
                matches: [
                  {
                    rule_id: 'semantic_review',
                    name: 'Semantic review',
                    category: 'attack',
                    source: 'current',
                    action: 'block',
                    evidence: 'test evidence excerpt',
                    high_confidence: true,
                    count_penalty: true,
                  },
                ],
              },
            ],
            total: 1,
            page: 1,
          },
    },
  }))
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  render(
    <QueryClientProvider client={client}>
      <EventsPanel />
    </QueryClientProvider>
  )
  expect(await screen.findByRole('cell', { name: /member42/ })).toBeVisible()
  expect(screen.getByRole('columnheader', { name: 'User' })).toBeVisible()
  expect(
    screen.getByRole('columnheader', { name: 'Inspection result' })
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'View details' }))
  const details = await screen.findByRole('dialog')
  expect(within(details).getByText('192.0.2.10')).toBeVisible()
  expect(within(details).getByText('test evidence excerpt')).toBeVisible()
  expect(
    await within(details).findByText('[current] Actual request text')
  ).toBeVisible()
  expect(
    within(details).getByText('Recognizable credentials have been redacted.')
  ).toBeVisible()
  expect(
    within(details).getByText(
      'Content was truncated or could not be fully extracted. Attachments are not stored.'
    )
  ).toBeVisible()
  await user.click(
    within(details).getByRole('button', { name: 'Pause this user' })
  )
  await user.click(await screen.findByRole('button', { name: 'Confirm' }))
  expect(post).not.toHaveBeenCalled()
  await user.type(
    screen.getByRole('textbox', { name: 'Review reason' }),
    'Reviewed current request'
  )
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledExactlyOnceWith(
      '/api/extensions/request-protection/admin/hold',
      { event_id: 71, note: 'Reviewed current request' }
    )
  )
})

it('separates incomplete inspection coverage from suspected intent in the log and details', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/events/72')
        ? { request_content: '[current]\nHello', audits: [] }
        : {
            items: [
              {
                id: 72,
                user_id: 42,
                created_at: 1795200000,
                model: 'gpt-4.1',
                decision: 'observe',
                finding: 'check_failed',
                reason: 'incomplete_input',
                uninspected: 'binary_or_unknown_content',
                matches: [],
                upstream: 'responded',
                preview: 'Hello',
              },
            ],
            total: 1,
            page: 1,
          },
    },
  }))
  render(
    <QueryClientProvider client={client}>
      <EventsPanel />
    </QueryClientProvider>
  )
  const intent = await screen.findByRole('cell', {
    name: 'No violation intent conclusion',
  })
  expect(intent).not.toHaveTextContent('Input could not be fully inspected')
  const coverage = screen.getByRole('cell', {
    name: /Record only.*Media or unknown content/,
  })
  expect(coverage).toHaveTextContent('Upstream responded')
  await user.click(screen.getByRole('button', { name: 'View details' }))
  const details = await screen.findByRole('dialog')
  expect(
    within(details).getByText('No violation intent conclusion')
  ).toBeVisible()
  expect(within(details).getByText('Media or unknown content')).toBeVisible()
  expect(
    within(details).getByRole('heading', { name: 'Inspection coverage' })
  ).toBeVisible()
})
