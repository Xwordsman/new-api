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
import type { ColumnDef } from '@tanstack/react-table'
import { Eye, UserRoundX } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTableRowActionMenu, TruncatedCell } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatTimestamp } from '@/lib/format'

import type { ProtectionEvent } from '../types'
import {
  InspectionCoverage,
  ProtectionLabel,
  SuspectedIntent,
} from './record-label'
import type { ReviewAction } from './review-dialog'

export function useEventColumns(props: {
  onDetails: (event: ProtectionEvent) => void
  onAction: (action: ReviewAction) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { onDetails, onAction } = props
  return useMemo<ColumnDef<ProtectionEvent>[]>(
    () => [
      {
        accessorKey: 'created_at',
        header: t('Time'),
        size: 164,
        cell: ({ row }) => (
          <span className='text-muted-foreground tabular-nums'>
            {formatTimestamp(row.original.created_at)}
          </span>
        ),
      },
      {
        accessorKey: 'username',
        header: t('User'),
        size: 156,
        cell: ({ row }) => (
          <TruncatedCell
            className='max-w-36'
            tooltipContent={`${row.original.username || '—'} #${row.original.user_id}`}
          >
            <span className='font-medium'>{row.original.username || '—'}</span>
            <span className='text-muted-foreground ms-1.5'>
              #{row.original.user_id}
            </span>
          </TruncatedCell>
        ),
      },
      {
        accessorKey: 'ip',
        header: t('IP address'),
        size: 136,
        cell: ({ row }) => (
          <TruncatedCell className='max-w-32 font-mono text-xs'>
            {row.original.ip || '—'}
          </TruncatedCell>
        ),
      },
      {
        accessorKey: 'preview',
        header: t('Request content'),
        size: 252,
        cell: ({ row }) => (
          <Button
            type='button'
            variant='link'
            className='text-foreground h-auto max-w-60 justify-start p-0 text-start font-normal'
            onClick={() => onDetails(row.original)}
          >
            <TruncatedCell className='max-w-60'>
              {row.original.preview ||
                t('Content unavailable for this older event')}
            </TruncatedCell>
          </Button>
        ),
      },
      {
        id: 'matches',
        accessorFn: (event) =>
          event.matches
            .map((hit) => hit.matched || hit.evidence || hit.name)
            .join(' · '),
        header: t('Matched keywords'),
        size: 156,
        cell: ({ getValue }) => (
          <TruncatedCell className='max-w-36 font-mono text-xs'>
            {String(getValue() || '—')}
          </TruncatedCell>
        ),
      },
      {
        id: 'intent',
        accessorKey: 'reason',
        header: t('Suspected intent'),
        size: 200,
        cell: ({ row }) => (
          <TruncatedCell
            className='max-w-48'
            tooltipContent={<SuspectedIntent event={row.original} />}
          >
            <SuspectedIntent event={row.original} />
          </TruncatedCell>
        ),
      },
      {
        accessorKey: 'model',
        header: t('Model / Channel'),
        size: 176,
        cell: ({ row }) => (
          <div className='max-w-40 space-y-0.5'>
            <TruncatedCell className='font-mono text-xs'>
              {row.original.model || '—'}
            </TruncatedCell>
            <TruncatedCell className='text-muted-foreground text-xs'>
              {row.original.channel_id > 0
                ? `${row.original.channel_name || '—'} #${row.original.channel_id}`
                : t('Not forwarded')}
            </TruncatedCell>
          </div>
        ),
      },
      {
        accessorKey: 'decision',
        header: t('Inspection result'),
        size: 220,
        cell: ({ row }) => (
          <div className='max-w-52 space-y-1'>
            <Badge
              variant={
                row.original.decision === 'block' ? 'destructive' : 'secondary'
              }
            >
              <ProtectionLabel value={row.original.decision} />
            </Badge>
            <TruncatedCell
              className='text-muted-foreground text-xs'
              tooltipContent={
                <>
                  <ProtectionLabel value={row.original.upstream} />
                  {(row.original.uninspected ||
                    row.original.finding === 'check_failed') && (
                    <>
                      {' '}
                      · <InspectionCoverage event={row.original} />
                    </>
                  )}
                </>
              }
            >
              <ProtectionLabel value={row.original.upstream} />
              {(row.original.uninspected ||
                row.original.finding === 'check_failed') && (
                <>
                  {' '}
                  · <InspectionCoverage event={row.original} />
                </>
              )}
            </TruncatedCell>
          </div>
        ),
      },
      {
        accessorKey: 'violation_count',
        header: t('Recorded violations'),
        size: 92,
        cell: ({ row }) => (
          <span className='tabular-nums'>
            {formatNumber(row.original.violation_count || 0, locale)}
          </span>
        ),
      },
      {
        id: 'state',
        accessorFn: (event) => Boolean(event.restrictions?.length),
        header: t('User status'),
        size: 128,
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.restrictions?.length ? 'destructive' : 'outline'
            }
          >
            {row.original.restrictions?.length
              ? t('API access paused')
              : t('Not suspended')}
          </Badge>
        ),
      },
      {
        accessorKey: 'review',
        header: t('Review status'),
        size: 124,
        cell: ({ row }) => <ProtectionLabel value={row.original.review} />,
      },
      {
        accessorKey: 'token_name',
        header: t('API Key'),
        size: 160,
        cell: ({ row }) => (
          <TruncatedCell className='max-w-36'>
            {`${row.original.token_name || '—'} #${row.original.token_id}`}
          </TruncatedCell>
        ),
      },
      { accessorKey: 'group', header: t('Group'), size: 120 },
      {
        id: 'actions',
        header: t('Actions'),
        enableHiding: false,
        size: 84,
        cell: ({ row }) => (
          <div className='flex items-center justify-end gap-1'>
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label={t('View details')}
              onClick={() => onDetails(row.original)}
            >
              <Eye aria-hidden='true' />
            </Button>
            {!row.original.restrictions?.length && (
              <DataTableRowActionMenu ariaLabel={t('Actions')}>
                <DropdownMenuItem
                  onClick={() =>
                    onAction({ kind: 'hold', event: row.original.id })
                  }
                >
                  <UserRoundX aria-hidden='true' />
                  {t('Pause this user')}
                </DropdownMenuItem>
              </DataTableRowActionMenu>
            )}
          </div>
        ),
      },
    ],
    [t, locale, onDetails, onAction]
  )
}
