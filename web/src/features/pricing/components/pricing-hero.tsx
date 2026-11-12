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
import { Boxes, Layers3, Network, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { getLobeIcon } from '@/lib/lobe-icon'

import type { PricingVendor } from '../types'

interface PricingHeroProps {
  modelCount: number
  vendors: PricingVendor[]
  groupCount: number
  pending?: boolean
}

export function PricingHero(props: PricingHeroProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const stats = [
    { label: t('Available Models'), value: props.modelCount, icon: Boxes },
    { label: t('Model providers'), value: props.vendors.length, icon: Network },
    { label: t('Available groups'), value: props.groupCount, icon: Layers3 },
  ]

  return (
    <header className='pricing-hero'>
      <div className='pricing-hero-dots' aria-hidden />
      <div className='pricing-container pricing-hero-content'>
        <Badge variant='outline' className='pricing-eyebrow'>
          <Sparkles className='size-3.5' aria-hidden />
          {t('Model Square')}
        </Badge>
        <h1>
          {t('For every idea,')}
          <em>{t('the right AI model.')}</em>
        </h1>
        <p className='pricing-hero-description'>
          {t(
            'Discover curated AI models, compare pricing and capabilities, and choose the right model for every scenario.'
          )}
        </p>
        <dl className='pricing-hero-stats' aria-busy={props.pending}>
          {stats.map((stat) => (
            <div key={stat.label}>
              <stat.icon className='pricing-stat-icon' aria-hidden />
              <dd>{props.pending ? '—' : formatNumber(stat.value, locale)}</dd>
              <dt>{stat.label}</dt>
            </div>
          ))}
        </dl>
        {props.vendors.length > 0 && (
          <div
            className='pricing-provider-strip'
            aria-label={t('Model providers')}
          >
            {props.vendors.slice(0, 8).map((vendor) => (
              <span key={vendor.id} className='pricing-provider'>
                {vendor.icon && (
                  <span aria-hidden>{getLobeIcon(vendor.icon, 23)}</span>
                )}
                {vendor.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </header>
  )
}
