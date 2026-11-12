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
import type { QueryClient } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { TicketConversation } from '../components/ticket-conversation'
import { ticketQueryKey } from '../hooks'
import type { Conversation } from '../types'
import {
  api,
  clearTickets,
  conversation,
  message,
  renderTickets,
  success,
  ticket,
} from './fixtures'

let client: QueryClient
afterEach(() => clearTickets(client))

it('keeps a failed reply draft and sends the current version before showing the saved reply', async () => {
  const user = userEvent.setup()
  let current: Conversation = structuredClone(conversation)
  vi.spyOn(api, 'get').mockImplementation(async () => success(current))
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValueOnce({
      data: {
        success: false,
        message: 'This ticket has changed. Refresh and try again.',
      },
    })
    .mockImplementation(async (_url, body) => {
      const data = body as FormData
      current = {
        ticket: { ...ticket, version: 2, last_message_id: 82 },
        messages: [
          message,
          { ...message, id: 82, body: String(data.get('body')) },
        ],
        has_older: false,
      }
      return success(null)
    })
  ;({ client } = renderTickets(
    <TicketConversation id={41} view='mine' onBack={vi.fn()} />
  ))
  const reply = await screen.findByRole('textbox', { name: 'Reply' })
  await user.type(reply, 'Additional request details')
  await user.click(screen.getByRole('button', { name: 'Send reply' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Reply failed. Your draft is still here; please try again.'
  )
  expect(reply).toHaveValue('Additional request details')
  await user.click(screen.getByRole('button', { name: 'Send reply' }))
  expect(
    await screen.findByText('Additional request details', { selector: 'p' })
  ).toBeVisible()
  expect(reply).toHaveValue('')
  expect(post).toHaveBeenLastCalledWith(
    '/api/extensions/tickets/41/replies',
    expect.any(FormData)
  )
  const lastBody = post.mock.calls.at(-1)?.[1]
  expect(lastBody).toBeInstanceOf(FormData)
  if (!(lastBody instanceof FormData)) {
    throw new Error('Expected a multipart reply')
  }
  expect(lastBody.get('version')).toBe('1')
})

it('requires confirmation to withdraw, disables closed replies, and can reopen the retained conversation', async () => {
  const user = userEvent.setup()
  let current = structuredClone(conversation)
  vi.spyOn(api, 'get').mockImplementation(async () => success(current))
  const post = vi.spyOn(api, 'post').mockImplementation(async (_url, body) => {
    const data = body as { action: string }
    current = {
      ...current,
      ticket: {
        ...current.ticket,
        status: data.action === 'withdraw' ? 'withdrawn' : 'processing',
        version: current.ticket.version + 1,
      },
    }
    return success(null)
  })
  ;({ client } = renderTickets(
    <TicketConversation id={41} view='mine' onBack={vi.fn()} />
  ))
  await user.click(
    await screen.findByRole('button', { name: 'Withdraw ticket' })
  )
  const confirm = screen.getByRole('alertdialog', { name: 'Withdraw ticket' })
  expect(post).not.toHaveBeenCalled()
  await user.click(
    within(confirm).getByRole('button', { name: 'Withdraw ticket' })
  )
  expect(
    await screen.findByText(
      'This ticket is closed. Reopen it to continue the conversation.'
    )
  ).toBeVisible()
  expect(
    screen.queryByRole('textbox', { name: 'Reply' })
  ).not.toBeInTheDocument()
  expect(screen.getByText(message.body)).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Reopen ticket' }))
  await user.click(
    within(
      screen.getByRole('alertdialog', { name: 'Reopen ticket' })
    ).getByRole('button', { name: 'Reopen ticket' })
  )
  expect(await screen.findByRole('textbox', { name: 'Reply' })).toBeEnabled()
  expect(post).toHaveBeenLastCalledWith('/api/extensions/tickets/41/actions', {
    version: 2,
    action: 'reopen',
  })
})

it('does not mark a newer reply read until the conversation is visible and scrolled to it', async () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  let current = { ...conversation, ticket: { ...ticket, unread: true } }
  vi.spyOn(api, 'get').mockImplementation(async () => success(current))
  const post = vi.spyOn(api, 'post').mockResolvedValue(success(null))
  ;({ client } = renderTickets(
    <TicketConversation id={41} view='mine' onBack={vi.fn()} />
  ))
  const viewport = (await screen.findByLabelText('Messages')).parentElement
  if (!viewport) {
    throw new Error('Missing conversation scroll viewport')
  }
  Object.defineProperties(viewport, {
    scrollHeight: { configurable: true, value: 1200 },
    clientHeight: { configurable: true, value: 400 },
  })
  viewport.scrollTop = 0
  fireEvent.wheel(viewport, { deltaY: -100 })
  fireEvent.scroll(viewport)
  expect(post).not.toHaveBeenCalled()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  fireEvent(document, new Event('visibilitychange'))
  expect(post).not.toHaveBeenCalled()
  viewport.scrollTop = 800
  fireEvent.scroll(viewport)
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/extensions/tickets/41/read', {
      up_to: 81,
    })
  )
  current = {
    ...current,
    ticket: { ...current.ticket, unread: true, last_message_id: 82 },
    messages: [
      ...current.messages,
      { ...message, id: 82, staff: true, body: 'A new support reply' },
    ],
  }
  viewport.scrollTop = 0
  fireEvent.wheel(viewport, { deltaY: -100 })
  fireEvent.scroll(viewport)
  await act(() => client.invalidateQueries({ queryKey: ticketQueryKey }))
  expect(await screen.findByText('A new support reply')).toBeVisible()
  expect(post).not.toHaveBeenCalledWith('/api/extensions/tickets/41/read', {
    up_to: 82,
  })
  viewport.scrollTop = 800
  fireEvent.scroll(viewport)
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/extensions/tickets/41/read', {
      up_to: 82,
    })
  )
})

it('keeps following a long new reply when the reader was already at the bottom', async () => {
  let current = structuredClone(conversation)
  vi.spyOn(api, 'get').mockImplementation(async () => success(current))
  vi.spyOn(api, 'post').mockResolvedValue(success(null))
  ;({ client } = renderTickets(
    <TicketConversation id={41} view='mine' onBack={vi.fn()} />
  ))
  const viewport = (await screen.findByLabelText('Messages')).parentElement
  if (!viewport) {
    throw new Error('Missing conversation scroll viewport')
  }
  let height = 800
  Object.defineProperties(viewport, {
    scrollHeight: { configurable: true, get: () => height },
    clientHeight: { configurable: true, value: 400 },
  })
  viewport.scrollTop = 400
  fireEvent.scroll(viewport)
  current = {
    ...current,
    ticket: { ...ticket, last_message_id: 82 },
    messages: [
      ...current.messages,
      { ...message, id: 82, staff: true, body: 'A detailed support reply' },
    ],
  }
  height = 1800
  await act(() => client.invalidateQueries({ queryKey: ticketQueryKey }))
  expect(await screen.findByText('A detailed support reply')).toBeVisible()
  await waitFor(() => expect(viewport.scrollTop).toBeGreaterThanOrEqual(1399))
})
