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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { cn } from '@/lib/utils'

import type { MonitorGroup } from '../types'

// Compare civil dates in the pricing zone, including 23/25-hour DST days.
function pricingDay(epoch: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(epoch * 1000)
  const fields = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  )
  return (
    Date.UTC(
      Number(fields.year),
      Number(fields.month) - 1,
      Number(fields.day)
    ) / 86_400_000
  )
}

export function OfferScheduleDetails(props: {
  schedule: NonNullable<MonitorGroup['offer']['schedule']>
  timezone: string
  baseRatio: number
  receivedAt?: number
}) {
  const { t, i18n } = useTranslation()
  const [clock, setClock] = useState(Date.now)
  const schedule = props.schedule
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const now = props.receivedAt
    ? schedule.evaluated_at + Math.max(0, clock - props.receivedAt) / 1000
    : clock / 1000
  useEffect(() => {
    if (!schedule.period_end) return
    const timer = globalThis.setInterval(() => setClock(Date.now()), 1000)
    return () => globalThis.clearInterval(timer)
  }, [schedule.period_end])
  const timeFormat = new Intl.DateTimeFormat(locale, {
    timeZone: props.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const fullFormat = new Intl.DateTimeFormat(locale, {
    timeZone: props.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const ratioFormat = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 8,
  })
  let period = t('All day')
  let transition = ''
  if (schedule.period_end > 0) {
    const end = schedule.period_end
    const dayOffset =
      pricingDay(end, props.timezone) - pricingDay(now, props.timezone)
    transition = fullFormat.format(end * 1000)
    if (dayOffset === 0) {
      transition = `${t('Today')} ${timeFormat.format(end * 1000)}`
    }
    if (dayOffset === 1) {
      transition = `${t('Tomorrow')} ${timeFormat.format(end * 1000)}`
    }
    const start = schedule.period_start
    const startTime = start ? timeFormat.format(start * 1000) : t('Now')
    let endTime = timeFormat.format(end * 1000)
    if (
      start &&
      pricingDay(end, props.timezone) > pricingDay(start, props.timezone)
    ) {
      endTime = `${t('Next day')} ${endTime}`
    }
    period = `${startTime}–${endTime}`
    if (!schedule.daily_start || (!start && dayOffset > 1)) {
      period = `${start ? fullFormat.format(start * 1000) : t('Now')}–${fullFormat.format(end * 1000)}`
    }
  } else if (schedule.period_start) {
    period = `${fullFormat.format(schedule.period_start * 1000)}–${t('No end time')}`
  }
  const remaining = Math.max(0, Math.ceil(schedule.period_end - now))
  const countdown = [
    Math.floor(remaining / 3600),
    Math.floor((remaining % 3600) / 60),
    remaining % 60,
  ]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')
  const nextDiscounted = schedule.next_factor < 1
  return (
    <dl className='flex flex-col gap-2.5 text-sm'>
      <div className='flex items-baseline justify-between gap-4'>
        <dt className='text-muted-foreground shrink-0'>
          {t('Current period')}
        </dt>
        <dd className='text-right tabular-nums'>{period}</dd>
      </div>
      {schedule.period_end > 0 ? (
        <>
          <div className='flex items-baseline justify-between gap-4'>
            <dt className='text-muted-foreground shrink-0'>
              {nextDiscounted
                ? t('Next discount starts')
                : t('Current period ends')}
            </dt>
            <dd className='text-right leading-5 tabular-nums'>
              <time
                dateTime={new Date(schedule.period_end * 1000).toISOString()}
                title={fullFormat.format(schedule.period_end * 1000)}
              >
                {transition}
              </time>
              <span className='text-muted-foreground'> · </span>
              <span
                role='timer'
                aria-label={t('Time until next pricing change')}
                className='text-primary font-mono'
              >
                {countdown}
              </span>
            </dd>
          </div>
          <div className='flex items-baseline justify-between gap-4'>
            <dt className='text-muted-foreground shrink-0'>
              {t('Next period')}
            </dt>
            <dd
              className={cn(
                'text-right font-medium',
                nextDiscounted && 'text-primary'
              )}
            >
              {nextDiscounted ? t('Discount') : t('Regular price')} ×
              {ratioFormat.format(props.baseRatio * schedule.next_factor)}
            </dd>
          </div>
        </>
      ) : (
        <div className='flex items-baseline justify-between gap-4'>
          <dt className='text-muted-foreground'>{t('Next period')}</dt>
          <dd className='text-right'>{t('No upcoming change')}</dd>
        </div>
      )}
      <div className='flex items-baseline justify-between gap-4 border-t pt-2.5'>
        <dt className='text-muted-foreground shrink-0'>
          {t('Activity end time')}
        </dt>
        <dd className='text-right tabular-nums'>
          {schedule.ends_at > 0 ? (
            <time dateTime={new Date(schedule.ends_at * 1000).toISOString()}>
              {fullFormat.format(schedule.ends_at * 1000)}
            </time>
          ) : (
            t('No end time')
          )}
        </dd>
      </div>
      <div className='flex items-baseline justify-between gap-4'>
        <dt className='text-muted-foreground'>{t('Pricing timezone')}</dt>
        <dd className='font-mono'>{props.timezone}</dd>
      </div>
    </dl>
  )
}
