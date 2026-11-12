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
export type TicketView = 'mine' | 'team'
export type TicketStatus =
  | 'processing'
  | 'waiting_user'
  | 'resolved'
  | 'withdrawn'
export type TicketCategory =
  | 'quota'
  | 'platform'
  | 'interface'
  | 'api'
  | 'refund'
  | 'account'
  | 'other'
export type TicketAction = 'resolve' | 'withdraw' | 'reopen'

export interface Ticket {
  id: number
  user_id: number
  username: string
  subject: string
  category: TicketCategory
  status: TicketStatus
  version: number
  last_message_id: number
  preview: string
  created_at: number
  updated_at: number
  unread: boolean
}

export interface TicketImage {
  id: number
  name: string
  mime: string
  size: number
}

export interface TicketMessage {
  id: number
  ticket_id: number
  author_id: number
  author_name: string
  staff: boolean
  body: string
  event: '' | TicketAction
  created_at: number
  attachments: TicketImage[]
}

export interface Conversation {
  ticket: Ticket
  messages: TicketMessage[]
  has_older: boolean
}

export interface TicketList {
  items: Ticket[]
  total: number
  page: number
  page_size: number
}

export interface TicketFilters {
  page: number
  search: string
  status: string
  unread: boolean
}

export interface TicketSelection {
  view: TicketView
  compose?: boolean
  id?: number
}

export interface TicketDraft {
  subject: string
  category: TicketCategory
  body: string
}
