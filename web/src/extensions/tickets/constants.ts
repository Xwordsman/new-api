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
import type { TicketAction, TicketCategory, TicketStatus } from './types'

export const ticketStatuses: Record<
  TicketStatus,
  { labelKey: string; className: string }
> = {
  processing: {
    labelKey: 'Being handled',
    className:
      'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300',
  },
  waiting_user: {
    labelKey: 'Waiting for your reply',
    className:
      'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  resolved: {
    labelKey: 'Resolved',
    className:
      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  },
  withdrawn: {
    labelKey: 'Withdrawn',
    className: 'border-border bg-muted text-muted-foreground',
  },
}

export const ticketCategories: Record<TicketCategory, string> = {
  quota: 'Quota issue',
  platform: 'Platform error',
  interface: 'Interface issue',
  api: 'API error',
  refund: 'Refund request',
  account: 'Account issue',
  other: 'Other issue',
}

export const ticketActions: Record<
  TicketAction,
  { labelKey: string; descriptionKey: string; eventKey: string }
> = {
  resolve: {
    labelKey: 'Resolve ticket',
    descriptionKey:
      'Mark this issue as resolved? You can reopen the ticket if you still need help.',
    eventKey: 'Marked the ticket as resolved',
  },
  withdraw: {
    labelKey: 'Withdraw ticket',
    descriptionKey:
      'Withdraw this ticket? The conversation will be kept and can be reopened.',
    eventKey: 'Withdrew the ticket',
  },
  reopen: {
    labelKey: 'Reopen ticket',
    descriptionKey: 'Reopen this ticket and send it back to the support queue?',
    eventKey: 'Reopened the ticket',
  },
}

export const ticketImageError =
  'Use up to 5 valid PNG, JPG or WebP images, each no larger than 2 MB'
