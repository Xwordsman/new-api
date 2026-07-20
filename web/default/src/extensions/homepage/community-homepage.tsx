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
import { BookOpen, CheckCircle2, ExternalLink, UsersRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import type { SystemStatus } from '@/features/auth/types'
import { useSystemConfig } from '@/hooks/use-system-config'

import { CommunityHomepageSections } from './community-homepage-sections'
import { CommunityPrimaryAction } from './community-primary-action'
import type { HomepageSettings } from './types'

type CommunityHomepageProps = {
  settings: HomepageSettings
  status: SystemStatus | null
  isAuthenticated: boolean
}

export function CommunityHomepage(props: CommunityHomepageProps) {
  const { t } = useTranslation()
  const { logo, systemName } = useSystemConfig()
  const registerEnabled = props.status?.register_enabled !== false
  const docsURL =
    typeof props.status?.docs_link === 'string' && props.status.docs_link
      ? props.status.docs_link
      : 'https://docs.newapi.pro'
  const serverAddress =
    typeof props.status?.server_address === 'string' &&
    props.status.server_address
      ? props.status.server_address.replace(/\/$/, '')
      : window.location.origin
  const title =
    props.settings.title || t('{{systemName}} Community AI Hub', { systemName })
  const description =
    props.settings.description ||
    t(
      'Shared AI access for learning, prototypes, bots, agents, and projects built by the community.'
    )
  const showCommunityLink = Boolean(
    props.settings.button_text.trim() && props.settings.button_url.trim()
  )
  const communityLinkIsExternal = /^https?:\/\//i.test(
    props.settings.button_url
  )

  return (
    <main>
      <section className='border-border border-b px-6 pt-28 pb-20 md:pt-36 md:pb-24'>
        <div className='mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16'>
          <div>
            <div className='inline-flex items-center gap-2 rounded-full border border-emerald-600/25 bg-emerald-500/8 px-3 py-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-300'>
              <UsersRound className='size-3.5' aria-hidden='true' />
              {t('Community access')}
            </div>

            <h1 className='mt-6 max-w-[15ch] text-4xl leading-[1.08] font-semibold text-balance [overflow-wrap:anywhere] sm:text-5xl lg:text-6xl'>
              {title}
            </h1>
            <p className='text-muted-foreground mt-6 max-w-2xl text-base leading-7 sm:text-lg sm:leading-8'>
              {description}
            </p>

            <div className='mt-8 flex flex-wrap items-center gap-3'>
              <CommunityPrimaryAction
                isAuthenticated={props.isAuthenticated}
                registerEnabled={registerEnabled}
                className='h-11 px-5'
              />

              {showCommunityLink && (
                <Button
                  variant='outline'
                  className='min-h-11 max-w-full px-5 py-2 [overflow-wrap:anywhere] whitespace-normal'
                  render={
                    <a
                      href={props.settings.button_url}
                      target={communityLinkIsExternal ? '_blank' : undefined}
                      rel='noreferrer'
                    />
                  }
                >
                  {props.settings.button_text}
                  {communityLinkIsExternal && (
                    <ExternalLink className='size-4' aria-hidden='true' />
                  )}
                </Button>
              )}

              <Button
                variant='ghost'
                className='h-11 px-4'
                render={
                  <a
                    href={docsURL}
                    target={docsURL.startsWith('http') ? '_blank' : undefined}
                    rel='noreferrer'
                  />
                }
              >
                <BookOpen className='size-4' aria-hidden='true' />
                {t('Docs')}
              </Button>
            </div>
          </div>

          <div className='border-border bg-card min-w-0 overflow-hidden rounded-lg border shadow-sm'>
            <div className='border-border flex items-center justify-between border-b px-5 py-4'>
              <div className='flex min-w-0 items-center gap-3'>
                <img
                  src={logo}
                  alt=''
                  className='size-8 shrink-0 rounded-md object-contain'
                />
                <div className='min-w-0'>
                  <p className='truncate text-sm font-semibold'>{systemName}</p>
                  <p className='text-muted-foreground text-xs'>
                    {t('OpenAI-compatible endpoint')}
                  </p>
                </div>
              </div>
              <span className='text-muted-foreground bg-muted rounded-md px-2 py-1 font-mono text-[11px]'>
                POST
              </span>
            </div>

            <div className='bg-[#101411] px-5 py-6 font-mono text-xs leading-6 text-[#d9e2dc] sm:px-6 sm:text-sm'>
              <p className='text-[#7ed9a7]'>/v1/chat/completions</p>
              <div className='mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2'>
                <span className='text-[#829188]'>base_url</span>
                <span className='min-w-0 truncate text-[#f3f5f4]'>
                  {serverAddress}
                </span>
                <span className='text-[#829188]'>model</span>
                <span className='text-[#f3f5f4]'>your-model</span>
                <span className='text-[#829188]'>messages</span>
                <span className='text-[#f3f5f4]'>[{'{ ... }'}]</span>
              </div>
            </div>

            <div className='flex items-center gap-2 px-5 py-4 text-sm'>
              <CheckCircle2
                className='size-4 text-emerald-600 dark:text-emerald-400'
                aria-hidden='true'
              />
              <span>{t('One endpoint, many models')}</span>
            </div>
          </div>
        </div>
      </section>

      <CommunityHomepageSections
        isAuthenticated={props.isAuthenticated}
        registerEnabled={registerEnabled}
      />
    </main>
  )
}
