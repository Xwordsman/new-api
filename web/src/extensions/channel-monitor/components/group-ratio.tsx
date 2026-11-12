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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { toIntlLocale } from '@/i18n/languages'

import type { MonitorGroup } from '../types'

export function GroupRatio(props: { group: MonitorGroup }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const group = props.group
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const ratioFormat = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 8,
  })
  if (!group.offer.active || group.ratio >= group.base_ratio) {
    return (
      <span className='inline-flex h-7.5 items-center rounded-[calc(var(--radius)*0.3)] border px-2.5 font-mono text-[13px] font-semibold'>
        ×{ratioFormat.format(group.ratio)}
      </span>
    )
  }
  const timezone = group.promotion?.timezone || 'Asia/Shanghai'
  const endsAt =
    group.offer.ends_at > 0 ? new Date(group.offer.ends_at * 1000) : null
  const timeFormat = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  return (
    <HoverCard open={open} onOpenChange={setOpen}>
      <HoverCardTrigger
        delay={200}
        closeDelay={100}
        render={
          <Button
            variant='ghost'
            aria-label={t('Discount details for {{group}}', {
              group: group.display_name || group.group,
            })}
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className='relative h-7.5 gap-1.5 rounded-[calc(var(--radius)*0.3)] border border-sky-500/30 bg-sky-500/5 px-2.5 font-mono text-[13px] hover:bg-sky-500/10'
          >
            <span className='font-semibold text-sky-600 dark:text-sky-400'>
              ×{ratioFormat.format(group.ratio)}
            </span>
            <s className='text-muted-foreground text-[10px] font-normal'>
              ×{ratioFormat.format(group.base_ratio)}
            </s>
            <span className='absolute -top-1.5 -right-1.5 rounded-[calc(var(--radius)*0.15)] bg-sky-500 px-0.5 text-[9px] leading-4 text-white'>
              {t('Sale')}
            </span>
          </Button>
        }
      />
      <HoverCardContent
        align='start'
        sideOffset={10}
        role='region'
        aria-label={t('Discount details')}
        className='w-74 max-w-[calc(100vw-2rem)] rounded-[calc(var(--radius)*0.6)] p-4'
      >
        <p className='flex items-center gap-2 text-xs font-semibold'>
          <span className='flex size-6 items-center justify-center rounded-[calc(var(--radius)*0.25)] bg-sky-500 text-white'>
            {t('Sale')}
          </span>
          {group.offer.label || t('Discount')}
        </p>
        <dl className='mt-3 flex flex-col gap-2.5 text-xs'>
          <div className='flex items-baseline justify-between gap-4'>
            <dt className='text-muted-foreground'>{t('Current multiplier')}</dt>
            <dd className='font-mono font-semibold text-sky-600 tabular-nums dark:text-sky-400'>
              ×{ratioFormat.format(group.ratio)}
            </dd>
          </div>
          <div className='flex items-baseline justify-between gap-4'>
            <dt className='text-muted-foreground'>{t('Base multiplier')}</dt>
            <dd className='font-mono tabular-nums'>
              ×{ratioFormat.format(group.base_ratio)}
            </dd>
          </div>
          <div className='flex items-baseline justify-between gap-4 border-t pt-2.5'>
            <dt className='text-muted-foreground'>{t('Discount rate')}</dt>
            <dd className='font-medium'>
              {t('{{rate}}/10 of base price', {
                rate: ratioFormat.format(group.offer.factor * 10),
              })}
            </dd>
          </div>
          <div className='flex items-baseline justify-between gap-4'>
            <dt className='text-muted-foreground'>{t('Offer end time')}</dt>
            <dd className='tabular-nums'>
              {endsAt ? (
                <time dateTime={endsAt.toISOString()}>
                  {timeFormat.format(endsAt)}
                </time>
              ) : (
                t('No end time')
              )}
            </dd>
          </div>
          <div className='flex items-baseline justify-between gap-4'>
            <dt className='text-muted-foreground'>{t('Pricing timezone')}</dt>
            <dd className='font-mono'>{timezone}</dd>
          </div>
        </dl>
      </HoverCardContent>
    </HoverCard>
  )
}
