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
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { HeroTerminalDemo } from '../hero-terminal-demo'

interface CTAProps {
  isAuthenticated?: boolean
}

export function CTA(props: CTAProps) {
  const { t } = useTranslation()

  return (
    <section className='home-section home-cta'>
      <div className='home-container home-cta-grid'>
        <div>
          <Badge variant='outline' className='home-eyebrow'>
            <span className='home-badge-dot' aria-hidden />
            {t('Your next chapter')}
          </Badge>
          <h2 className='home-section-title'>
            {t('One API.')}
            <br />
            {t('Your next')} <em>{t('great idea.')}</em>
          </h2>
          <p className='home-section-description'>
            {t(
              'From your first prompt to your next product, start with a simpler connection.'
            )}
          </p>
          <div className='home-actions'>
            <Button
              size='lg'
              className='home-primary-action'
              render={
                <Link to={props.isAuthenticated ? '/dashboard' : '/sign-up'} />
              }
            >
              {props.isAuthenticated
                ? t('Go to Dashboard')
                : t('Start building')}
              <ArrowRight className='size-4' aria-hidden />
            </Button>
            <Button size='lg' variant='outline' render={<Link to='/pricing' />}>
              {t('Explore models')}
            </Button>
          </div>
        </div>
        <HeroTerminalDemo />
      </div>
    </section>
  )
}
