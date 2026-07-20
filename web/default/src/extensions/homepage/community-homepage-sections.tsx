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
  ArrowRight,
  Bot,
  Braces,
  CircleSlash2,
  ExternalLink,
  Gift,
  Grid2X2,
  Repeat2,
  ShieldCheck,
  SquareTerminal,
  UsersRound,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import { CommunityPrimaryAction } from './community-primary-action'
import type { HomepageSettings } from './types'

type CommunityHomepageSectionsProps = {
  systemName: string
  settings: HomepageSettings
  isAuthenticated: boolean
  registerEnabled: boolean
}

export function CommunityHomepageSections(
  props: CommunityHomepageSectionsProps
) {
  const { t } = useTranslation()
  const showCommunityLink = Boolean(
    props.settings.button_text.trim() && props.settings.button_url.trim()
  )
  const communityLinkIsExternal = /^https?:\/\//i.test(
    props.settings.button_url
  )
  const capabilities = [
    {
      icon: UsersRound,
      title: t('Community member access'),
      description: t('Shared AI access maintained for community members.'),
      tag: t('Community'),
    },
    {
      icon: SquareTerminal,
      title: t('Unified API relay'),
      description: t('OpenAI-compatible endpoints reduce integration work.'),
      tag: 'API',
    },
    {
      icon: Repeat2,
      title: t('Multi-model switching'),
      description: t('Use one account to explore different model families.'),
      tag: t('Shared'),
    },
  ]
  const features = [
    {
      icon: Gift,
      title: t('Community-focused access'),
      description: t(
        'Built around community participation rather than a commercial storefront.'
      ),
    },
    {
      icon: UsersRound,
      title: t('Shared community service'),
      description: t(
        'A friendly shared entry point for learning, testing, and small projects.'
      ),
    },
    {
      icon: CircleSlash2,
      title: t('No provider lock-in'),
      description: t(
        'Switch between model families without rebuilding each provider integration.'
      ),
    },
    {
      icon: Repeat2,
      title: t('Unified model relay'),
      description: t(
        'Connect to multiple model capabilities through one compatible endpoint.'
      ),
    },
    {
      icon: Braces,
      title: t('Developer Friendly'),
      description: t(
        'Useful for scripts, demos, bots, plugins, agents, and API learning.'
      ),
    },
    {
      icon: ShieldCheck,
      title: t('Responsible use'),
      description: t(
        'Use shared resources as needed and avoid abuse that affects other members.'
      ),
    },
  ]
  const modelChips = [
    'DeepSeek',
    t('OpenAI Compatible'),
    t('Claude style'),
    t('Gemini style'),
    'Qwen',
    'Kimi',
    'GLM',
    'Doubao',
    'Embedding',
    'Rerank',
    'TTS / STT',
    t('Image / Multimodal'),
  ]
  const topics = [
    {
      initials: 'AI',
      title: t('What is {{systemName}}?', { systemName: props.systemName }),
      description: t('Community access · Unified API · Usage guide'),
      badge: t('Overview'),
    },
    {
      initials: 'KEY',
      title: t('How do I create and use an API key?'),
      description: t('Account setup · Console · Secure credentials'),
      badge: t('Required'),
    },
    {
      initials: 'API',
      title: t('How do I connect an OpenAI-compatible client?'),
      description: t('Base URL · Model relay · Compatible clients'),
      badge: t('Docs'),
    },
  ]

  return (
    <>
      <section>
        <div className='head'>
          <h2>{t('Community access, not a commercial showcase')}</h2>
          <p>
            {t(
              'One entry point connects multiple models and reduces the cost of setup, configuration, and switching.'
            )}
          </p>
        </div>

        <div className='cols'>
          <div className='panel'>
            <h3>
              <Braces className='ico' aria-hidden='true' />
              {t('Project positioning')}
            </h3>
            <pre>
              {'{\n'}
              {'  '}
              <span className='k'>&quot;project&quot;</span>: &quot;
              {props.systemName}&quot;,{`\n`}
              {'  '}
              <span className='k'>&quot;type&quot;</span>: &quot;community
              relay&quot;,{`\n`}
              {'  '}
              <span className='k'>&quot;access&quot;</span>: &quot;shared&quot;,
              {`\n`}
              {'  '}
              <span className='k'>&quot;protocol&quot;</span>: &quot;OpenAI
              compatible&quot;{`\n`}
              {'}'}
            </pre>
          </div>

          <div className='panel'>
            <h3>
              <Grid2X2 className='ico' aria-hidden='true' />
              {t('Relay capabilities')}
            </h3>
            <div className='routes'>
              {capabilities.map((capability) => (
                <div className='route' key={capability.title}>
                  <span className='ic'>
                    <capability.icon className='ico' aria-hidden='true' />
                  </span>
                  <div>
                    <b>{capability.title}</b>
                    <span>{capability.description}</span>
                  </div>
                  <span className='tag'>{capability.tag}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className='stats'>
          <div className='stat'>
            <div className='n'>
              {t('Community')}
              <span>{t('Project')}</span>
            </div>
            <div className='l'>{t('Maintained for community members')}</div>
          </div>
          <div className='stat'>
            <div className='n'>
              {t('Shared')}
              <span>{t('Access')}</span>
            </div>
            <div className='l'>{t('One account and one API key')}</div>
          </div>
          <div className='stat'>
            <div className='n'>
              {t('Unified')}
              <span>API</span>
            </div>
            <div className='l'>{t('Lower model integration cost')}</div>
          </div>
          <div className='stat'>
            <div className='n'>
              {t('Multiple')}
              <span>{t('Models')}</span>
            </div>
            <div className='l'>{t('Suitable for learning and testing')}</div>
          </div>
        </div>
      </section>

      <section>
        <div className='head'>
          <h2>{t('What it is, and what it is not')}</h2>
          <p>
            {t(
              'A community-oriented AI relay rather than a model vendor. The focus is shared access, easy integration, and responsible use.'
            )}
          </p>
        </div>
        <div className='feat'>
          {features.map((feature) => (
            <article className='fc' key={feature.title}>
              <feature.icon className='ico' aria-hidden='true' />
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className='exchange'>
          <div className='left'>
            <h3>{t('How to get started')}</h3>
            <p>
              {t(
                'Create an account, enter the console, and generate an API key for your client.'
              )}
            </p>
          </div>
          <div className='steps'>
            <span className='s'>
              <span className='num'>1</span>
              {t('Create account')}
            </span>
            <span className='arr'>
              <ArrowRight className='ico' aria-hidden='true' />
            </span>
            <span className='s'>
              <span className='num'>2</span>
              {t('Open Console')}
            </span>
            <span className='arr'>
              <ArrowRight className='ico' aria-hidden='true' />
            </span>
            <span className='s'>
              <span className='num'>3</span>
              {t('Create API Key')}
            </span>
          </div>
        </div>
      </section>

      <section>
        <div className='head'>
          <h2>{t('Supported models')}</h2>
          <p>
            {t(
              'Switch models through one entry point for community learning, testing, and small projects.'
            )}
          </p>
        </div>
        <div className='chips'>
          <span className='chip on'>{t('Community access')}</span>
          <span className='chip on'>{t('Unified API relay')}</span>
          {modelChips.map((model) => (
            <span className='chip' key={model}>
              {model}
            </span>
          ))}
        </div>
      </section>

      <section>
        <div className='head'>
          <h2>{t('Frequently asked questions')}</h2>
        </div>
        <div className='topics'>
          {topics.map((topic) => (
            <article className='topic' key={topic.initials}>
              <span className='ic'>{topic.initials}</span>
              <div>
                <b>{topic.title}</b>
                <span>{topic.description}</span>
              </div>
              <span className='badge'>{topic.badge}</span>
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className='cta'>
          <div className='eyebrow'>
            <Bot className='ico' aria-hidden='true' />
            Community AI Relay
          </div>
          <h2>
            {t('Start with')} <em>{props.systemName}</em>{' '}
            {t('and build something useful')}
          </h2>
          <p>
            {t(
              'Community access · Unified API · Please use shared resources responsibly'
            )}
          </p>

          {showCommunityLink ? (
            <Button
              className='btn-w'
              render={
                <a
                  href={props.settings.button_url}
                  target={communityLinkIsExternal ? '_blank' : undefined}
                  rel='noreferrer'
                />
              }
            >
              {props.settings.button_text}
              {communityLinkIsExternal ? (
                <ExternalLink className='ico' aria-hidden='true' />
              ) : (
                <ArrowRight className='ico' aria-hidden='true' />
              )}
            </Button>
          ) : (
            <CommunityPrimaryAction
              isAuthenticated={props.isAuthenticated}
              registerEnabled={props.registerEnabled}
              label={t('Enter AI relay')}
              className='btn-w'
            />
          )}
        </div>
      </section>
    </>
  )
}
