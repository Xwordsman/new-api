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
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { RefreshCw, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePagination } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Toggle } from '@/components/ui/toggle'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { formatDateTimeObject } from '@/lib/time'
import { cn } from '@/lib/utils'

import { ticketCategories, ticketStatuses } from '../constants'
import { useTicketList } from '../hooks'
import type { TicketView } from '../types'
import { TicketStatusBadge } from './ticket-status'

export function TicketListPane(props: {
  view: TicketView
  selectedID?: number
  onSelect: (id: number) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [unread, setUnread] = useState(false)
  const query = useTicketList(props.view, {
    page: pagination.pageIndex + 1,
    search,
    status,
    unread,
  })
  const data = query.data?.items ?? []
  const table = useReactTable({
    data,
    columns: [],
    rowCount: query.data?.total ?? 0,
    state: { pagination },
    onPaginationChange: setPagination,
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <section
      aria-label={props.view === 'team' ? t('Team tickets') : t('My tickets')}
      className='flex h-full min-h-0 flex-col'
    >
      <div className='space-y-3 border-b p-4'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <h2 className='text-sm font-semibold'>
            {props.view === 'team' ? t('Team tickets') : t('My tickets')}
          </h2>
          <span className='text-muted-foreground text-[11px]'>
            {t('{{formattedCount}} tickets loaded', {
              formattedCount: formatNumber(data.length, locale),
            })}
          </span>
        </div>
        <form
          role='search'
          className='flex gap-2'
          onSubmit={(event) => {
            event.preventDefault()
            setSearch(searchInput.trim())
            setPagination({ ...pagination, pageIndex: 0 })
          }}
        >
          <Input
            aria-label={t('Search ticket subjects')}
            placeholder={t('Search ticket subjects')}
            value={searchInput}
            maxLength={160}
            onChange={(event) => setSearchInput(event.target.value)}
            className='min-w-0 flex-1'
          />
          <Button type='submit' variant='outline' size='sm'>
            <Search className='size-3.5' />
            {t('Search')}
          </Button>
        </form>
        <div className='flex items-center gap-2'>
          <NativeSelect
            aria-label={t('Ticket status')}
            className='min-w-0 flex-1'
            value={status}
            onChange={(event) => {
              setStatus(event.target.value)
              setPagination({ ...pagination, pageIndex: 0 })
            }}
          >
            <NativeSelectOption value=''>{t('All tickets')}</NativeSelectOption>
            {Object.entries(ticketStatuses).map(([value, config]) => (
              <NativeSelectOption key={value} value={value}>
                {t(config.labelKey)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Toggle
            size='sm'
            variant='outline'
            pressed={unread}
            onPressedChange={(value) => {
              setUnread(value)
              setPagination({ ...pagination, pageIndex: 0 })
            }}
          >
            {t('Unread only')}
          </Toggle>
          <Button
            variant='outline'
            size='icon'
            aria-label={t('Refresh tickets')}
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw
              className={cn('size-3.5', query.isFetching && 'animate-spin')}
            />
          </Button>
        </div>
      </div>
      <div
        className='min-h-0 flex-1 overflow-y-auto overscroll-contain'
        aria-busy={query.isFetching}
      >
        {query.isPending && <LoadingState className='min-h-64' />}
        {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
        {query.isSuccess && data.length === 0 && (
          <EmptyState
            className='min-h-80 px-7'
            title={t('No tickets here yet')}
            description={t(
              'Click “New ticket” when you need help. Support replies will appear here.'
            )}
          />
        )}
        {query.isSuccess && data.length > 0 && (
          <ul>
            {data.map((ticket) => (
              <li key={ticket.id} className='border-b last:border-b-0'>
                <Button
                  variant='ghost'
                  aria-current={
                    ticket.id === props.selectedID ? 'true' : undefined
                  }
                  onClick={() => props.onSelect(ticket.id)}
                  className={cn(
                    'h-auto w-full flex-col items-stretch gap-2 rounded-none p-4 text-start whitespace-normal',
                    ticket.id === props.selectedID &&
                      'bg-primary/5 hover:bg-primary/10'
                  )}
                >
                  <div className='flex items-start gap-2'>
                    <span className='min-w-0 flex-1 truncate text-sm font-medium'>
                      {ticket.subject}
                    </span>
                    {ticket.unread && (
                      <span
                        className='mt-1.5 size-2 shrink-0 rounded-full bg-blue-500'
                        aria-label={t('Unread')}
                      />
                    )}
                  </div>
                  <p className='text-muted-foreground line-clamp-2 text-xs font-normal break-words'>
                    {ticket.preview || t('Image attachments')}
                  </p>
                  <div className='flex flex-wrap items-center gap-2'>
                    <TicketStatusBadge status={ticket.status} />
                    <span className='text-muted-foreground text-[11px] font-normal'>
                      {t(ticketCategories[ticket.category])}
                    </span>
                    <span className='text-muted-foreground ms-auto text-[10px] font-normal'>
                      {formatDateTimeObject(new Date(ticket.updated_at * 1000))}
                    </span>
                  </div>
                  {props.view === 'team' && (
                    <span className='text-muted-foreground text-[11px] font-normal'>
                      #{ticket.id} · {ticket.username}
                    </span>
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className='shrink-0 border-t p-3'>
        <DataTablePagination table={table} compact />
      </div>
    </section>
  )
}
