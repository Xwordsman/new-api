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
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatTimestamp } from '@/lib/format'

import { getEvents } from '../api'
import type { EventFilters, ProtectionEvent } from '../types'
import { EventDetailsDialog } from './event-details-dialog'
import { ProtectionPagination } from './protection-pagination'
import { ProtectionLabel, SuspectedIntent } from './record-label'
import { RestrictionsPanel } from './restrictions-panel'
import { ProtectionReviewDialog, type ReviewAction } from './review-dialog'

export function EventsPanel() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const id = useId()
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<EventFilters>({
    user_id: '',
    token_id: '',
    decision: '',
    review: '',
    suspended: '',
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
      cell: (event) => (
        <span>
          {formatTimestamp(event.created_at)}
          <br />
          <span className='text-muted-foreground'>#{event.id}</span>
        </span>
      ),
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
    { id: 'ip', header: t('IP address'), cell: (event) => event.ip || '—' },
    {
      id: 'content',
      header: t('Request content'),
      cell: (event) => (
        <Button
          type='button'
          variant='ghost'
          className='h-auto w-64 justify-start p-0 text-start font-normal whitespace-normal'
          onClick={() => setDetail(event)}
        >
          <span className='line-clamp-2 break-all'>
            {event.preview || t('Content unavailable for this older event')}
          </span>
        </Button>
      ),
    },
    {
      id: 'intent',
      header: t('Suspected intent'),
      cell: (event) => (
        <div className='w-52 whitespace-normal'>
          <SuspectedIntent event={event} />
        </div>
      ),
    },
    {
      id: 'matches',
      header: t('Matched keywords'),
      cell: (event) => (
        <span className='line-clamp-2 w-48 break-all whitespace-normal'>
          {event.matches
            .map((hit) => hit.matched || hit.evidence || hit.name)
            .join(' · ') || '—'}
        </span>
      ),
    },
    {
      id: 'model',
      header: t('Model / Channel'),
      cell: (event) => (
        <span>
          {event.model}
          <br />
          <span className='text-muted-foreground'>
            {event.channel_name || t('Not forwarded')}{' '}
            {event.channel_id > 0 && `#${event.channel_id}`}
          </span>
        </span>
      ),
    },
    {
      id: 'decision',
      header: t('Inspection result'),
      cell: (event) => (
        <div className='space-y-1'>
          <Badge
            variant={event.decision === 'block' ? 'destructive' : 'secondary'}
          >
            <ProtectionLabel value={event.decision} />
          </Badge>
          <div className='text-muted-foreground text-xs'>
            <ProtectionLabel value={event.upstream} />
          </div>
          {(event.uninspected || event.finding === 'check_failed') && (
            <div className='text-muted-foreground w-48 text-xs whitespace-normal'>
              <ProtectionLabel
                value={event.uninspected || event.reason || event.finding}
              />
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'count',
      header: t('Recorded violations'),
      cell: (event) => formatNumber(event.violation_count || 0, locale),
    },
    {
      id: 'state',
      header: t('User status'),
      cell: (event) => (
        <Badge variant={event.restrictions?.length ? 'destructive' : 'outline'}>
          {event.restrictions?.length
            ? t('API access paused')
            : t('Not suspended')}
        </Badge>
      ),
    },
    {
      id: 'review',
      header: t('Review status'),
      cell: (event) => <ProtectionLabel value={event.review} />,
    },
    {
      id: 'actions',
      header: t('Actions'),
      cell: (event) => (
        <div className='flex gap-2'>
          <Button variant='outline' size='sm' onClick={() => setDetail(event)}>
            {t('View details')}
          </Button>
          {!event.restrictions?.length && (
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setAction({ kind: 'hold', event: event.id })}
            >
              {t('Pause this user')}
            </Button>
          )}
        </div>
      ),
    },
  ]
  return (
    <div className='space-y-5'>
      <form
        className='grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-6'
        onSubmit={(event) => {
          event.preventDefault()
          setApplied({ ...filters })
          setPage(1)
        }}
      >
        {(
          [
            { name: 'user_id', label: t('User ID') },
            { name: 'token_id', label: t('Key ID') },
          ] as const
        ).map((field) => (
          <div key={field.name} className='space-y-2'>
            <Label htmlFor={`${id}-${field.name}`}>{field.label}</Label>
            <Input
              id={`${id}-${field.name}`}
              type='number'
              min={1}
              step={1}
              value={filters[field.name]}
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
        <div className='space-y-2'>
          <Label htmlFor={`${id}-state`}>{t('User status')}</Label>
          <NativeSelect
            id={`${id}-state`}
            className='w-full'
            value={filters.suspended}
            onChange={(event) =>
              setFilters({ ...filters, suspended: event.target.value })
            }
          >
            <NativeSelectOption value=''>{t('All')}</NativeSelectOption>
            <NativeSelectOption value='true'>
              {t('API access paused')}
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
      <p className='text-muted-foreground text-sm'>
        {t(
          'Recorded violations count retained, deduplicated matches for this user. False positives are excluded. Only matching or failed inspections are logged.'
        )}
      </p>
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
