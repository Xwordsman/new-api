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
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type {
  Conversation,
  Ticket,
  TicketAction,
  TicketDraft,
  TicketFilters,
  TicketList,
  TicketView,
} from './types'

type Envelope<T> = { success: boolean; message: string; data: T }
const base = '/api/extensions/tickets'

export function ticketBase(view: TicketView): string {
  return view === 'team' ? `${base}/admin` : base
}

export async function getTickets(
  view: TicketView,
  filters: TicketFilters,
  signal?: AbortSignal
): Promise<TicketList> {
  return requireServerSuccess(
    (
      await api.get<Envelope<TicketList>>(ticketBase(view), {
        params: filters,
        signal,
      })
    ).data
  ).data
}

export async function getConversation(
  view: TicketView,
  id: number,
  before: number,
  signal?: AbortSignal
): Promise<Conversation> {
  return requireServerSuccess(
    (
      await api.get<Envelope<Conversation>>(`${ticketBase(view)}/${id}`, {
        params: { before },
        signal,
      })
    ).data
  ).data
}

export async function createTicket(
  draft: TicketDraft,
  images: File[]
): Promise<Ticket> {
  const data = new FormData()
  data.set('subject', draft.subject)
  data.set('category', draft.category)
  data.set('body', draft.body)
  images.forEach((image) => data.append('images', image))
  return requireServerSuccess(
    (await api.post<Envelope<Ticket>>(base, data)).data
  ).data
}

export async function replyToTicket(
  view: TicketView,
  ticket: Ticket,
  body: string,
  images: File[]
): Promise<void> {
  const data = new FormData()
  data.set('version', String(ticket.version))
  data.set('body', body)
  images.forEach((image) => data.append('images', image))
  requireServerSuccess(
    (
      await api.post<Envelope<null>>(
        `${ticketBase(view)}/${ticket.id}/replies`,
        data
      )
    ).data
  )
}

export async function changeTicketStatus(
  view: TicketView,
  ticket: Ticket,
  action: TicketAction
): Promise<void> {
  requireServerSuccess(
    (
      await api.post<Envelope<null>>(
        `${ticketBase(view)}/${ticket.id}/actions`,
        { version: ticket.version, action }
      )
    ).data
  )
}

export async function markTicketRead(
  view: TicketView,
  id: number,
  upTo: number
): Promise<void> {
  requireServerSuccess(
    (
      await api.post<Envelope<null>>(`${ticketBase(view)}/${id}/read`, {
        up_to: upTo,
      })
    ).data
  )
}

export async function getTicketImage(
  view: TicketView,
  ticketID: number,
  imageID: number,
  signal?: AbortSignal
): Promise<Blob> {
  return (
    await api.get<Blob>(`${ticketBase(view)}/${ticketID}/images/${imageID}`, {
      responseType: 'blob',
      signal,
    })
  ).data
}

export async function getTicketNotifications(
  signal?: AbortSignal
): Promise<{ mine: TicketList; team: TicketList }> {
  return requireServerSuccess(
    (
      await api.get<Envelope<{ mine: TicketList; team: TicketList }>>(
        `${base}/notifications`,
        { signal }
      )
    ).data
  ).data
}
