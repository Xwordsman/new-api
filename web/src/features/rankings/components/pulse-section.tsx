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
import {
  ArrowDownRight,
  ArrowUpRight,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import type { RankingMover } from '../types'
import { ModelLink, VendorLink } from './entity-links'

type PulseSectionProps = {
  movers: RankingMover[]
  droppers: RankingMover[]
}

/**
 * Rank movement panel: gainers and losers calculated from the previous period.
 */
export function PulseSection(props: PulseSectionProps) {
  const { t } = useTranslation()

  return (
    <section className='rankings-pulse'>
      <PulseCard
        title={t('Trending up')}
        description={t('Models climbing the leaderboard')}
        icon={<TrendingUp className='text-success size-4' aria-hidden />}
      >
        {props.movers.length === 0 ? (
          <EmptyState
            title={t('No notable climbers right now')}
            className='rankings-compact-state'
          />
        ) : (
          <ul>
            {props.movers.map((row) => (
              <MoverRow key={row.model_name} row={row} intent='up' />
            ))}
          </ul>
        )}
      </PulseCard>

      <PulseCard
        title={t('Trending down')}
        description={t('Models losing positions')}
        icon={<TrendingDown className='text-destructive size-4' aria-hidden />}
      >
        {props.droppers.length === 0 ? (
          <EmptyState
            title={t('No notable drops right now')}
            className='rankings-compact-state'
          />
        ) : (
          <ul>
            {props.droppers.map((row) => (
              <MoverRow key={row.model_name} row={row} intent='down' />
            ))}
          </ul>
        )}
      </PulseCard>
    </section>
  )
}

function PulseCard(props: {
  title: string
  description: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card className='rankings-panel'>
      <CardHeader className='rankings-panel-header'>
        <div className='rankings-panel-title'>
          <span className='rankings-panel-icon'>{props.icon}</span>
          <h3>{props.title}</h3>
        </div>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent className='rankings-pulse-content'>
        {props.children}
      </CardContent>
    </Card>
  )
}

function MoverRow(props: { row: RankingMover; intent: 'up' | 'down' }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  return (
    <li className='rankings-mover-row'>
      <span className='rankings-table-brand' aria-hidden>
        {getLobeIcon(props.row.vendor_icon, 24)}
      </span>
      <div className='min-w-0 flex-1'>
        <ModelLink
          modelName={props.row.model_name}
          className='rankings-table-name'
        >
          {props.row.model_name}
        </ModelLink>
        <p className='rankings-table-vendor'>
          #{props.row.current_rank} ·{' '}
          <VendorLink vendor={props.row.vendor}>{props.row.vendor}</VendorLink>
        </p>
      </div>
      <span
        className={cn(
          'rankings-rank-change',
          props.intent === 'up' ? 'text-success' : 'text-destructive'
        )}
        aria-label={t('Rank change: {{change}}', {
          change: props.row.rank_delta,
        })}
      >
        {props.intent === 'up' ? (
          <ArrowUpRight className='size-3.5' aria-hidden />
        ) : (
          <ArrowDownRight className='size-3.5' aria-hidden />
        )}
        {formatNumber(Math.abs(props.row.rank_delta), locale)}
      </span>
    </li>
  )
}
