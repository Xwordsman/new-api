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
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { LanguageSwitcher } from '@/components/language-switcher'
import { SystemBrand } from '@/components/layout/components/system-brand'
import { ThemeSwitch } from '@/components/theme-switch'
import { Skeleton } from '@/components/ui/skeleton'
import { useSystemConfig } from '@/hooks/use-system-config'

type AuthLayoutProps = {
  children: React.ReactNode
  variant?: 'default' | 'split'
}

export function AuthLayout({ children, variant = 'default' }: AuthLayoutProps) {
  const { t } = useTranslation()
  const { systemName, logo, loading } = useSystemConfig()

  if (variant === 'split') {
    return (
      <div className='auth-page'>
        <main className='auth-main'>
          <header className='auth-header'>
            <SystemBrand variant='inline' />
            <div className='auth-header-actions'>
              <LanguageSwitcher />
              <ThemeSwitch />
            </div>
          </header>

          <div className='auth-form-container'>{children}</div>

          <footer className='auth-page-footer'>
            <Link to='/' className='auth-home-link'>
              <ArrowLeft aria-hidden='true' />
              {t('Back to home')}
            </Link>
          </footer>
        </main>

        <aside className='auth-showcase'>
          <div className='auth-showcase-inner'>
            <div className='auth-illustration' aria-hidden='true'>
              <div className='auth-orbit auth-orbit-outer' />
              <div className='auth-orbit auth-orbit-inner' />
              <div className='auth-spotlight' />
              <span className='auth-star auth-star-one'>✦</span>
              <span className='auth-star auth-star-two'>✦</span>
              <span className='auth-star auth-star-three'>✧</span>
              <span className='auth-spark auth-spark-one' />
              <span className='auth-spark auth-spark-two' />
              <span className='auth-spark auth-spark-three' />
              <div className='auth-character-ground' />
              <div className='auth-character auth-character-violet'>
                <div className='auth-character-face'>
                  <span className='auth-character-eye' />
                  <span className='auth-character-eye' />
                  <span className='auth-character-smile' />
                </div>
              </div>
              <div className='auth-character auth-character-lilac'>
                <div className='auth-character-face'>
                  <span className='auth-character-eye' />
                  <span className='auth-character-eye' />
                  <span className='auth-character-smile' />
                </div>
              </div>
              <div className='auth-character auth-character-yellow'>
                <div className='auth-character-face'>
                  <span className='auth-character-eye' />
                  <span className='auth-character-eye' />
                  <span className='auth-character-smile' />
                </div>
              </div>
              <div className='auth-character auth-character-coral'>
                <div className='auth-character-face'>
                  <span className='auth-character-eye' />
                  <span className='auth-character-eye' />
                  <span className='auth-character-smile' />
                </div>
              </div>
            </div>

            <div className='auth-showcase-copy'>
              <p className='auth-showcase-eyebrow'>
                <span aria-hidden='true' />
                {t('Connect your ideas to intelligence')}
              </p>
              <h2>
                <span>{t('One API key')}</span>
                <span>{t('A world of possibilities')}</span>
              </h2>
              <p className='auth-showcase-description'>
                {t(
                  'Connect to GPT, Claude, and Gemini through one API. Less setup, more room to build.'
                )}
              </p>
            </div>
          </div>
          <div className='auth-showcase-providers' aria-hidden='true'>
            <span>GPT</span>
            <span>Claude</span>
            <span>Gemini</span>
            <span>DeepSeek</span>
          </div>
        </aside>
      </div>
    )
  }

  return (
    <div className='relative grid h-svh max-w-none'>
      <Link
        to='/'
        className='absolute top-4 left-4 z-10 flex items-center gap-2 transition-opacity hover:opacity-80 sm:top-8 sm:left-8'
      >
        <div className='relative h-8 w-8'>
          {loading ? (
            <Skeleton className='absolute inset-0 rounded-full' />
          ) : (
            <img
              src={logo}
              alt={t('Logo')}
              className='h-8 w-8 rounded-full object-cover'
            />
          )}
        </div>
        {loading ? (
          <Skeleton className='h-6 w-24' />
        ) : (
          <h1 className='text-xl font-medium'>{systemName}</h1>
        )}
      </Link>
      <div className='container flex items-center pt-16 sm:pt-0'>
        <div className='mx-auto flex w-full flex-col justify-center space-y-2 px-4 py-8 sm:w-[480px] sm:p-8'>
          {children}
        </div>
      </div>
    </div>
  )
}
