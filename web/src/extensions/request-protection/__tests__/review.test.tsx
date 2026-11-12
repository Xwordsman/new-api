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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'

import { EventsPanel } from '../components/events-panel'
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
