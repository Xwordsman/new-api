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
  Activity,
  ArrowUpRight,
  Check,
  ChevronDown,
  KeyRound,
  Layers,
  LayoutDashboard,
  Terminal,
  Zap,
} from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { getLobeIcon } from '@/lib/lobe-icon'

import { HeroTerminalDemo } from './hero-terminal-demo'

export function UsageIllustration() {
  const gradientId = useId()
  return (
    <svg viewBox='0 0 600 170' className='home-usage-chart' aria-hidden='true'>
      <defs>
        <linearGradient id={gradientId} x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0%' stopColor='currentColor' stopOpacity='.2' />
          <stop offset='100%' stopColor='currentColor' stopOpacity='0' />
        </linearGradient>
      </defs>
      <path
        className='home-chart-grid'
        d='M0 20H600M0 65H600M0 110H600M0 155H600'
      />
      <path
        d='M0 144C24 144 30 122 55 124S88 145 115 117S150 99 174 106S198 90 220 104S252 69 280 78S310 104 340 63S373 80 400 45S431 65 458 42S500 66 526 24S566 40 600 13V170H0Z'
        fill={`url(#${gradientId})`}
      />
      <path
        d='M0 144C24 144 30 122 55 124S88 145 115 117S150 99 174 106S198 90 220 104S252 69 280 78S310 104 340 63S373 80 400 45S431 65 458 42S500 66 526 24S566 40 600 13'
        fill='none'
        stroke='currentColor'
        strokeWidth='2.5'
      />
    </svg>
  )
}

export function ProductPreview() {
  const { t } = useTranslation()

  return (
    <div
      className='home-product-preview'
      aria-label={t('Illustrative workspace preview')}
    >
      <div className='home-preview-backdrop' aria-hidden />
      <div className='home-preview-window'>
        <div className='home-window-chrome'>
          <div className='home-window-dots' aria-hidden>
            <i />
            <i />
            <i />
          </div>
          <span>
            <Layers className='size-3' aria-hidden />
            new-api / {t('Workspace')}
          </span>
          <Badge variant='secondary'>{t('Illustrative preview')}</Badge>
        </div>
        <div className='home-preview-body'>
          <div className='home-preview-rail' aria-hidden>
            <Layers className='home-rail-brand' />
            <LayoutDashboard className='home-rail-active' />
            <KeyRound />
            <Activity />
            <Terminal />
          </div>
          <div className='home-preview-dashboard'>
            <div className='home-preview-heading'>
              <div>
                <p>{t('Everything in view')}</p>
                <strong>{t('Your AI workspace')}</strong>
              </div>
              <span className='home-preview-period'>
                {t('Usage overview')}
                <ChevronDown className='size-3' aria-hidden />
              </span>
            </div>
            <div className='home-preview-stats'>
              <div>
                <Activity aria-hidden />
                <span>{t('Requests')}</span>
                <strong>{t('Track every call')}</strong>
              </div>
              <div>
                <Zap aria-hidden />
                <span>{t('Tokens')}</span>
                <strong>{t('Understand usage')}</strong>
              </div>
              <div>
                <Layers aria-hidden />
                <span>{t('Costs')}</span>
                <strong>{t('Stay in control')}</strong>
              </div>
            </div>
            <div className='home-preview-chart-heading'>
              <strong>{t('Usage trends')}</strong>
              <span>
                <i />
                {t('Requests')}
              </span>
            </div>
            <UsageIllustration />
            <div className='home-preview-chart-footer'>
              <span>{t('Models')}</span>
              <span>OpenAI · Claude · Gemini</span>
            </div>
          </div>
        </div>
      </div>
      <div className='home-preview-models home-floating-card'>
        <p>
          {t('A model for every idea')}
          <Layers className='size-3.5' aria-hidden />
        </p>
        {[
          { name: 'OpenAI', icon: 'OpenAI', detail: 'GPT' },
          { name: 'Claude', icon: 'Claude.Color', detail: 'Anthropic' },
          { name: 'Gemini', icon: 'Gemini.Color', detail: 'Google' },
        ].map((model) => (
          <div key={model.name}>
            <span aria-hidden>{getLobeIcon(model.icon, 22)}</span>
            <span>
              <strong>{model.name}</strong>
              <small>{model.detail}</small>
            </span>
            <ArrowUpRight
              className='text-muted-foreground size-3'
              aria-hidden
            />
          </div>
        ))}
      </div>
      <div className='home-preview-key home-floating-card'>
        <span className='home-visual-icon'>
          <KeyRound className='size-5' aria-hidden />
        </span>
        <strong>{t('One key. More possibilities.')}</strong>
        <p>{t('Your tools, connected.')}</p>
        <code>sk-••••••••••••</code>
        <div className='home-key-protocols'>
          <span>OpenAI</span>
          <span>Claude</span>
          <span>Gemini</span>
        </div>
      </div>
      <HeroTerminalDemo compact className='home-preview-terminal' />
      <div className='home-preview-notice home-floating-card'>
        <span>
          <Check className='size-4' aria-hidden />
        </span>
        <div>
          <strong>{t('From idea to first request')}</strong>
          <p>{t('One endpoint. Your next chapter.')}</p>
        </div>
      </div>
    </div>
  )
}
