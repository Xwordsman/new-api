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
import { BarChart3, Boxes, Network, TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { formatTokens } from '../lib/format'
import type { RankingPeriod, RankingsSnapshot } from '../types'

const PERIODS: { id: RankingPeriod; labelKey: string }[] = [
  { id: 'today', labelKey: 'Today' },
  { id: 'week', labelKey: 'Week' },
  { id: 'month', labelKey: 'Month' },
  { id: 'year', labelKey: 'Year' },
]

type RankingsHeroProps = {
  snapshot?: RankingsSnapshot
  pending?: boolean
  period: RankingPeriod
  onPeriodChange: (period: RankingPeriod) => void
}

export function RankingsHero(props: RankingsHeroProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const totalTokens =
    props.snapshot?.models.reduce(
      (total, model) => total + model.total_tokens,
      0
    ) ?? 0
  const stats = [
    {
      label: t('Token volume'),
      value: formatTokens(totalTokens),
      icon: BarChart3,
    },
    {
      label: t('Ranked models'),
      value: formatNumber(props.snapshot?.models.length ?? 0, locale),
      icon: Boxes,
    },
    {
      label: t('Model providers'),
      value: formatNumber(props.snapshot?.vendors.length ?? 0, locale),
      icon: Network,
    },
  ]

  return (
    <>
      <header className='rankings-hero'>
        <div className='rankings-hero-dots' aria-hidden />
        <div className='rankings-container'>
          <Badge variant='outline' className='rankings-eyebrow'>
            <TrendingUp className='size-3.5' aria-hidden />
            {t('Rankings')}
          </Badge>
          <h1>
            {t("See what's trending.")}
            <em>{t('Discover your next model.')}</em>
          </h1>
          <p className='rankings-hero-description'>
            {t(
              'Discover the most-used models and rising vendors on the platform, updated from live usage data.'
            )}
          </p>
          <dl className='rankings-hero-stats' aria-busy={props.pending}>
            {stats.map((stat) => (
              <div key={stat.label}>
                <stat.icon aria-hidden />
                <dd>{props.pending ? '—' : stat.value}</dd>
                <dt>{stat.label}</dt>
              </div>
            ))}
          </dl>
        </div>
      </header>
      <div className='rankings-container rankings-toolbar'>
        <div>
          <p className='rankings-section-label'>{t('Usage rankings')}</p>
          <h2>{t('The pulse of AI models')}</h2>
          <p className='rankings-toolbar-description'>
            {t('Ranked by token usage, not model quality.')}
          </p>
        </div>
        <ToggleGroup
          value={[props.period]}
          onValueChange={(values) => {
            const next = PERIODS.find((period) => period.id === values[0])
            if (next) props.onPeriodChange(next.id)
          }}
          aria-label={t('Period')}
          className='rankings-period-select'
          spacing={1}
        >
          {PERIODS.map((period) => (
            <ToggleGroupItem key={period.id} value={period.id}>
              {t(period.labelKey)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </>
  )
}
