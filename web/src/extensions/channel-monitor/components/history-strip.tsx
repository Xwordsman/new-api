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
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatTimestamp } from '@/lib/format'
import { cn } from '@/lib/utils'

import { useMonitorStatuses } from '../hooks/use-monitor-statuses'
import type { MonitorBucket } from '../types'

const colors = {
  healthy: 'bg-success/80',
  degraded: 'bg-warning/80',
  unhealthy: 'bg-destructive/80',
  idle: 'bg-muted-foreground/20',
  unknown: 'bg-muted-foreground/20',
  disabled: 'bg-muted-foreground/20',
}

export function HistoryStrip(props: {
  buckets: MonitorBucket[]
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const statuses = useMonitorStatuses()
  const [active, setActive] = useState(0)
  const periodRefs = useRef<(HTMLButtonElement | null)[]>([])
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return (
    <div
      className={cn('flex h-5 w-full items-stretch gap-px', props.className)}
      role='group'
      aria-label={t('Observed history')}
    >
      {props.buckets.map((bucket, index) => {
        const label = `${formatTimestamp(bucket.start)} – ${formatTimestamp(bucket.end)} · ${statuses[bucket.status].label} · ${t('Logged outcomes')}: ${formatNumber(bucket.outcomes, locale)}`
        return (
          <Tooltip key={bucket.start}>
            <TooltipTrigger
              render={
                <Button
                  variant='ghost'
                  type='button'
                  aria-label={label}
                  tabIndex={
                    index === Math.min(active, props.buckets.length - 1)
                      ? 0
                      : -1
                  }
                  ref={(element) => {
                    periodRefs.current[index] = element
                  }}
                  onFocus={() => setActive(index)}
                  onKeyDown={(event) => {
                    let next = index
                    if (event.key === 'ArrowRight') {
                      next = Math.min(index + 1, props.buckets.length - 1)
                    } else if (event.key === 'ArrowLeft') {
                      next = Math.max(index - 1, 0)
                    } else if (event.key === 'Home') {
                      next = 0
                    } else if (event.key === 'End') {
                      next = props.buckets.length - 1
                    } else {
                      return
                    }
                    event.preventDefault()
                    periodRefs.current[next]?.focus()
                  }}
                  className={cn(
                    'h-full min-w-0 flex-1 rounded-xs border-0 p-0 outline-offset-2',
                    colors[bucket.status]
                  )}
                />
              }
            />
            <TooltipContent>
              <div className='space-y-1'>
                <p>{label}</p>
                {bucket.success_rate != null && (
                  <p>
                    {t('Success rate')}:{' '}
                    {formatNumber(bucket.success_rate, locale)}%
                  </p>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
