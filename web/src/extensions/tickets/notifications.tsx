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
import { Link } from '@tanstack/react-router'
import { Headset } from 'lucide-react'
import type { ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { NotificationPopover } from '@/components/notification-popover'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAuthStore } from '@/stores/auth-store'

import { useTicketNotifications } from './hooks'
import type { Ticket, TicketView } from './types'

function TicketNotificationItem(props: {
  ticket: Ticket
  view: TicketView
  onSelect: () => void
}) {
  const { t } = useTranslation()
  return (
    <Link
      to='/tickets'
      search={{ view: props.view, id: props.ticket.id }}
      onClick={props.onSelect}
      className='hover:bg-muted/50 focus-visible:ring-ring block rounded-lg border p-3 outline-none focus-visible:ring-2'
    >
      <div className='mb-1 flex items-center gap-2'>
        <span className='size-1.5 shrink-0 rounded-full bg-blue-500' />
        <span className='min-w-0 truncate text-xs font-medium'>
          {props.ticket.subject}
        </span>
      </div>
      <p className='text-muted-foreground line-clamp-2 text-xs break-words'>
        {props.ticket.preview || t('Ticket status updated')}
      </p>
      <span className='text-muted-foreground mt-2 block text-[10px]'>
        {props.view === 'team' ? t('Team tickets') : t('My tickets')} · #
        {props.ticket.id}
      </span>
    </Link>
  )
}

export function TicketNotificationPopover(
  props: ComponentProps<typeof NotificationPopover>
) {
  const { t } = useTranslation()
  const userID = useAuthStore((state) => state.auth.user?.id)
  const query = useTicketNotifications()
  if (!userID) return <NotificationPopover {...props} />
  const count = (query.data?.mine.total ?? 0) + (query.data?.team.total ?? 0)
  return (
    <NotificationPopover
      {...props}
      unreadCount={props.unreadCount + count}
      additionalTabs={[
        {
          value: 'tickets',
          label: (
            <>
              <Headset className='size-3.5' />
              {t('Tickets')}
              {count > 0 && (
                <Badge variant='secondary' className='px-1 text-[10px]'>
                  {count > 99 ? '99+' : count}
                </Badge>
              )}
            </>
          ),
          content: (
            <>
              <ScrollArea className='h-[min(52vh,28rem)] pr-3'>
                {query.isPending && <LoadingState className='min-h-48' />}
                {query.isError && (
                  <ErrorState onRetry={() => void query.refetch()} />
                )}
                {query.isSuccess && count === 0 && (
                  <EmptyState
                    icon={Headset}
                    className='min-h-48'
                    title={t('No unread ticket messages')}
                    description={t(
                      'Support replies and ticket updates will appear here.'
                    )}
                  />
                )}
                {query.isSuccess && count > 0 && (
                  <div className='space-y-2'>
                    {query.data.mine.items.map((ticket) => (
                      <TicketNotificationItem
                        key={`mine-${ticket.id}`}
                        ticket={ticket}
                        view='mine'
                        onSelect={() => props.onOpenChange(false)}
                      />
                    ))}
                    {query.data.team.items.map((ticket) => (
                      <TicketNotificationItem
                        key={`team-${ticket.id}`}
                        ticket={ticket}
                        view='team'
                        onSelect={() => props.onOpenChange(false)}
                      />
                    ))}
                  </div>
                )}
              </ScrollArea>
              <Button
                variant='outline'
                size='sm'
                className='mt-2 w-full'
                render={
                  <Link
                    to='/tickets'
                    search={{ view: 'mine' }}
                    onClick={() => props.onOpenChange(false)}
                  />
                }
              >
                {t('Open ticket center')}
              </Button>
            </>
          ),
        },
      ]}
    />
  )
}
