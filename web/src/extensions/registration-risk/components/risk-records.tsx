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
import { useSystemConfig } from '@/hooks/use-system-config'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { useAuthStore } from '@/stores/auth-store'

import { getRecords, registrationQueryKey } from '../api'
import type { RecordFilter, RecordKind, RiskRecord } from '../types'
import { CreditReviewDialog } from './review-dialog'

export function RiskRecords() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  useSystemConfig()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const [filter, setFilter] = useState<RecordFilter>({
    kind: 'events',
    page: 1,
    user_id: '',
    state: '',
    source: '',
  })
  const [review, setReview] = useState<{
    userId: number
    approve: boolean
  } | null>(null)
  const query = useQuery({
    queryKey: [...registrationQueryKey, userId, 'records', filter],
    queryFn: ({ signal }) => getRecords(filter, signal),
    enabled: !!userId,
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
  const date = (value?: number) =>
    value ? new Date(value * 1000).toLocaleString(locale) : '—'
  const labels: Record<string, string> = {
    allow: t('Allowed'),
    observe: t('Observe only'),
    review: t('Pending review'),
    deny: t('Denied'),
    active: t('Active'),
    rejected: t('Rejected'),
    expired: t('Expired'),
    email: t('Email'),
    register: t('Registration'),
    verify: t('Verification code'),
    payment: t('Payment'),
    'email-domain': t('Restricted email domain'),
    'email-attempt-review': t('Email request requires review'),
    'unverified-provider-email': t('Unverified provider email'),
    'invalid-email-challenge': t('Invalid or expired verification code'),
    'shared-trusted-payer': t('Shared verified payment account'),
    'email-hour': t('Email request frequency'),
    'mail-ip': t('IP email request frequency'),
    'device-day': t('Browser signup frequency'),
    'network-hour': t('Network signup frequency'),
    'inviter-day': t('Inviter signup frequency'),
    'global-mail': t('Site email request frequency'),
    settings: t('Policy settings updated'),
    'grant-active': t('Promotional credit approved'),
    'grant-rejected': t('Promotional credit rejected'),
  }
  const columns: StaticDataTableColumn<RiskRecord>[] = [
    { id: 'time', header: t('Time'), cell: (row) => date(row.created_at) },
    { id: 'user', header: t('User ID'), cell: (row) => row.user_id || '—' },
  ]
  if (filter.kind === 'events') {
    columns.push(
      {
        id: 'source',
        header: t('Source'),
        cell: (row) => (
          <span>
            {labels[row.stage ?? ''] ?? row.stage} / {row.source || '—'}
            <br />
            {row.domain}
          </span>
        ),
      },
      {
        id: 'action',
        header: t('Decision'),
        cell: (row) => (
          <span className='space-y-1'>
            <Badge variant={row.enforced ? 'destructive' : 'secondary'}>
              {labels[row.action ?? ''] ?? row.action}
            </Badge>
            <span className='block text-xs'>
              {row.enforced ? t('Enforced') : t('Recorded only')}
            </span>
          </span>
        ),
      },
      {
        id: 'reason',
        header: t('Risk signals'),
        cell: (row) => (
          <span className='block max-w-64 break-words whitespace-normal'>
            {row.reasons
              ?.split('; ')
              .map(
                (reason) => labels[reason] ?? t('Rule: {{id}}', { id: reason })
              )
              .join('; ') || '—'}
            <br />
            {t('Policy revision')}: {row.revision}
          </span>
        ),
      },
      {
        id: 'related',
        header: t('Related attempts'),
        cell: (row) => (
          <div className='flex flex-wrap gap-1'>
            {(
              [
                ['device_hash', t('Same browser')],
                ['network_hash', t('Same network')],
                ['email_hash', t('Same email')],
              ] as const
            ).map(
              ([key, label]) =>
                row[key] && (
                  <Button
                    key={key}
                    size='sm'
                    variant='outline'
                    onClick={() =>
                      setFilter({
                        kind: 'events',
                        page: 1,
                        user_id: '',
                        state: '',
                        source: '',
                        [key]: row[key],
                      })
                    }
                  >
                    {label}
                  </Button>
                )
            )}
          </div>
        ),
      }
    )
  } else if (filter.kind === 'grants' || filter.kind === 'accounts') {
    columns.push({
      id: 'state',
      header: t('Status'),
      cell: (row) => labels[row.state ?? ''] ?? row.state,
    })
    if (filter.kind === 'grants') {
      columns.push(
        {
          id: 'amount',
          header: t('Remaining / total'),
          cell: (row) =>
            `${formatQuotaWithCurrency(row.remaining ?? 0, { locale })} / ${formatQuotaWithCurrency(row.total ?? 0, { locale })}`,
        },
        {
          id: 'expires',
          header: t('Expires at'),
          cell: (row) => date(row.expires_at),
        },
        {
          id: 'reason',
          header: t('Review reason'),
          cell: (row) => (row.reason ? t(row.reason) : '—'),
        }
      )
    }
    if (filter.kind === 'accounts') {
      columns.push({
        id: 'inviter',
        header: t('Inviter ID'),
        cell: (row) => row.inviter_id || '—',
      })
    }
    columns.push({
      id: 'review',
      header: t('Actions'),
      cell: (row) => {
        const reviewUserId = row.user_id
        if (row.state !== 'review' || !reviewUserId) return null
        return (
          <div className='flex gap-2'>
            <Button
              size='sm'
              variant='outline'
              onClick={() => setReview({ userId: reviewUserId, approve: true })}
            >
              {t('Approve')}
            </Button>
            <Button
              size='sm'
              variant='destructive'
              onClick={() =>
                setReview({ userId: reviewUserId, approve: false })
              }
            >
              {t('Reject')}
            </Button>
          </div>
        )
      },
    })
  } else if (filter.kind === 'alerts') {
    columns.splice(1, 1)
    columns.push(
      {
        id: 'summary',
        header: t('Alert'),
        cell: (row) => (
          <span className='block max-w-96 break-words whitespace-normal'>
            {row.summary_key
              ? t(row.summary_key, row.summary_params)
              : row.summary}
          </span>
        ),
      },
      {
        id: 'delivery',
        header: t('Delivery'),
        cell: (row) =>
          row.delivered_at ? (
            date(row.delivered_at)
          ) : (
            <span>
              {t('Pending delivery')}
              <br />
              {row.last_error ? t(row.last_error) : ''}
            </span>
          ),
      },
      {
        id: 'retry',
        header: t('Next attempt'),
        cell: (row) => (row.delivered_at ? '—' : date(row.next_attempt_at)),
      }
    )
  } else {
    columns.push(
      { id: 'actor', header: t('Administrator'), cell: (row) => row.actor_id },
      {
        id: 'action',
        header: t('Action'),
        cell: (row) => labels[row.action ?? ''] ?? row.action,
      },
      {
        id: 'reason',
        header: t('Review reason'),
        cell: (row) =>
          row.reason?.startsWith('Policy revision ')
            ? t('Policy revision {{revision}}', {
                revision: row.reason.slice(16),
              })
            : row.reason,
      }
    )
  }
  const kinds: [RecordKind, string][] = [
    ['events', t('Risk events')],
    ['accounts', t('Signup qualifications')],
    ['grants', t('Promotional credits')],
    ['alerts', t('Alerts')],
    ['audit', t('Audit records')],
  ]
  return (
    <div className='space-y-4'>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Browser and network matches are weak signals. Review the context before rejecting rewards. Related-attempt filters use keyed digests without exposing raw IP addresses.'
        )}
      </p>
      <div className='flex flex-wrap items-center gap-3'>
        <NativeSelect
          aria-label={t('Record type')}
          value={filter.kind}
          onChange={(event) =>
            setFilter({
              kind: event.target.value as RecordKind,
              page: 1,
              user_id: '',
              state: '',
              source: '',
            })
          }
        >
          {kinds.map(([value, label]) => (
            <NativeSelectOption value={value} key={value}>
              {label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {filter.kind !== 'alerts' && (
          <Input
            className='w-36'
            aria-label={t('User ID')}
            placeholder={t('User ID')}
            type='number'
            min={1}
            value={filter.user_id}
            onChange={(event) =>
              setFilter((current) => ({
                ...current,
                user_id: event.target.value,
                page: 1,
              }))
            }
          />
        )}
        {['events', 'accounts', 'grants'].includes(filter.kind) && (
          <NativeSelect
            aria-label={t('Status')}
            value={filter.state}
            onChange={(event) =>
              setFilter((current) => ({
                ...current,
                state: event.target.value,
                page: 1,
              }))
            }
          >
            <NativeSelectOption value=''>
              {t('All statuses')}
            </NativeSelectOption>
            {(filter.kind === 'events'
              ? ['allow', 'observe', 'review', 'deny']
              : ['active', 'review', 'rejected']
            ).map((state) => (
              <NativeSelectOption key={state} value={state}>
                {labels[state]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
        {filter.kind === 'events' && (
          <Input
            className='w-40'
            aria-label={t('Source')}
            placeholder={t('Source')}
            value={filter.source}
            onChange={(event) =>
              setFilter((current) => ({
                ...current,
                source: event.target.value,
                page: 1,
              }))
            }
          />
        )}
        {(filter.device_hash || filter.network_hash || filter.email_hash) && (
          <Button
            variant='outline'
            onClick={() =>
              setFilter((current) => ({
                ...current,
                page: 1,
                device_hash: undefined,
                network_hash: undefined,
                email_hash: undefined,
              }))
            }
          >
            {t('Clear related filter')}
          </Button>
        )}
        <Button
          variant='outline'
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          {t('Refresh')}
        </Button>
      </div>
      {query.isPending && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {query.data && (
        <>
          <StaticDataTable
            columns={columns}
            data={query.data.items}
            getRowKey={(row) => row.id ?? row.user_id ?? 0}
            emptyContent={t('No records found')}
          />
          <DataTablePagination table={table} compact />
        </>
      )}
      {review && (
        <CreditReviewDialog
          key={review.userId}
          {...review}
          onClose={() => setReview(null)}
        />
      )}
    </div>
  )
}
