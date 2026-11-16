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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { toIntlLocale } from '@/i18n/languages'
import { useAuthStore } from '@/stores/auth-store'

import { registrationQueryKey } from '../api'
import type { MemberFilter, MemberProfile } from '../member-types'
import { getMembers } from '../members-api'
import { MemberDialog } from './member-dialog'

export function MemberDirectory() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const actor = useAuthStore((s) => s.auth.user?.id)
  const [filter, setFilter] = useState<MemberFilter>({
    page: 1,
    search: '',
    review_state: '',
  })
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const query = useQuery({
    queryKey: [...registrationQueryKey, actor, 'members', filter],
    queryFn: ({ signal }) => getMembers(filter, signal),
  })
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
      setFilter((current) => ({ ...current, page: next.pageIndex + 1 }))
    },
  })
  const date = (value: number) =>
    value ? new Date(value * 1000).toLocaleString(locale) : t('Not recorded')
  const reviewLabels = {
    watch: t('Needs attention'),
    cleared: t('Reviewed'),
    unreviewed: t('Not reviewed'),
  }
  const columns: StaticDataTableColumn<MemberProfile>[] = [
    {
      id: 'id',
      header: t('Member'),
      cell: (r) => (
        <div>
          <span className='font-medium'>{r.username}</span>
          <p className='text-muted-foreground text-xs'>ID: {r.id}</p>
          <p>{r.email || '—'}</p>
        </div>
      ),
    },
    {
      id: 'signup',
      header: t('Registration'),
      cell: (r) => (
        <div>
          <p>{date(r.created_at)}</p>
          <p>{r.registration_ip || t('Not recorded')}</p>
        </div>
      ),
    },
    {
      id: 'login',
      header: t('Last login'),
      cell: (r) => (
        <div>
          <p>{date(r.last_login_at)}</p>
          <p>{r.last_login_ip || t('Not recorded')}</p>
        </div>
      ),
    },
    {
      id: 'browser',
      header: t('Last login browser (User-Agent)'),
      cell: (r) => (
        <span className='block max-w-48 truncate' title={r.last_login_agent}>
          {r.last_login_agent || t('Not recorded')}
        </span>
      ),
    },
    {
      id: 'review',
      header: t('Member review status'),
      cell: (r) => (
        <Badge
          variant={r.review_state === 'watch' ? 'destructive' : 'secondary'}
        >
          {reviewLabels[r.review_state || 'unreviewed']}
        </Badge>
      ),
    },
    {
      id: 'note',
      header: t('Member review note'),
      cell: (r) => (
        <span className='block max-w-64 truncate' title={r.note}>
          {r.note || '—'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: t('Actions'),
      cell: (r) => (
        <Button variant='outline' size='sm' onClick={() => setSelected(r.id)}>
          {t('Details and review')}
        </Button>
      ),
    },
  ]
  return (
    <div className='console-surface bg-card space-y-4 rounded-xl border p-5'>
      <p className='text-muted-foreground text-sm'>
        {t(
          'All registered members are listed here. Registration attempts and promotional-credit decisions remain in Risk records and review. Historical IP and browser data may be unavailable.'
        )}
      </p>
      <form
        className='flex flex-wrap items-center gap-3'
        onSubmit={(event) => {
          event.preventDefault()
          setFilter((f) => ({ ...f, page: 1, search: search.trim() }))
        }}
      >
        <Input
          className='w-full sm:w-80'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          maxLength={254}
          aria-label={t('Search members')}
          placeholder={t('ID, username, email or IP')}
        />
        <Button type='submit' variant='outline'>
          {t('Search')}
        </Button>
        <NativeSelect
          aria-label={t('Member review status')}
          value={filter.review_state}
          onChange={(e) =>
            setFilter((f) => ({ ...f, page: 1, review_state: e.target.value }))
          }
        >
          <NativeSelectOption value=''>{t('All statuses')}</NativeSelectOption>
          <NativeSelectOption value='unreviewed'>
            {t('Not reviewed')}
          </NativeSelectOption>
          <NativeSelectOption value='watch'>
            {t('Needs attention')}
          </NativeSelectOption>
          <NativeSelectOption value='cleared'>
            {t('Reviewed')}
          </NativeSelectOption>
        </NativeSelect>
        <Button
          type='button'
          variant='outline'
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t('Refresh')}
        </Button>
      </form>
      {query.isPending && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {query.data && (
        <>
          <StaticDataTable
            data={query.data.items}
            columns={columns}
            getRowKey={(r) => r.id}
            emptyContent={t('No records found')}
          />
          <DataTablePagination table={table} compact />
        </>
      )}
      {selected !== null && (
        <MemberDialog userId={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
