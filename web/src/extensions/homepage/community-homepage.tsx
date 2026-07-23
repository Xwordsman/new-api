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
import { BookOpen, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import type { SystemStatus } from '@/features/auth/types'
import { useSystemConfig } from '@/hooks/use-system-config'

import './community-homepage.css'
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
  const { systemName } = useSystemConfig()
  const registerEnabled = props.status?.register_enabled !== false
  const docsURL =
    typeof props.status?.docs_link === 'string' && props.status.docs_link
      ? props.status.docs_link
      : 'https://docs.newapi.pro'
  const showCommunityLink = Boolean(
    props.settings.button_text.trim() && props.settings.button_url.trim()
  )
  const communityLinkIsExternal = /^https?:\/\//i.test(
    props.settings.button_url
  )
  const description =
    props.settings.description ||
    t(
      'A community-supported AI model relay. Use one compatible API to access multiple models without complex setup.'
    )

  return (
    <main className='overflow-x-hidden bg-white text-[#23201a]'>
      <div className='container mx-auto py-8'>
        <div className='community-homepage'>
          <div className='w'>
            <header className='hero'>
              <div className='tagrow'>
                <span className='dot' aria-hidden='true' />
                <b>
                  {t('{{systemName}} community project', { systemName })}
                </b> ·{' '}
                {t('Community AI relay')}
              </div>

              {props.settings.title ? (
                <h1>{props.settings.title}</h1>
              ) : (
                <h1>
                  {t('For {{systemName}} community members', { systemName })}
                  <u>{t('Public-benefit AI relay')}</u>
                </h1>
              )}

              <p className='lead'>{description}</p>

              <div className='btns'>
                {showCommunityLink ? (
                  <Button
                    className='btn btn-p'
                    render={
                      <a
                        href={props.settings.button_url}
                        target={communityLinkIsExternal ? '_blank' : undefined}
                        rel='noreferrer'
                      />
                    }
                  >
                    <ExternalLink className='ico' aria-hidden='true' />
                    {props.settings.button_text}
                  </Button>
                ) : (
                  <CommunityPrimaryAction
                    isAuthenticated={props.isAuthenticated}
                    registerEnabled={registerEnabled}
                    label={t('Enter AI relay')}
                    className='btn btn-p'
                  />
                )}

                {showCommunityLink ? (
                  <CommunityPrimaryAction
                    isAuthenticated={props.isAuthenticated}
                    registerEnabled={registerEnabled}
                    label={t('Enter AI relay')}
                    className='btn btn-s'
                  />
                ) : (
                  <Button
                    className='btn btn-s'
                    render={
                      <a
                        href={docsURL}
                        target={
                          docsURL.startsWith('http') ? '_blank' : undefined
                        }
                        rel='noreferrer'
                      />
                    }
                  >
                    <BookOpen className='ico' aria-hidden='true' />
                    {t('Docs')}
                  </Button>
                )}
              </div>
            </header>

            <CommunityHomepageSections
              systemName={systemName}
              settings={props.settings}
              isAuthenticated={props.isAuthenticated}
              registerEnabled={registerEnabled}
            />
          </div>
        </div>
      </div>
    </main>
  )
}
