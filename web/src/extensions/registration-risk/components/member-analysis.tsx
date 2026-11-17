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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { ReviewDialog } from '@/extensions/referral/components/admin-actions'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { registrationQueryKey } from '../api'
import type { MemberAnalysisAccount, MemberGroupBinding } from '../member-types'
import { getMemberAnalysis, startMemberAnalysis } from '../members-api'
import { useMemberAnalysisColumns } from './member-analysis-columns'
import { MemberDialog } from './member-dialog'
import { MemberPolicySection } from './member-policy-form'

const emptyAccounts: MemberAnalysisAccount[] = []

export function MemberAnalysis() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const actor = useAuthStore((s) => s.auth.user?.id)
  const client = useQueryClient()
  const [filter, setFilter] = useState({
    page: 1,
    page_size: 20,
    kind: 'review',
    search: '',
  })
  const [selected, setSelected] = useState<number | null>(null)
  const [review, setReview] = useState<{
    invitee: MemberGroupBinding
    approve: boolean
  } | null>(null)
  const query = useQuery({
    queryKey: [...registrationQueryKey, actor, 'member-analysis', filter],
    queryFn: ({ signal }) => getMemberAnalysis(filter, signal),
    refetchInterval: (q) =>
      ['pending', 'running'].includes(q.state.data?.status ?? '')
        ? 2000
        : false,
  })
  const start = useMutation({
    mutationFn: startMemberAnalysis,
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: [...registrationQueryKey, actor, 'member-analysis'],
      })
    },
  })
  const running =
    start.isPending || ['pending', 'running'].includes(query.data?.status ?? '')
  const columns = useMemberAnalysisColumns({
    onSelect: setSelected,
    onReview: setReview,
  })
  const { table } = useDataTable({
    data: query.data?.items ?? emptyAccounts,
    columns,
    getRowId: (row) => String(row.member.id),
    manualPagination: true,
    manualFiltering: true,
    enableSorting: false,
    enableRowSelection: false,
    columnFilters: [],
    totalCount: query.data?.total ?? 0,
    pagination: { pageIndex: filter.page - 1, pageSize: filter.page_size },
    onPaginationChange: (update) => {
      setFilter((previous) => {
        const old = {
          pageIndex: previous.page - 1,
          pageSize: previous.page_size,
        }
        const next = typeof update === 'function' ? update(old) : update
        return {
          ...previous,
          page: next.pageSize === previous.page_size ? next.pageIndex + 1 : 1,
          page_size: next.pageSize,
        }
      })
    },
    globalFilter: filter.search,
    onGlobalFilterChange: (update) => {
      setFilter((previous) => ({
        ...previous,
        page: 1,
        search: typeof update === 'function' ? update(previous.search) : update,
      }))
    },
    columnVisibilityStorageKey: 'member-analysis:column-visibility',
  })
  const summary = query.data?.summary
  return (
    <div className='min-w-0 space-y-4'>
      <div className='console-surface bg-card min-w-0 space-y-4 rounded-xl border p-5'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <h2 className='font-semibold'>{t('Existing-member analysis')}</h2>
          <Button
            disabled={running || query.isPending || query.isError}
            onClick={() => start.mutate()}
          >
            {running ? t('Analysis in progress') : t('Analyze all members')}
          </Button>
        </div>
        <p className='text-muted-foreground text-sm'>
          {t(
            'One account per row. Suspicious invitation rewards stay held until administrator approval. Shared IP or UA alone does not prove the same person.'
          )}
        </p>
        {running && (
          <p role='status'>
            {t(
              'Analysis in progress. Previous completed results remain visible.'
            )}
          </p>
        )}
        {query.data?.status === 'failed' && (
          <Alert variant='destructive'>
            <AlertDescription>
              {t('Member analysis failed. Previous results are retained.')}
            </AlertDescription>
          </Alert>
        )}
        {query.isPending && <LoadingState />}
        {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
        {summary && (
          <>
            <p className='text-muted-foreground text-xs'>
              {t('Members analyzed')}: {formatNumber(summary.total, locale)} ·{' '}
              {t('Last analysis')}:{' '}
              {new Date(summary.completed_at * 1000).toLocaleString(locale)}
            </p>
            <DataTablePage
              table={table}
              columns={columns}
              isFetching={query.isFetching}
              emptyTitle={t('No records found')}
              hideMobile
              fixedHeight={false}
              paginationInFooter={false}
              applyHeaderSize
              className='min-w-0'
              getColumnClassName={() => 'px-3 py-2'}
              pinnedColumns={[
                { columnId: 'id', side: 'left' },
                { columnId: 'actions', side: 'right' },
              ]}
              toolbarProps={{
                searchPlaceholder: t('Search members'),
                searchDebounceMs: 300,
                additionalSearch: (
                  <NativeSelect
                    aria-label={t('Analysis results')}
                    value={filter.kind}
                    onChange={(e) =>
                      setFilter((previous) => ({
                        ...previous,
                        page: 1,
                        kind: e.target.value,
                      }))
                    }
                  >
                    <NativeSelectOption value='review'>
                      {t('Evidence requires review')}
                    </NativeSelectOption>
                    <NativeSelectOption value='flagged'>
                      {t('Members with signals')}
                    </NativeSelectOption>
                    <NativeSelectOption value='insufficient'>
                      {t('Insufficient historical data')}
                    </NativeSelectOption>
                    <NativeSelectOption value='all'>
                      {t('All members')}
                    </NativeSelectOption>
                  </NativeSelect>
                ),
              }}
            />
          </>
        )}
        {query.data && !summary && !running && (
          <p>
            {t(
              'No completed analysis yet. Save your settings, then analyze all members.'
            )}
          </p>
        )}
      </div>
      <MemberPolicySection />
      {selected !== null && (
        <MemberDialog userId={selected} onClose={() => setSelected(null)} />
      )}
      {review && (
        <ReviewDialog
          value={review}
          onClose={() => setReview(null)}
          onReviewed={async () => {
            await client.invalidateQueries({
              queryKey: [...registrationQueryKey, actor, 'member-analysis'],
            })
          }}
        />
      )}
    </div>
  )
}
