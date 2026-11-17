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
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { cn } from '@/lib/utils'

import { promotionSchema, type PromotionForm } from './schema'

export function PromotionToggle(props: {
  group: string
  promotion?: PromotionForm['groups'][number]['promotion']
  baseRatio?: number
  now: number
  expanded: boolean
  controls: string
  disabled: boolean
  onToggle: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 8 })
  const promotion = props.promotion
  let status = t('Offer disabled')
  let variant: StatusVariant = 'neutral'
  let schedule = ''
  let ratio: number | undefined
  let fromPrice = false
  if (promotion) {
    const parsed = promotionSchema.safeParse(promotion)
    if (!parsed.success) {
      status = t('Invalid offer')
      variant = 'danger'
    } else {
      const rule = parsed.data
      let periods = rule.daily_periods ?? []
      if (!periods.length && rule.daily_start && rule.ratio !== undefined) {
        periods = [
          { start: rule.daily_start, end: rule.daily_end, ratio: rule.ratio },
        ]
      }
      const epoch = props.now / 1000
      const campaignActive =
        rule.enabled &&
        epoch >= rule.starts_at &&
        (rule.ends_at === 0 || epoch < rule.ends_at)
      let activePeriod: (typeof periods)[number] | undefined
      if (periods.length) {
        const parts = new Intl.DateTimeFormat('en-GB', {
          timeZone: rule.timezone || 'Asia/Shanghai',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).formatToParts(props.now)
        const clock = `${parts.find((part) => part.type === 'hour')?.value}:${parts.find((part) => part.type === 'minute')?.value}`
        activePeriod = periods.find((period) =>
          period.start < period.end
            ? clock >= period.start && clock < period.end
            : clock >= period.start || clock < period.end
        )
        ratio =
          campaignActive && activePeriod
            ? activePeriod.ratio
            : Math.min(...periods.map((period) => period.ratio))
      } else {
        ratio = rule.ratio
      }
      if (ratio !== undefined) ratio = Math.min(props.baseRatio ?? ratio, ratio)
      if (rule.enabled) {
        status = t('Offer active')
        variant = 'success'
        if (rule.ends_at > 0 && epoch >= rule.ends_at) {
          status = t('Offer ended')
          variant = 'neutral'
        } else if (epoch < rule.starts_at) {
          status = t('Offer scheduled')
          variant = 'info'
        } else if (periods.length && !activePeriod) {
          status = t('Outside daily hours')
          variant = 'info'
        }
      }
      fromPrice = periods.length > 1 && !(campaignActive && activePeriod)
      if (periods.length > 1) {
        schedule = `${t('Daily periods: {{count}}', { count: periods.length })} · ${rule.timezone || 'Asia/Shanghai'}`
      } else if (periods.length) {
        schedule = `${periods[0].start}–${periods[0].end} · ${rule.timezone || 'Asia/Shanghai'}`
      } else if (rule.starts_at > epoch || rule.ends_at > 0) {
        const timestamp = rule.starts_at > epoch ? rule.starts_at : rule.ends_at
        const label =
          rule.starts_at > epoch ? t('Offer starts') : t('Offer ends')
        schedule = `${label}: ${new Intl.DateTimeFormat(locale, {
          dateStyle: 'short',
          timeStyle: 'short',
        }).format(timestamp * 1000)}`
      }
    }
  }

  return (
    <Button
      type='button'
      variant='ghost'
      className='h-auto w-full max-w-80 justify-between gap-3 px-2 py-2 text-left whitespace-normal'
      aria-label={t('Public discount for {{group}}', { group: props.group })}
      aria-expanded={props.expanded}
      aria-controls={props.expanded ? props.controls : undefined}
      onClick={props.onToggle}
      disabled={props.disabled}
    >
      <span className='flex min-w-0 flex-col gap-1.5'>
        <span className='flex flex-wrap items-center gap-2'>
          <StatusBadge variant={variant} copyable={false}>
            {status}
          </StatusBadge>
          {ratio !== undefined && (
            <span className='font-mono tabular-nums'>
              {fromPrice
                ? t('From ×{{ratio}}', { ratio: formatter.format(ratio) })
                : `×${formatter.format(ratio)}`}
            </span>
          )}
        </span>
        {schedule && (
          <span data-table-text='secondary' className='text-muted-foreground'>
            {schedule}
          </span>
        )}
      </span>
      <ChevronDown
        aria-hidden='true'
        className={cn('transition-transform', props.expanded && 'rotate-180')}
      />
    </Button>
  )
}
