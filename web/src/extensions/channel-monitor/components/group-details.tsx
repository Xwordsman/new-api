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
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { ModelPriceCell } from '@/features/pricing/components/model-price-cell'
import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import type { PricingModel } from '@/features/pricing/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatTimestamp } from '@/lib/format'
import { getLobeIcon } from '@/lib/lobe-icon'

import type { MonitorGroup } from '../types'
import { HistoryStrip } from './history-strip'
import { OfferScheduleDetails } from './offer-schedule'

const ModelDetailsDrawer = lazy(() =>
  import('@/features/pricing/components/model-details').then((module) => ({
    default: module.ModelDetailsDrawer,
  }))
)

export function GroupDetails(props: {
  group: MonitorGroup
  search: string
  updatedAt: number
  receivedAt?: number
}) {
  const { t, i18n } = useTranslation()
  const pricing = usePricingData()
  const [selected, setSelected] = useState<PricingModel | null>(null)
  const group = props.group
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const ratioFormat = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 8,
  })
  const offerTimeFormat = new Intl.DateTimeFormat(locale, {
    timeZone: group.offer.timezone || 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const catalog = new Map(
    pricing.models.map((model) => [model.model_name, model])
  )
  const models = group.models.filter(
    (model) => model.enabled && model.model.toLowerCase().includes(props.search)
  )
  const discounted = group.offer.active && group.ratio < group.base_ratio
  const metrics = [
    {
      label: t('Request success rate'),
      value: group.success_rate,
      suffix: '%',
    },
    { label: t('Time to first token'), value: group.ttft_seconds, suffix: 's' },
    {
      label: t('Generation speed'),
      value: group.tokens_per_second,
      suffix: 't/s',
    },
    { label: t('Cache hit rate'), value: group.cache_hit_rate, suffix: '%' },
    { label: t('Average latency'), value: group.latency_seconds, suffix: 's' },
  ]
  return (
    <section
      aria-label={group.display_name || group.group}
      className='bg-card @container overflow-hidden rounded-[calc(var(--radius)*0.7)] border'
    >
      <div className='grid @min-[40rem]:grid-cols-2 @min-[70rem]:grid-cols-[minmax(0,1.35fr)_minmax(0,1.15fr)_minmax(11rem,0.6fr)]'>
        <section
          aria-label={t('Group pricing')}
          className='min-w-0 px-5 py-4.5'
        >
          <h3 className='flex items-center gap-2 text-sm font-semibold'>
            <span className='text-primary font-mono text-xs'>A</span>
            {t('Group pricing')}
          </h3>
          <p className='text-muted-foreground mt-3.5 border-l-2 pl-2.5 text-sm leading-5'>
            {group.description || group.display_name || group.group}
          </p>
          <div className='mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-2 tabular-nums'>
            <p className='flex items-baseline gap-1'>
              <span className='text-primary text-sm'>×</span>
              <span className='text-[36px] leading-tight font-light'>
                {ratioFormat.format(group.ratio)}
              </span>
            </p>
            {discounted && (
              <s className='text-muted-foreground text-sm'>
                ×{ratioFormat.format(group.base_ratio)}
              </s>
            )}
          </div>
          {discounted && (
            <p className='text-muted-foreground mt-1 text-sm leading-5'>
              {group.offer.label ||
                t('{{rate}}/10 of base price', {
                  rate: ratioFormat.format(group.offer.factor * 10),
                })}
              {!group.offer.schedule &&
                group.offer.ends_at > 0 &&
                ` · ${t('Current period ends')}: ${offerTimeFormat.format(new Date(group.offer.ends_at * 1000))}`}
            </p>
          )}
          {group.offer.schedule && (
            <div className='mt-3 border-t pt-3'>
              <OfferScheduleDetails
                schedule={group.offer.schedule}
                timezone={group.offer.timezone || 'Asia/Shanghai'}
                baseRatio={group.base_ratio}
                receivedAt={props.receivedAt}
              />
            </div>
          )}
          {!group.offer.schedule &&
            !group.offer.active &&
            group.offer.next_start > 0 && (
              <p className='text-muted-foreground mt-3 text-sm'>
                {t('Next offer starts {{time}}', {
                  time: offerTimeFormat.format(
                    new Date(group.offer.next_start * 1000)
                  ),
                })}
              </p>
            )}
          <p className='text-muted-foreground mt-3 text-sm leading-5'>
            {t(
              'Actual unit price = model base price × public group multiplier. Model prices shown here include the current public discount.'
            )}
          </p>
        </section>
        <section
          aria-label={t('Available models')}
          className='min-w-0 border-t px-5 py-4.5 @min-[40rem]:border-t-0 @min-[40rem]:border-l'
        >
          <h3 className='flex flex-wrap items-center gap-2 text-sm font-semibold'>
            <span className='text-primary font-mono text-xs'>B</span>
            {t('Available models')}
            <span className='text-muted-foreground font-mono font-normal'>
              {models.length}
            </span>
            <span className='text-muted-foreground ml-auto text-xs font-normal'>
              {t('Input / output · per 1M tokens')}
            </span>
          </h3>
          {pricing.isLoading && <LoadingState />}
          {pricing.error && (
            <ErrorState onRetry={() => void pricing.refetch()} />
          )}
          <ul aria-label={t('Available models')} className='mt-4 space-y-1.5'>
            {models.map((observed) => {
              const source = catalog.get(observed.model)
              const model = source
                ? {
                    ...source,
                    enable_groups: [group.group],
                    group_ratio: { [group.group]: group.ratio },
                  }
                : undefined
              const iconKey = model?.icon || model?.vendor_icon
              return (
                <li
                  key={observed.model}
                  className='group/model flex min-w-0 items-center rounded-[calc(var(--radius)*0.25)] border'
                >
                  <Button
                    variant='ghost'
                    className='h-auto min-h-8 min-w-0 flex-1 shrink justify-between gap-2 rounded-r-none px-2 text-[13px]'
                    disabled={!model}
                    aria-label={t('View prices for {{model}}', {
                      model: observed.model,
                    })}
                    onClick={() => model && setSelected(model)}
                  >
                    <span className='flex min-w-0 items-center gap-2'>
                      {iconKey && (
                        <span className='shrink-0' aria-hidden>
                          {getLobeIcon(iconKey, 14)}
                        </span>
                      )}
                      <span
                        className='truncate font-mono'
                        title={observed.model}
                      >
                        {observed.model}
                      </span>
                    </span>
                    {model ? (
                      <ModelPriceCell
                        model={model}
                        compact
                        showExpression={false}
                        options={{
                          selectedGroup: group.group,
                          tokenUnit: 'M',
                          priceRate: pricing.priceRate,
                          usdExchangeRate: pricing.usdExchangeRate,
                        }}
                      />
                    ) : (
                      <span className='text-muted-foreground text-xs'>
                        {t('Price unavailable')}
                      </span>
                    )}
                  </Button>
                  <CopyButton
                    value={observed.model}
                    className='size-6 rounded-[calc(var(--radius)*0.25)] opacity-60 group-hover/model:opacity-100 focus-visible:opacity-100'
                    iconClassName='size-3'
                    aria-label={t('Copy model ID {{model}}', {
                      model: observed.model,
                    })}
                  />
                </li>
              )
            })}
          </ul>
          {models.length === 0 && (
            <p className='text-muted-foreground py-3 text-sm'>
              {t('No matching models')}
            </p>
          )}
        </section>
        <section
          aria-label={t('Period metrics')}
          className='min-w-0 border-t px-5 py-4.5 @min-[40rem]:col-span-2 @min-[70rem]:col-span-1 @min-[70rem]:border-t-0 @min-[70rem]:border-l'
        >
          <h3 className='flex items-center gap-2 text-sm font-semibold'>
            <span className='text-primary font-mono text-xs'>C</span>
            {t('Period metrics')}
          </h3>
          <dl className='mt-4 grid gap-x-8 gap-y-3 text-sm @min-[40rem]:grid-cols-2 @min-[70rem]:grid-cols-1'>
            {metrics.map((metric) => (
              <div key={metric.label} className='flex justify-between gap-3'>
                <dt className='text-muted-foreground'>{metric.label}</dt>
                <dd className='font-mono tabular-nums'>
                  {metric.value == null
                    ? '—'
                    : `${formatNumber(metric.value, locale)}${metric.suffix}`}
                </dd>
              </div>
            ))}
          </dl>
          <p className='mt-4 border-t pt-3 text-[13px]'>
            {t('{{count}} real requests', {
              count: formatNumber(group.outcomes, locale),
            })}
          </p>
          <p className='text-muted-foreground mt-2 text-xs leading-5'>
            {t(
              'Measured successful streams only. Speed is estimated from whole-second logs; no active probes are sent.'
            )}
          </p>
        </section>
      </div>
      <section
        aria-label={t('Service status')}
        className='border-t px-5 py-4.5'
      >
        <h3 className='flex items-center gap-2 text-sm font-semibold'>
          <span className='text-primary font-mono text-xs'>D</span>
          {t('Service status')}
          <span className='text-muted-foreground ml-auto text-xs font-normal'>
            {t('Updated at')} {formatTimestamp(props.updatedAt).slice(11)}
          </span>
        </h3>
        <HistoryStrip buckets={group.timeline} className='mt-3.5 h-6 w-full' />
        <div className='text-muted-foreground mt-2 flex justify-between text-xs'>
          <span>{t('Past')}</span>
          <span>{t('Now')}</span>
        </div>
        <div className='text-muted-foreground mt-3 flex flex-wrap gap-4 text-xs'>
          {[
            { label: '≥80%', color: 'bg-success' },
            { label: '60–80%', color: 'bg-warning' },
            { label: '<60%', color: 'bg-destructive' },
            { label: t('Unobserved'), color: 'bg-muted-foreground/25' },
          ].map((item) => (
            <span key={item.label} className='flex items-center gap-1.5'>
              <span aria-hidden className={`size-1.5 ${item.color}`} />
              {item.label}
            </span>
          ))}
        </div>
      </section>
      {selected && (
        <Suspense fallback={<LoadingState />}>
          <ModelDetailsDrawer
            model={selected}
            open
            onOpenChange={(open) => !open && setSelected(null)}
            groupRatio={{ [group.group]: group.ratio }}
            usableGroup={{
              [group.group]: {
                desc: group.display_name || group.group,
                ratio: group.ratio,
              },
            }}
            endpointMap={
              pricing.endpointMap as Record<
                string,
                { path?: string; method?: string }
              >
            }
            autoGroups={[]}
            priceRate={pricing.priceRate}
            usdExchangeRate={pricing.usdExchangeRate}
            tokenUnit='M'
          />
        </Suspense>
      )}
    </section>
  )
}
