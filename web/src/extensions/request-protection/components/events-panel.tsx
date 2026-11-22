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
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

import { getEvents } from '../api'
import type { EventFilters, ProtectionEvent } from '../types'
import { useEventColumns } from './event-columns'
import { EventDetailsDialog } from './event-details-dialog'
import { EventsFilterToolbar } from './events-filter-toolbar'
import { RestrictionsPanel } from './restrictions-panel'
import { ProtectionReviewDialog, type ReviewAction } from './review-dialog'

const EMPTY_FILTERS: EventFilters = {
  user_id: '',
  token_id: '',
  decision: '',
  review: '',
  suspended: '',
}
const EMPTY_EVENTS: ProtectionEvent[] = []

export function EventsPanel() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [applied, setApplied] = useState(EMPTY_FILTERS)
  const [detail, setDetail] = useState<ProtectionEvent | null>(null)
  const [action, setAction] = useState<ReviewAction | null>(null)
  const query = useQuery({
    queryKey: ['request-protection', 'events', page, applied],
    queryFn: () => getEvents(page, applied),
    // Returning to a cached filter must still request the latest risk records.
    staleTime: 0,
  })
  const columns = useEventColumns({ onDetails: setDetail, onAction: setAction })
  const { table } = useDataTable({
    columns,
    data: query.isError ? EMPTY_EVENTS : (query.data?.items ?? EMPTY_EVENTS),
    getRowId: (event) => String(event.id),
    totalCount: query.isError ? 0 : (query.data?.total ?? 0),
    pagination: { pageIndex: page - 1, pageSize: 20 },
    onPaginationChange: (updater) => {
      if (query.isFetching || query.isError) return
      const current = { pageIndex: page - 1, pageSize: 20 }
      const next = typeof updater === 'function' ? updater(current) : updater
      setPage(next.pageIndex + 1)
    },
    enableRowSelection: false,
    enableSorting: false,
    manualFiltering: true,
    manualPagination: true,
    columnVisibilityStorageKey: 'request-protection:events:column-visibility',
    initialColumnVisibility: { token_name: false, group: false },
  })

  const applyFilters = (nextFilters: EventFilters) => {
    const unchanged = Object.entries(nextFilters).every(
      ([key, value]) => value === applied[key as keyof EventFilters]
    )
    if (page === 1 && unchanged) {
      void query.refetch()
      return
    }
    setApplied({ ...nextFilters })
    setPage(1)
  }

  return (
    <div
      className='min-w-0 space-y-4'
      role='region'
      aria-label={t('Protection logs')}
      aria-busy={query.isFetching}
    >
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={query.isPending}
        isFetching={query.isFetching}
        emptyTitle={
          query.isError ? t('Failed to load logs') : t('No protection events')
        }
        emptyIcon={
          query.isError ? (
            <AlertTriangle className='text-destructive size-6' />
          ) : undefined
        }
        emptyAction={
          query.isError ? (
            <Button variant='outline' onClick={() => void query.refetch()}>
              {t('Retry')}
            </Button>
          ) : undefined
        }
        mobile={
          query.isError ? (
            <ErrorState
              title={t('Failed to load logs')}
              onRetry={() => void query.refetch()}
            />
          ) : undefined
        }
        fixedHeight={false}
        paginationInFooter={false}
        compactPagination
        showPagination={!query.isError}
        applyHeaderSize
        pinnedColumns={[{ columnId: 'actions', side: 'right' }]}
        getColumnClassName={() => 'py-2'}
        tableClassName='[&_[data-slot=table]]:text-[13px] [&_[data-slot=table]_td]:text-[13px] [&_[data-slot=table]_th]:text-[13px]'
        toolbar={
          <div className='space-y-3'>
            <EventsFilterToolbar
              table={table}
              filters={filters}
              onChange={setFilters}
              isFetching={query.isFetching}
              hasActiveFilters={
                Object.values(filters).some(Boolean) ||
                Object.values(applied).some(Boolean)
              }
              onSearch={() => applyFilters(filters)}
              onReset={() => {
                setFilters(EMPTY_FILTERS)
                applyFilters(EMPTY_FILTERS)
              }}
            />
          </div>
        }
        afterTable={
          <p className='text-muted-foreground text-xs'>
            {t(
              'Recorded violations count retained, deduplicated matches for this user. False positives are excluded. Only matching or failed inspections are logged.'
            )}
          </p>
        }
      />
      <Collapsible>
        <CollapsibleTrigger render={<Button variant='outline' />}>
          {t('Manage paused users')}
        </CollapsibleTrigger>
        <CollapsibleContent className='pt-4'>
          <RestrictionsPanel />
        </CollapsibleContent>
      </Collapsible>
      {detail && (
        <EventDetailsDialog
          event={detail}
          onClose={() => setDetail(null)}
          onAction={(next) => {
            setAction(next)
            setDetail(null)
          }}
        />
      )}
      {action && (
        <ProtectionReviewDialog
          action={action}
          onClose={() => setAction(null)}
        />
      )}
    </div>
  )
}
