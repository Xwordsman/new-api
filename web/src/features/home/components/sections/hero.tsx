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
import { Link } from '@tanstack/react-router'
import { ArrowRight, BookOpen, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useStatus } from '@/hooks/use-status'
import { getDocumentationLink } from '@/lib/documentation-link'
import { getLobeIcon } from '@/lib/lobe-icon'

import { ProductPreview } from '../product-preview'

const providers = [
  { name: 'OpenAI', icon: 'OpenAI' },
  { name: 'Claude', icon: 'Claude.Color' },
  { name: 'Gemini', icon: 'Gemini.Color' },
  { name: 'DeepSeek', icon: 'DeepSeek.Color' },
  { name: 'Qwen', icon: 'Qwen.Color' },
  { name: 'Grok', icon: 'Grok' },
]

interface HeroProps {
  isAuthenticated?: boolean
}

export function Hero(props: HeroProps) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const docsLink = getDocumentationLink(status)

  return (
    <section className='home-hero'>
      <div className='home-hero-dots' aria-hidden />
      <div className='home-container home-hero-content'>
        <Badge variant='outline' className='home-eyebrow'>
          <span className='home-badge-dot' aria-hidden />
          {t('Built for your next idea')}
          <ArrowRight className='size-3' aria-hidden />
        </Badge>
        <h1>
          {t('One API.')}
          <span className='home-headline-line'>
            {t("Connect to the world's")} <em>{t('AI models.')}</em>
          </span>
        </h1>
        <p className='home-hero-description'>
          {t('Bring OpenAI, Claude, Gemini and more into one workflow.')}
          <br className='hidden sm:block' />
          {t('Keep your favorite tools. Build your next great idea.')}
        </p>
        <div className='home-actions'>
          <Button
            size='lg'
            className='home-primary-action'
            render={
              <Link to={props.isAuthenticated ? '/dashboard' : '/sign-up'} />
            }
          >
            {props.isAuthenticated ? t('Go to Dashboard') : t('Start building')}
            <ArrowRight className='size-4' aria-hidden />
          </Button>
          <Button size='lg' variant='outline' render={<Link to='/pricing' />}>
            {t('Explore models')}
          </Button>
        </div>
        <div className='home-hero-notes'>
          <span>
            <Check className='size-3.5' aria-hidden />
            {t('Multi-protocol Compatible')}
          </span>
          <span>
            <Check className='size-3.5' aria-hidden />
            {t('Pay-as-you-go')}
          </span>
          {docsLink && (
            <Link
              to={docsLink.href}
              target={docsLink.external ? '_blank' : undefined}
              rel={docsLink.external ? 'noopener noreferrer' : undefined}
            >
              <BookOpen className='size-3.5' aria-hidden />
              {t('Documentation')}
            </Link>
          )}
        </div>
        <ProductPreview />
        <div className='home-providers'>
          <p>{t('Your favorite models, one place to connect.')}</p>
          <div className='home-provider-list'>
            {providers.map((provider) => (
              <div key={provider.name} className='home-provider'>
                <span aria-hidden>{getLobeIcon(provider.icon, 28)}</span>
                <span>{provider.name}</span>
              </div>
            ))}
          </div>
          <p className='home-provider-note'>
            {t('Model availability depends on the configured channels.')}
          </p>
        </div>
      </div>
    </section>
  )
}
