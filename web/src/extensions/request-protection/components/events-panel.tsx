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
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTablePagination,
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { formatTimestamp } from '@/lib/format'

import { getEvents } from '../api'
import type { EventFilters, ProtectionEvent } from '../types'
import { ProtectionLabel } from './record-label'
import { ProtectionReviewDialog, type ReviewAction } from './review-dialog'

export function EventsPanel() {
  const { t } = useTranslation()
  const id = useId()
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<EventFilters>({
    user_id: '',
    token_id: '',
    decision: '',
    review: '',
  })
  const [applied, setApplied] = useState(filters)
  const [detail, setDetail] = useState<ProtectionEvent | null>(null)
  const [action, setAction] = useState<ReviewAction | null>(null)
  const query = useQuery({
    queryKey: ['request-protection', 'events', page, applied],
    queryFn: () => getEvents(page, applied),
  })
  const columns: StaticDataTableColumn<ProtectionEvent>[] = [
    {
      id: 'time',
      header: t('Time'),
      cell: (event) => formatTimestamp(event.created_at),
    },
    {
      id: 'user',
      header: t('User'),
      cell: (event) => (
        <span>
          {event.username || '—'}
          <br />#{event.user_id}
        </span>
      ),
    },
    {
      id: 'key',
      header: t('API Key'),
      cell: (event) => (
        <span>
          {event.token_name || '—'}
          <br />#{event.token_id}
        </span>
      ),
    },
    {
      id: 'category',
      header: t('Risk categories'),
      cell: (event) => (
        <span>
          {event.matches.some((hit) => hit.category)
            ? [
                ...new Set(
                  event.matches.map((hit) => hit.category).filter(Boolean)
                ),
              ].map((category) => (
                <span key={category} className='block'>
                  <ProtectionLabel value={category ?? ''} />
                </span>
              ))
            : '—'}
        </span>
      ),
    },
    {
      id: 'finding',
      header: t('Inspection result'),
      cell: (event) => (
        <ProtectionLabel value={event.finding || 'legacy_event'} />
      ),
    },
    {
      id: 'reason',
      header: t('Reason'),
      cell: (event) => (
        <span className='block max-w-64 whitespace-normal'>
          <ProtectionLabel
            value={event.reason || event.uninspected || 'legacy_event'}
          />
        </span>
      ),
    },
    {
      id: 'source',
      header: t('Source'),
      cell: (event) => (
        <span>
          {[...new Set(event.matches.map((hit) => hit.source))].map(
            (source) => (
              <span key={source} className='block'>
                <ProtectionLabel value={source} />
              </span>
            )
          )}
        </span>
      ),
    },
    { id: 'model', header: t('Model'), cell: (event) => event.model },
    {
      id: 'channel',
      header: t('Channel / Group'),
      cell: (event) => (
        <span>
          {event.channel_name || '—'}{' '}
          {event.channel_id > 0 && `#${event.channel_id}`}
          <br />
          {event.group}
        </span>
      ),
    },
    {
      id: 'decision',
      header: t('Decision'),
      cell: (event) => <ProtectionLabel value={event.decision} />,
    },
    {
      id: 'review',
      header: t('Review status'),
      cell: (event) => <ProtectionLabel value={event.review} />,
    },
    {
      id: 'forwarded',
      header: t('Forwarding'),
      cell: (event) => <ProtectionLabel value={event.upstream} />,
    },
    {
      id: 'actions',
      header: t('Actions'),
      cell: (event) => (
        <Button variant='outline' size='sm' onClick={() => setDetail(event)}>
          {t('View details')}
        </Button>
      ),
    },
  ]
  return (
    <div className='space-y-5'>
      <form
        className='grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-5'
        onSubmit={(event) => {
          event.preventDefault()
          setApplied({ ...filters })
          setPage(1)
        }}
      >
        {[
          { name: 'user_id', label: t('User ID') },
          { name: 'token_id', label: t('Key ID') },
        ].map((field) => (
          <div key={field.name} className='space-y-2'>
            <Label htmlFor={`${id}-${field.name}`}>{field.label}</Label>
            <Input
              id={`${id}-${field.name}`}
              type='number'
              min={1}
              step={1}
              value={filters[field.name as 'user_id' | 'token_id']}
              onChange={(event) =>
                setFilters({ ...filters, [field.name]: event.target.value })
              }
            />
          </div>
        ))}
        <div className='space-y-2'>
          <Label htmlFor={`${id}-decision`}>{t('Decision')}</Label>
          <NativeSelect
            id={`${id}-decision`}
            className='w-full'
            value={filters.decision}
            onChange={(event) =>
              setFilters({ ...filters, decision: event.target.value })
            }
          >
            <NativeSelectOption value=''>{t('All')}</NativeSelectOption>
            <NativeSelectOption value='observe'>
              {t('Record only')}
            </NativeSelectOption>
            <NativeSelectOption value='block'>{t('Block')}</NativeSelectOption>
            <NativeSelectOption value='hold'>
              {t('Safety hold pending review')}
            </NativeSelectOption>
          </NativeSelect>
        </div>
        <div className='space-y-2'>
          <Label htmlFor={`${id}-review`}>{t('Review status')}</Label>
          <NativeSelect
            id={`${id}-review`}
            className='w-full'
            value={filters.review}
            onChange={(event) =>
              setFilters({ ...filters, review: event.target.value })
            }
          >
            <NativeSelectOption value=''>{t('All')}</NativeSelectOption>
            <NativeSelectOption value='pending'>
              {t('Pending review')}
            </NativeSelectOption>
            <NativeSelectOption value='confirmed'>
              {t('Confirmed violation')}
            </NativeSelectOption>
            <NativeSelectOption value='false_positive'>
              {t('False positive')}
            </NativeSelectOption>
          </NativeSelect>
        </div>
        <Button type='submit'>{t('Filter')}</Button>
      </form>
      {query.isPending && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {query.data && (
        <>
          <StaticDataTable
            columns={columns}
            data={query.data.items}
            getRowKey={(event) => event.id}
            emptyContent={<EmptyState title={t('No protection events')} />}
          />
          <ProtectionPagination
            page={page}
            total={query.data.total}
            onChange={setPage}
          />
        </>
      )}
      {detail && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setDetail(null)
          }}
          title={t('Protection event details')}
          description={t(
            'Evidence excerpts are shown only when enabled at inspection time. Full request content is not stored.'
          )}
          footer={
            <>
              <Button
                variant='outline'
                onClick={() => {
                  setAction({ kind: 'hold', event: detail.id })
                  setDetail(null)
                }}
              >
                {t('Pause this user')}
              </Button>
              {detail.review === 'pending' && (
                <>
                  <Button
                    variant='outline'
                    onClick={() => {
                      setAction({
                        kind: 'review',
                        event: detail.id,
                        verdict: 'false_positive',
                      })
                      setDetail(null)
                    }}
                  >
                    {t('Mark false positive')}
                  </Button>
                  <Button
                    onClick={() => {
                      setAction({
                        kind: 'review',
                        event: detail.id,
                        verdict: 'confirmed',
                      })
                      setDetail(null)
                    }}
                  >
                    {t('Confirm violation')}
                  </Button>
                </>
              )}
            </>
          }
        >
          <dl className='grid gap-3 text-sm break-words'>
            <div>
              <dt className='text-muted-foreground'>{t('Request ID')}</dt>
              <dd>{detail.request_id}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>{t('User / Key')}</dt>
              <dd>
                {detail.username} #{detail.user_id} / {detail.token_name} #
                {detail.token_id}
              </dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>{t('Model / Group')}</dt>
              <dd>
                {detail.model} / {detail.group} · {detail.protocol}
              </dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>{t('IP address')}</dt>
              <dd>{detail.ip || '—'}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>{t('Channel')}</dt>
              <dd>
                {detail.channel_name || '—'} #{detail.channel_id || '—'}
              </dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>
                {t('Inspection result')}
              </dt>
              <dd>
                <ProtectionLabel value={detail.finding || 'legacy_event'} /> ·{' '}
                <ProtectionLabel value={detail.reason || 'legacy_event'} />
              </dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>{t('Decision')}</dt>
              <dd>
                <ProtectionLabel value={detail.decision} /> ·{' '}
                <ProtectionLabel value={detail.review} /> ·{' '}
                <ProtectionLabel value={detail.upstream} />
              </dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>
                {t('Counted as a violation')}
              </dt>
              <dd>{detail.counted ? t('Yes') : t('No')}</dd>
            </div>
            {detail.uninspected && (
              <div>
                <dt className='text-muted-foreground'>
                  {t('Incomplete inspection')}
                </dt>
                <dd>
                  <ProtectionLabel value={detail.uninspected} />
                </dd>
              </div>
            )}
            <div>
              <dt className='text-muted-foreground'>{t('Policy revision')}</dt>
              <dd>{detail.revision}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>
                {t('Content fingerprint')}
              </dt>
              <dd className='font-mono text-xs break-all'>{detail.digest}</dd>
            </div>
          </dl>
          <div className='mt-5 space-y-3'>
            <h4 className='font-medium'>{t('Matched rules')}</h4>
            {detail.matches.length === 0 && <p>{t('No rules matched')}</p>}
            {detail.matches.map((hit) => (
              <div
                key={`${hit.rule_id}-${hit.source}`}
                className='space-y-1 rounded-lg border p-3 text-sm'
              >
                {hit.category && (
                  <p>
                    <ProtectionLabel value={hit.category} />
                  </p>
                )}
                {hit.evidence && (
                  <blockquote className='border-l-2 pl-3 break-words whitespace-pre-wrap'>
                    {hit.evidence}
                  </blockquote>
                )}
                <p className='font-medium break-words'>
                  {hit.name} ({hit.rule_id})
                </p>
                <p>
                  <ProtectionLabel value={hit.source} /> ·{' '}
                  <ProtectionLabel value={hit.action} />
                </p>
                <p>
                  {t('High-confidence rule')}:{' '}
                  {hit.high_confidence ? t('Yes') : t('No')} ·{' '}
                  {t('Count toward temporary restrictions')}:{' '}
                  {hit.count_penalty ? t('Yes') : t('No')}
                </p>
              </div>
            ))}
          </div>
        </Dialog>
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

export function ProtectionPagination(props: {
  page: number
  total: number
  onChange: (page: number) => void
}) {
  const pagination = { pageIndex: props.page - 1, pageSize: 20 }
  const table = useReactTable({
    data: [],
    columns: [],
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    rowCount: props.total,
    state: { pagination },
    onPaginationChange: (updater) => {
      const next = typeof updater === 'function' ? updater(pagination) : updater
      props.onChange(next.pageIndex + 1)
    },
  })
  return <DataTablePagination table={table} compact />
}
