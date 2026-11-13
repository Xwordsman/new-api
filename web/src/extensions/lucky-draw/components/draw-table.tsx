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
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTablePagination,
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'

import { DRAW_QUERY_KEY, getDrawData } from '../api'

export function DrawTable<T>(props: {
  resource: 'history' | 'records' | 'accounts' | 'audit'
  userId?: number
  columns: StaticDataTableColumn<T>[]
  getRowKey: (row: T) => number
}) {
  const { t } = useTranslation()
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })
  const query = useQuery({
    queryKey: [...DRAW_QUERY_KEY, props.resource, props.userId, pagination],
    queryFn: () =>
      getDrawData<{ items: T[]; total: number }>(props.resource, {
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
        ...(props.userId ? { user_id: props.userId } : {}),
      }),
    placeholderData: keepPreviousData,
  })
  const rows = query.data?.items ?? []
  const table = useReactTable({
    data: rows,
    columns: [],
    rowCount: query.data?.total ?? 0,
    state: { pagination },
    onPaginationChange: setPagination,
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
  })
  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  return (
    <div className='space-y-4' aria-busy={query.isFetching}>
      <StaticDataTable
        data={rows}
        columns={props.columns}
        getRowKey={props.getRowKey}
        tableClassName='min-w-[640px]'
        emptyContent={
          <EmptyState
            title={t('No draw records yet')}
            description={t('Records matching your filters will appear here.')}
          />
        }
      />
      <DataTablePagination table={table} compact />
    </div>
  )
}
