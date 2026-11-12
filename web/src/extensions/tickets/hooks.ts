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
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import {
  getConversation,
  getTicketNotifications,
  getTickets,
  markTicketRead,
} from './api'
import type { TicketFilters, TicketView } from './types'

export const ticketQueryKey = ['ticket-extension'] as const

export function useTicketList(view: TicketView, filters: TicketFilters) {
  const user = useAuthStore((state) => state.auth.user)
  return useQuery({
    queryKey: [...ticketQueryKey, user?.id, view, 'list', filters],
    queryFn: ({ signal }) => getTickets(view, filters, signal),
    enabled: !!user && (view === 'mine' || user.role >= ROLE.ADMIN),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  })
}

export function useTicketConversation(view: TicketView, id: number) {
  const user = useAuthStore((state) => state.auth.user)
  return useInfiniteQuery({
    queryKey: [...ticketQueryKey, user?.id, view, 'conversation', id],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      getConversation(view, id, pageParam, signal),
    getNextPageParam: (lastPage) =>
      lastPage.has_older ? lastPage.messages[0]?.id : undefined,
    enabled: !!user && (view === 'mine' || user.role >= ROLE.ADMIN),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  })
}

export function useTicketNotifications() {
  const user = useAuthStore((state) => state.auth.user)
  return useQuery({
    queryKey: [...ticketQueryKey, user?.id, 'notifications'],
    queryFn: ({ signal }) => getTicketNotifications(signal),
    enabled: !!user,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    meta: { errorToast: false },
  })
}

export function useReadTicket(view: TicketView, id: number) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (upTo: number) => markTicketRead(view, id, upTo),
    onSuccess: () => client.invalidateQueries({ queryKey: ticketQueryKey }),
  })
}
