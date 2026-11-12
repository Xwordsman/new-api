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

import { getReferralList } from '../api'
import type {
  Invitee,
  ReferralAudit,
  ReferralListParams,
  ReferralReward,
  ReferralTransfer,
} from '../types'

type Row = Invitee | ReferralReward | ReferralTransfer | ReferralAudit
type Resource = Parameters<typeof getReferralList>[0]

// One server-paginated composition for the extension's four ledgers.
export function ReferralTable<T extends Row>(props: {
  resource: Resource
  params?: Omit<ReferralListParams, 'p' | 'page_size'>
  columns: StaticDataTableColumn<T>[]
}) {
  const { t } = useTranslation()
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })
  const query = useQuery({
    queryKey: ['referral-extension', props.resource, props.params, pagination],
    queryFn: () =>
      getReferralList<T>(props.resource, {
        ...props.params,
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
      }),
    placeholderData: keepPreviousData,
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

  if (query.isPending) return <LoadingState className='min-h-52' />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  return (
    <div aria-busy={query.isFetching} className='space-y-4'>
      <StaticDataTable
        columns={props.columns}
        data={data}
        getRowKey={(row) => row.id}
        tableClassName='min-w-[720px]'
        emptyContent={
          <EmptyState
            className='min-h-48'
            title={t('No referral records yet')}
            description={t(
              'Eligible invitations and rewards will appear here.'
            )}
          />
        }
      />
      <DataTablePagination table={table} compact />
    </div>
  )
}
