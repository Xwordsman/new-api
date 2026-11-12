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
import { ArrowUpRight, Crown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { getLobeIcon } from '@/lib/lobe-icon'

import { formatShare, formatTokens } from '../lib/format'
import type { ModelRanking } from '../types'
import { ModelLink, VendorLink } from './entity-links'
import { GrowthText } from './growth-text'

export function TopModels(props: { rows: ModelRanking[] }) {
  const { t } = useTranslation()
  const leaders = props.rows.slice(0, 3)
  if (leaders.length === 0) return null

  return (
    <section aria-label={t('Leading models')} className='rankings-top-models'>
      {leaders.map((model) => (
        <Card
          key={model.model_name}
          className='rankings-spotlight'
          data-rank={model.rank}
        >
          <CardHeader className='rankings-spotlight-header'>
            <Badge variant='outline' className='rankings-rank-badge'>
              {model.rank === 1 && <Crown className='size-3.5' aria-hidden />}
              {t('Rank {{rank}}', { rank: model.rank })}
            </Badge>
            <GrowthText value={model.growth_pct} />
          </CardHeader>
          <CardContent className='rankings-spotlight-body'>
            <div className='rankings-spotlight-model'>
              <span className='rankings-brand-icon' aria-hidden>
                {getLobeIcon(model.vendor_icon, 26)}
              </span>
              <div className='min-w-0'>
                <ModelLink
                  modelName={model.model_name}
                  className='rankings-spotlight-name'
                >
                  {model.model_name}
                </ModelLink>
                <VendorLink
                  vendor={model.vendor}
                  className='rankings-spotlight-vendor'
                />
              </div>
              <ArrowUpRight
                className='rankings-spotlight-arrow size-4'
                aria-hidden
              />
            </div>
            <div className='rankings-spotlight-metrics'>
              <div>
                <span className='rankings-spotlight-number'>
                  {formatTokens(model.total_tokens)}
                </span>
                <span className='rankings-metric-label'>{t('tokens')}</span>
              </div>
              <div className='rankings-spotlight-share'>
                <strong>{formatShare(model.share)}</strong>
                <span className='rankings-metric-label'>{t('Share')}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </section>
  )
}
