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
import { render } from '@testing-library/react'
import i18next, { type i18n } from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import type { Conversation, Ticket, TicketList, TicketMessage } from '../types'

export const ticket: Ticket = {
  id: 41,
  user_id: 7,
  username: 'ticket-owner',
  subject: 'Request returned an error',
  category: 'api',
  status: 'processing',
  version: 1,
  last_message_id: 81,
  preview: 'Request ID support-001 failed.',
  created_at: 1800000000,
  updated_at: 1800000000,
  unread: false,
}
export const message: TicketMessage = {
  id: 81,
  ticket_id: 41,
  author_id: 7,
  author_name: 'ticket-owner',
  staff: false,
  body: 'Request ID support-001 failed.',
  event: '',
  created_at: 1800000000,
  attachments: [],
}
export const conversation: Conversation = {
  ticket,
  messages: [message],
  has_older: false,
}
export const emptyList: TicketList = {
  items: [],
  total: 0,
  page: 1,
  page_size: 20,
}
export const success = <T,>(data: T) => ({
  data: { success: true, message: '', data },
})

export function ticketFixtureRequests(url: string) {
  if (/\/\d+$/.test(url)) return success(conversation)
  if (url.endsWith('/notifications')) {
    return success({ mine: emptyList, team: emptyList })
  }
  return success({ ...emptyList, items: [ticket], total: 1 })
}

export function renderTickets(
  children: ReactNode,
  options?: { admin?: boolean; translations?: i18n }
) {
  useAuthStore.getState().auth.setUser({
    id: 7,
    username: 'ticket-owner',
    role: options?.admin ? ROLE.ADMIN : ROLE.USER,
  })
  const client = createAppQueryClient()
  client.setDefaultOptions({
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  })
  const result = render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={options?.translations ?? i18next}>
        {children}
      </I18nextProvider>
    </QueryClientProvider>
  )
  return { ...result, client }
}

export function clearTickets(client?: QueryClient) {
  client?.clear()
  useAuthStore.getState().auth.setUser(null)
}

// Network requests stay at the shared Axios boundary; components, schemas,
// hooks and cache invalidation all execute their production implementations.
export { api }
