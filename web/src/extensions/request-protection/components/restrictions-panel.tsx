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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { formatTimestamp } from '@/lib/format'

import { getAudit, getRestrictions } from '../api'
import type { ProtectionAudit, ProtectionRestriction } from '../types'
import { ProtectionPagination } from './events-panel'
import { ProtectionLabel } from './record-label'
import { ProtectionReviewDialog } from './review-dialog'

export function RestrictionsPanel() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [subject, setSubject] = useState<string | null>(null)
  const query = useQuery({
    queryKey: ['request-protection', 'restrictions', page],
    queryFn: () => getRestrictions(page),
    refetchInterval: 60000,
  })
  const columns: StaticDataTableColumn<ProtectionRestriction>[] = [
    { id: 'subject', header: t('Restricted subject'), cell: (row) => row.id },
    { id: 'user', header: t('User ID'), cell: (row) => row.user_id },
    { id: 'key', header: t('Key ID'), cell: (row) => row.token_id || '—' },
    {
      id: 'time',
      header: t('Restricted until'),
      cell: (row) => formatTimestamp(row.until),
    },
    {
      id: 'cause',
      header: t('Trigger event'),
      cell: (row) => row.cause_event_id,
    },
    {
      id: 'action',
      header: t('Actions'),
      cell: (row) => (
        <Button variant='outline' size='sm' onClick={() => setSubject(row.id)}>
          {t('Release restriction')}
        </Button>
      ),
    },
  ]
  return (
    <div className='space-y-5'>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Restrictions expire automatically. Manual release resets only the selected plugin restriction; an account restriction can still block its Keys.'
        )}
      </p>
      {query.isPending && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {query.data && (
        <>
          <StaticDataTable
            columns={columns}
            data={query.data.items}
            getRowKey={(row) => row.id}
            emptyContent={<EmptyState title={t('No active restrictions')} />}
          />
          <ProtectionPagination
            page={page}
            total={query.data.total}
            onChange={setPage}
          />
        </>
      )}
      {subject && (
        <ProtectionReviewDialog
          action={{ kind: 'release', subject }}
          onClose={() => setSubject(null)}
        />
      )}
    </div>
  )
}

export function AuditPanel() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ['request-protection', 'audit', page],
    queryFn: () => getAudit(page),
  })
  const columns: StaticDataTableColumn<ProtectionAudit>[] = [
    {
      id: 'time',
      header: t('Time'),
      cell: (row) => formatTimestamp(row.created_at),
    },
    {
      id: 'actor',
      header: t('Operator ID'),
      cell: (row) => row.actor_id || '—',
    },
    {
      id: 'action',
      header: t('Action'),
      cell: (row) => <ProtectionLabel value={row.action} />,
    },
    {
      id: 'subject',
      header: t('Restricted subject'),
      cell: (row) => row.subject_id || '—',
    },
    {
      id: 'event',
      header: t('Trigger event'),
      cell: (row) => row.event_id || '—',
    },
    {
      id: 'revision',
      header: t('Policy revision'),
      cell: (row) => row.revision || '—',
    },
    {
      id: 'note',
      header: t('Review reason'),
      cell: (row) => (
        <span className='block max-w-72 break-words whitespace-pre-wrap'>
          {row.note || '—'}
        </span>
      ),
    },
  ]
  return (
    <div className='space-y-5'>
      {query.isPending && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {query.data && (
        <>
          <StaticDataTable
            columns={columns}
            data={query.data.items}
            getRowKey={(row) => row.id}
            emptyContent={
              <EmptyState title={t('No protection audit records')} />
            }
          />
          <ProtectionPagination
            page={page}
            total={query.data.total}
            onChange={setPage}
          />
        </>
      )}
    </div>
  )
}
