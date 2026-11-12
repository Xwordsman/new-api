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
  Code2,
  Fingerprint,
  Layers,
  Route,
  Wallet,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { CapabilityVisual } from '../capability-visual'

export function Features() {
  const { t } = useTranslation()
  const features = [
    {
      id: 'routing',
      icon: Route,
      title: t('Routing that keeps you moving'),
      description: t(
        'Channel routing, load balancing and configurable retries, managed in one place.'
      ),
    },
    {
      id: 'billing',
      icon: Wallet,
      title: t('A clearer view of usage'),
      description: t(
        'See model usage and request costs together, without switching between provider dashboards.'
      ),
    },
    {
      id: 'protocols',
      icon: Code2,
      title: t('Keep the tools you love'),
      description: t(
        'Connect with compatible OpenAI, Claude and Gemini API routes.'
      ),
    },
    {
      id: 'observability',
      icon: Activity,
      title: t('Every request in focus'),
      description: t(
        'Follow usage trends and inspect request logs from the console.'
      ),
    },
    {
      id: 'keys',
      icon: Fingerprint,
      title: t('Access on your terms'),
      description: t(
        'Create separate API keys with their own quotas, expiration dates and model restrictions.'
      ),
    },
    {
      id: 'scale',
      icon: Layers,
      title: t('Room for your next idea'),
      description: t(
        'Manage multiple channels and groups as your applications grow.'
      ),
    },
  ]

  return (
    <section id='capabilities' className='home-section'>
      <div className='home-container'>
        <Badge variant='outline' className='home-eyebrow'>
          <span className='home-badge-dot' aria-hidden />
          {t('Core Features')}
        </Badge>
        <h2 className='home-section-title'>
          {t('Less infrastructure.')}
          <br />
          <em>{t('More possibilities.')}</em>
        </h2>
        <p className='home-section-description'>
          {t('The details behind every great AI experience, brought together.')}
        </p>
        <Tabs
          defaultValue='routing'
          orientation='vertical'
          className='home-capability-tabs'
        >
          <TabsList
            aria-label={t('Core Features')}
            className='home-capability-list'
          >
            {features.map((feature, index) => (
              <TabsTrigger
                key={feature.id}
                value={feature.id}
                className='home-capability-trigger'
                aria-label={feature.title}
              >
                <feature.icon className='size-4.5' aria-hidden />
                <span className='home-capability-text'>
                  <strong>{feature.title}</strong>
                  <span>{feature.description}</span>
                </span>
                <span className='home-capability-number' aria-hidden>
                  0{index + 1}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          <div className='home-capability-stage'>
            {features.map((feature) => (
              <TabsContent
                key={feature.id}
                value={feature.id}
                className='home-capability-panel'
              >
                <CapabilityVisual kind={feature.id} />
                <p className='home-visual-caption'>
                  {t('Illustrative preview')}
                </p>
              </TabsContent>
            ))}
          </div>
        </Tabs>
      </div>
    </section>
  )
}
