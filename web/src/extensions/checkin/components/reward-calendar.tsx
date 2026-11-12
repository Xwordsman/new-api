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
import { Check } from 'lucide-react'
import { createContext, useContext, type ComponentProps } from 'react'
import { Day } from 'react-day-picker'
import { useTranslation } from 'react-i18next'

import { Calendar } from '@/components/ui/calendar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import { checkinCalendarDate, checkinDateKey } from '../lib/format'
import type { CheckinDashboard, CheckinRecord } from '../types'

const RewardsContext = createContext<Map<string, CheckinRecord>>(new Map())

function RewardDay(props: ComponentProps<typeof Day>) {
  const { t, i18n } = useTranslation()
  const rewards = useContext(RewardsContext)
  const record = rewards.get(checkinDateKey(props.day.date))
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(
    props.day.date
  )
  const amount = record
    ? formatQuotaWithCurrency(record.quota_awarded, {
        locale,
        abbreviate: false,
      })
    : ''

  return (
    <Day
      {...props}
      className={cn(
        props.className,
        'align-top',
        record && 'bg-primary/8 text-primary'
      )}
      aria-label={
        record ? t('Check-in on {{date}}: {{amount}}', { date, amount }) : date
      }
    >
      <div className='flex min-h-14 flex-col items-center justify-center gap-1 p-1 sm:min-h-20'>
        <span className='text-sm tabular-nums'>
          {formatNumber(props.day.date.getDate(), locale)}
        </span>
        {record ? (
          <span
            className='flex max-w-full items-center gap-1 text-[10px] tabular-nums sm:text-xs'
            title={amount}
          >
            <Check aria-hidden='true' className='size-3 shrink-0' />
            <span className='truncate'>{amount}</span>
          </span>
        ) : (
          <span className='h-4' aria-hidden='true' />
        )}
      </div>
    </Day>
  )
}

export function RewardCalendar(props: {
  data: CheckinDashboard
  onMonthChange: (month: string) => void
  loading: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const rewards = new Map(
    (props.data.records ?? []).map((record) => [record.checkin_date, record])
  )
  const today = checkinCalendarDate(props.data.today)

  return (
    <Card
      data-card-hover='false'
      className='min-w-0 gap-4'
      aria-busy={props.loading}
    >
      <CardHeader>
        <CardTitle>{t('Reward calendar')}</CardTitle>
        <p className='text-muted-foreground text-xs'>
          {t('Check-in time zone: {{timezone}}', {
            timezone: props.data.timezone,
          })}
        </p>
      </CardHeader>
      <CardContent className='min-w-0'>
        <RewardsContext value={rewards}>
          <Calendar
            className='w-full bg-transparent p-0 [--cell-size:--spacing(9)]'
            month={checkinCalendarDate(props.data.month)}
            today={today}
            endMonth={today}
            disableNavigation={props.loading}
            showOutsideDays={false}
            onMonthChange={(month) =>
              props.onMonthChange(checkinDateKey(month).slice(0, 7))
            }
            formatters={{
              formatCaption: (date) =>
                new Intl.DateTimeFormat(locale, {
                  year: 'numeric',
                  month: 'long',
                }).format(date),
              formatWeekdayName: (date) =>
                new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(
                  date
                ),
            }}
            labels={{
              labelPrevious: () => t('Previous month'),
              labelNext: () => t('Next month'),
              labelGrid: () => t('Reward calendar'),
            }}
            classNames={{
              day: 'relative w-full min-w-0 rounded-lg text-center',
              today: 'ring-primary/40 ring-1 ring-inset',
            }}
            components={{ Day: RewardDay }}
          />
        </RewardsContext>
        <p className='text-muted-foreground mt-5 flex items-center gap-2 text-xs'>
          <Check aria-hidden='true' className='text-primary size-3.5' />
          {t(
            'Checked dates show the reward credited to your wallet. Missed days cannot be claimed later.'
          )}
        </p>
      </CardContent>
    </Card>
  )
}
