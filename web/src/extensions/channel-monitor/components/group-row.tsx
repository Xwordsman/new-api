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
import { ChevronDown, ChevronUp, Layers, Tag } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TableCell, TableRow } from '@/components/ui/table'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { getLobeIcon } from '@/lib/lobe-icon'
import { resolveModelProvider } from '@/lib/model-provider'
import { cn } from '@/lib/utils'

import type { MonitorGroup } from '../types'
import { GroupDetails } from './group-details'
import { GroupRatio } from './group-ratio'
import { HistoryStrip } from './history-strip'
import { MonitorStatusBadge } from './monitor-status'

export function GroupRow(props: {
  group: MonitorGroup
  search: string
  updatedAt: number
  receivedAt?: number
}) {
  const { t, i18n } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  const group = props.group
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const discounted = group.offer.active && group.ratio < group.base_ratio
  const enabledModels = group.models.filter((model) => model.enabled)
  const providers = enabledModels.map((model) =>
    resolveModelProvider(model.model)
  )
  const provider = providers[0]
  const inferredIcon =
    provider && providers.every((item) => item?.icon === provider.icon)
      ? provider.icon
      : undefined
  const icon = group.icon || inferredIcon
  return (
    <>
      <TableRow
        className={cn(
          'h-16.5 cursor-pointer',
          expanded &&
            'bg-(--table-row-hover) shadow-[inset_2px_0_0_var(--primary)]'
        )}
        onClick={(event) => {
          const target = event.target
          if (
            !(target instanceof Element) ||
            !event.currentTarget.contains(target)
          ) {
            return
          }
          if (target.closest('button, a, input, select, [role="button"]')) {
            return
          }
          setExpanded((value) => !value)
        }}
      >
        <TableCell className='py-3 pl-4.5'>
          <div className='flex min-w-0 items-center gap-2.5'>
            <span
              role='img'
              aria-label={icon?.split('.')[0] || t('Group icon')}
              className='bg-background flex size-10 shrink-0 items-center justify-center rounded-[calc(var(--radius)*0.4)] border shadow-xs'
            >
              <span aria-hidden>
                {icon ? (
                  getLobeIcon(icon, 24)
                ) : (
                  <Layers className='text-muted-foreground size-5' />
                )}
              </span>
            </span>
            <div className='min-w-0'>
              <div className='flex items-center gap-2'>
                <Button
                  variant='link'
                  className='text-foreground h-auto min-w-0 shrink justify-start p-0 text-left text-base font-semibold'
                  title={group.display_name || group.group}
                  aria-label={t('Details for {{group}}', {
                    group: group.display_name || group.group,
                  })}
                  aria-expanded={expanded}
                  aria-controls={id}
                  onClick={() => setExpanded((value) => !value)}
                >
                  <span className='truncate'>
                    {group.display_name || group.group}
                  </span>
                </Button>
                {(group.badge || (discounted && group.offer.label)) && (
                  <Badge
                    variant='outline'
                    className='border-primary/25 bg-primary/5 text-primary max-w-24 shrink-0 truncate rounded-[calc(var(--radius)*0.2)] px-1.5 py-0.5 text-xs leading-4 font-normal'
                  >
                    <Tag className='mr-1 size-3' aria-hidden />
                    {group.badge || group.offer.label}
                  </Badge>
                )}
              </div>
              <p
                className='text-muted-foreground mt-1 truncate text-[13px]'
                title={group.description || group.group}
              >
                {group.group} ·{' '}
                {t('{{count}} enabled models', { count: enabledModels.length })}{' '}
                · {t('Real requests')}
              </p>
            </div>
          </div>
        </TableCell>
        <TableCell>
          <GroupRatio group={group} receivedAt={props.receivedAt} />
        </TableCell>
        <TableCell>
          <MonitorStatusBadge status={group.status} />
        </TableCell>
        <TableCell>
          <div className='flex w-full flex-nowrap items-center gap-2'>
            <HistoryStrip
              buckets={group.timeline}
              className='h-5 w-full min-w-0 flex-1'
            />
            <span className='w-15 shrink-0 text-right font-mono text-sm tabular-nums'>
              {group.success_rate == null
                ? '—'
                : `${formatNumber(group.success_rate, locale)}%`}
            </span>
          </div>
          {group.sample_limited && (
            <span className='text-warning text-xs'>{t('Recent sample')}</span>
          )}
        </TableCell>
        <TableCell className='text-right font-mono text-sm tabular-nums'>
          {group.ttft_seconds == null
            ? '—'
            : `${formatNumber(group.ttft_seconds, locale)}s`}
        </TableCell>
        <TableCell className='text-right font-mono text-sm tabular-nums'>
          {group.tokens_per_second == null
            ? '—'
            : `${formatNumber(group.tokens_per_second, locale)}`}
          <span className='text-muted-foreground text-xs'>
            {group.tokens_per_second != null && 't/s'}
          </span>
        </TableCell>
        <TableCell className='text-right font-mono text-sm tabular-nums'>
          {group.cache_hit_rate == null
            ? '—'
            : `${formatNumber(group.cache_hit_rate, locale)}%`}
        </TableCell>
        <TableCell className='px-0'>
          <Button
            variant='ghost'
            size='icon-xs'
            aria-label={t('Models in {{group}}', {
              group: group.display_name || group.group,
            })}
            aria-expanded={expanded}
            aria-controls={id}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
          </Button>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow
          id={id}
          className='bg-(--table-row-hover) shadow-[inset_2px_0_0_var(--primary)]'
        >
          <TableCell colSpan={8} className='px-4.5 pt-1 pb-5 whitespace-normal'>
            <GroupDetails
              group={group}
              search={props.search}
              updatedAt={props.updatedAt}
              receivedAt={props.receivedAt}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
