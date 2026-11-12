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
  ArrowRight,
  Check,
  KeyRound,
  Layers,
  Route,
  ShieldCheck,
  Terminal,
  Wallet,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { getLobeIcon } from '@/lib/lobe-icon'

import { UsageIllustration } from './product-preview'

interface CapabilityVisualProps {
  kind: string
}

export function CapabilityVisual(props: CapabilityVisualProps) {
  const { t } = useTranslation()

  if (props.kind === 'routing' || props.kind === 'scale') {
    return (
      <div className='home-routing-visual'>
        <div className='home-route-source home-floating-card'>
          <Terminal className='size-5' aria-hidden />
          <strong>{t('Your application')}</strong>
          <span>POST /v1/…</span>
        </div>
        <span className='home-route-connector' aria-hidden />
        <div className='home-route-hub'>
          <Route className='size-7' aria-hidden />
          <span>new-api</span>
        </div>
        <span className='home-route-connector' aria-hidden />
        <div className='home-route-destinations'>
          {['OpenAI', 'Claude', 'Gemini'].map((name) => (
            <div key={name} className='home-floating-card'>
              <span aria-hidden>{getLobeIcon(name, 23)}</span>
              <strong>{name}</strong>
              <Check className='text-primary size-3.5' aria-hidden />
            </div>
          ))}
        </div>
        <Badge variant='secondary' className='home-route-label'>
          {props.kind === 'routing'
            ? t('One endpoint. Multiple channels.')
            : t('Organize channels into groups.')}
        </Badge>
      </div>
    )
  }

  if (props.kind === 'protocols') {
    return (
      <div className='home-protocol-visual home-floating-card'>
        <div className='home-visual-title'>
          <Terminal className='text-primary size-4' aria-hidden />
          <strong>{t('Familiar APIs. One base URL.')}</strong>
        </div>
        {[
          { name: 'OpenAI', path: '/v1/chat/completions' },
          { name: 'Claude', path: '/v1/messages' },
          { name: 'Gemini', path: '/v1beta/models/…' },
        ].map((api) => (
          <div key={api.name} className='home-protocol-row'>
            <span aria-hidden>{getLobeIcon(api.name, 25)}</span>
            <span>
              <strong>{api.name}</strong>
              <code>{api.path}</code>
            </span>
            <ArrowRight className='text-primary size-4' aria-hidden />
          </div>
        ))}
      </div>
    )
  }

  if (props.kind === 'keys') {
    return (
      <div className='home-key-visual home-floating-card'>
        <div className='home-visual-title'>
          <KeyRound className='text-primary size-4' aria-hidden />
          <strong>{t('Your key, your rules')}</strong>
          <ShieldCheck className='text-primary ms-auto size-5' aria-hidden />
        </div>
        <div className='home-key-secret'>
          <code>sk-••••••••••••••••••••</code>
          <KeyRound className='size-4' aria-hidden />
        </div>
        {[t('Quota limits'), t('Expiration date'), t('Model restrictions')].map(
          (label) => (
            <div className='home-visual-setting' key={label}>
              <span>{label}</span>
              <Check className='text-primary size-4' aria-hidden />
            </div>
          )
        )}
      </div>
    )
  }

  if (props.kind === 'billing') {
    return (
      <div className='home-billing-visual home-floating-card'>
        <div className='home-visual-title'>
          <Wallet className='text-primary size-4' aria-hidden />
          <strong>{t('One place for usage and costs')}</strong>
        </div>
        {[
          { name: 'OpenAI', type: t('Input tokens') },
          { name: 'Claude', type: t('Output tokens') },
          { name: 'Gemini', type: t('Request costs') },
        ].map((row) => (
          <div className='home-visual-setting' key={row.name}>
            <span className='home-billing-provider'>
              <span aria-hidden>{getLobeIcon(row.name, 20)}</span>
              {row.name}
            </span>
            <span>{row.type}</span>
          </div>
        ))}
        <div className='home-billing-total'>
          <Layers className='size-4' aria-hidden />
          <strong>{t('A unified usage history')}</strong>
          <Check className='ms-auto size-4' aria-hidden />
        </div>
      </div>
    )
  }

  return (
    <div className='home-observability-visual home-floating-card'>
      <div className='home-visual-title'>
        <Activity className='text-primary size-4' aria-hidden />
        <strong>{t('Usage trends')}</strong>
        <Badge variant='secondary' className='ms-auto'>
          {t('Console')}
        </Badge>
      </div>
      <UsageIllustration />
      <div className='home-observability-legend'>
        <span>
          <i />
          {t('Requests')}
        </span>
        <span>
          <i />
          {t('Tokens')}
        </span>
      </div>
      <div className='home-visual-setting'>
        <code>/v1/chat/completions</code>
        <Badge variant='secondary'>{t('Usage Logs')}</Badge>
      </div>
    </div>
  )
}
