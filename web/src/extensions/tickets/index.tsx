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
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { Headset, MessageSquareText, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ConsolePageHeader, Main } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ROLE } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { TicketCompose } from './components/ticket-compose'
import { TicketConversation } from './components/ticket-conversation'
import { TicketListPane } from './components/ticket-list'
import type { TicketSelection } from './types'

export function TicketCenter(props: {
  selection: TicketSelection
  onNavigate: (selection: TicketSelection) => void
}) {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const isAdmin = (user?.role ?? 0) >= ROLE.ADMIN
  const view = isAdmin ? props.selection.view : 'mine'
  const composing = view === 'mine' && props.selection.compose
  const hasDetail = composing || !!props.selection.id
  const newTicket = () => props.onNavigate({ view: 'mine', compose: true })
  const back = () => props.onNavigate({ view })

  return (
    <Main className='console-page'>
      <ConsolePageHeader
        icon={Headset}
        eyebrow='SUPPORT · TICKETS'
        title={t('Ticket center')}
        description={t('Questions and conversations between you and our team.')}
        actions={
          <Button onClick={newTicket}>
            <Plus className='size-3.5' />
            {t('New ticket')}
          </Button>
        }
      >
        {isAdmin && (
          <Tabs
            value={view}
            onValueChange={(next) =>
              props.onNavigate({ view: next === 'team' ? 'team' : 'mine' })
            }
          >
            <TabsList>
              <TabsTrigger value='mine'>{t('My tickets')}</TabsTrigger>
              <TabsTrigger value='team'>{t('Team tickets')}</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </ConsolePageHeader>
      <div className='flex min-h-0 flex-1 px-4 pb-6 sm:px-6 lg:px-8'>
        <div className='console-surface bg-card grid min-h-0 w-full min-w-0 flex-1 overflow-hidden rounded-xl border shadow-xs md:grid-cols-[44%_56%]'>
          <div
            className={cn(
              'min-h-0 min-w-0 md:border-e',
              hasDetail && 'hidden md:block'
            )}
          >
            <TicketListPane
              key={view}
              view={view}
              selectedID={props.selection.id}
              onSelect={(id) => props.onNavigate({ view, id })}
            />
          </div>
          <div
            className={cn('min-h-0 min-w-0', !hasDetail && 'hidden md:block')}
          >
            {composing && (
              <TicketCompose
                onBack={back}
                onCreated={(id) => props.onNavigate({ view: 'mine', id })}
              />
            )}
            {!composing && props.selection.id && (
              <TicketConversation
                key={`${view}-${props.selection.id}`}
                id={props.selection.id}
                view={view}
                onBack={back}
              />
            )}
            {!hasDetail && (
              <div className='flex h-full items-center justify-center p-5'>
                <EmptyState
                  icon={MessageSquareText}
                  title={t('Select a ticket')}
                  description={t(
                    'Choose a ticket from the list to view the conversation and progress.'
                  )}
                  action={
                    <Button variant='outline' onClick={newTicket}>
                      <Plus className='size-3.5' />
                      {t('New ticket')}
                    </Button>
                  }
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </Main>
  )
}

const route = getRouteApi('/_authenticated/tickets/')

export function TicketPage() {
  const selection = route.useSearch()
  const navigate = useNavigate()
  return (
    <TicketCenter
      selection={selection}
      onNavigate={(search) => void navigate({ to: '/tickets', search })}
    />
  )
}
