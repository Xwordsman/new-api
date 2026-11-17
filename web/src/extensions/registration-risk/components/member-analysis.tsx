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
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTablePagination,
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { registrationQueryKey } from '../api'
import type { MemberFinding } from '../member-types'
import { getMemberAnalysis, startMemberAnalysis } from '../members-api'
import { MemberDialog } from './member-dialog'
import { MemberPolicySection } from './member-policy-form'

export function MemberAnalysis() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const actor = useAuthStore((s) => s.auth.user?.id)
  const client = useQueryClient()
  const [filter, setFilter] = useState({ page: 1, kind: 'review' })
  const [selected, setSelected] = useState<number | null>(null)
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
  const table = useReactTable({
    data: query.data?.items ?? [],
    columns: [],
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    rowCount: query.data?.total ?? 0,
    state: { pagination: { pageIndex: filter.page - 1, pageSize: 20 } },
    onPaginationChange: (update) => {
      const next =
        typeof update === 'function'
          ? update({ pageIndex: filter.page - 1, pageSize: 20 })
          : update
      setFilter((f) => ({ ...f, page: next.pageIndex + 1 }))
    },
  })
  const signals: Record<string, string> = {
    device: t('Shared browser marker'),
    'signup-ip': t('Same registration IP'),
    'login-ip': t('Same last login IP'),
    network: t('Same network'),
    inviter: t('Same inviter'),
    payer: t('Shared verified payment account'),
    domain: t('Restricted email domain'),
    qualification: t('Signup qualification pending review'),
    'invite-burst': t('Concentrated invitation registrations'),
  }
  const priorities: Record<number, string> = {
    0: t('No signals in available data'),
    1: t('Network clue only'),
    2: t('Evidence requires review'),
    3: t('Reward review priority'),
  }
  const columns: StaticDataTableColumn<MemberFinding>[] = [
    {
      id: 'member',
      header: t('Member'),
      cell: (r) => (
        <div>
          {r.username}
          <p className='text-muted-foreground text-xs'>ID: {r.user_id}</p>
        </div>
      ),
    },
    {
      id: 'priority',
      header: t('Review priority'),
      cell: (r) => (
        <div className='max-w-64 space-y-2 whitespace-normal'>
          <Badge variant={r.priority >= 3 ? 'destructive' : 'secondary'}>
            {priorities[r.priority] ?? priorities[0]}
          </Badge>
          <p className='text-muted-foreground text-xs'>
            {r.priority >= 2
              ? t(
                  'Verify the related accounts and invitation rewards before approval.'
                )
              : t('Shared networks alone do not prove duplicate accounts.')}
          </p>
        </div>
      ),
    },
    {
      id: 'rewards',
      header: t('Related invitation bonuses'),
      cell: (r) => (
        <div className='space-y-1 text-xs'>
          <p>
            {t('Automatically issued')}:{' '}
            {formatQuotaWithCurrency(r.reward_paid, {
              locale,
              abbreviate: false,
            })}
          </p>
          <p>
            {t('Pending')}:{' '}
            {formatQuotaWithCurrency(r.reward_pending, {
              locale,
              abbreviate: false,
            })}
          </p>
        </div>
      ),
    },
    {
      id: 'signals',
      header: t('Association signals'),
      cell: (r) => (
        <div className='max-w-xl space-y-3 whitespace-normal'>
          {r.signals.length === 0 && t('No signals in available data')}
          {r.signals.map((s) => (
            <div key={s.code}>
              <p className='font-medium'>{signals[s.code] ?? s.code}</p>
              {s.threshold > 0 && (
                <p className='text-muted-foreground text-xs'>
                  {t('Matched {{count}} accounts; threshold {{threshold}}', {
                    count: formatNumber(s.count, locale),
                    threshold: formatNumber(s.threshold, locale),
                  })}
                </p>
              )}
              {s.related_ids.length > 0 && (
                <div className='mt-1 flex flex-wrap gap-1'>
                  <span className='text-xs'>
                    {t('Related members (up to 10)')}:
                  </span>
                  {s.related_ids.map((id) => (
                    <Button
                      key={id}
                      size='sm'
                      variant='outline'
                      onClick={() => setSelected(id)}
                    >
                      #{id}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ),
    },
    {
      id: 'coverage',
      header: t('Data coverage'),
      cell: (r) => (
        <Badge variant='secondary'>
          {r.coverage === 'unavailable'
            ? t('Insufficient historical data')
            : t('Partial data')}
        </Badge>
      ),
    },
    {
      id: 'review',
      header: t('Member review note'),
      cell: (r) => (
        <div className='max-w-64 break-words whitespace-normal'>
          {r.review_state === 'watch' && (
            <Badge variant='destructive'>{t('Needs attention')}</Badge>
          )}
          {r.review_state === 'cleared' && (
            <Badge variant='secondary'>{t('Reviewed')}</Badge>
          )}
          <p>{r.note || '—'}</p>
        </div>
      ),
    },
    {
      id: 'actions',
      header: t('Actions'),
      cell: (r) => (
        <Button
          size='sm'
          variant='outline'
          onClick={() => setSelected(r.user_id)}
        >
          {t('Details and review')}
        </Button>
      ),
    },
  ]
  const summary = query.data?.summary
  return (
    <div className='space-y-4'>
      <MemberPolicySection />
      <div className='console-surface bg-card space-y-4 rounded-xl border p-5'>
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
            'Association signals are investigation clues, not proof of abuse. Shared networks can belong to families or workplaces. No accounts are automatically banned and rewards are not changed.'
          )}
        </p>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Related bonuses include invitations sent or received by this member. Amounts overlap across members and exclude manual gifts. Multiple IP clues do not increase priority.'
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
            <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
              {[
                [t('Members analyzed'), summary.total],
                [t('Evidence requires review'), summary.review],
                [t('Reward review priority'), summary.priority],
                [t('Insufficient historical data'), summary.insufficient],
              ].map(([label, value]) => (
                <div key={label} className='bg-muted/40 rounded-lg p-4'>
                  <p className='text-muted-foreground text-sm'>{label}</p>
                  <p className='mt-1 text-2xl font-semibold'>
                    {formatNumber(Number(value), locale)}
                  </p>
                </div>
              ))}
            </div>
            <p className='text-muted-foreground text-xs'>
              {t('Last analysis')}:{' '}
              {new Date(summary.completed_at * 1000).toLocaleString(locale)} ·{' '}
              {t('Policy revision')}:{' '}
              {formatNumber(summary.policy.revision, locale)} ·{' '}
              {t('Association lookback (days)')}:{' '}
              {formatNumber(summary.policy.lookback_days, locale)}
            </p>
            <NativeSelect
              aria-label={t('Analysis results')}
              value={filter.kind}
              onChange={(e) => setFilter({ page: 1, kind: e.target.value })}
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
            <StaticDataTable
              data={query.data?.items ?? []}
              columns={columns}
              getRowKey={(r) => r.user_id}
              emptyContent={t('No records found')}
            />
            <DataTablePagination table={table} compact />
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
      {selected !== null && (
        <MemberDialog userId={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
