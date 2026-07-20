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
import {
  Bot,
  Braces,
  FlaskConical,
  KeyRound,
  MessageSquareText,
  Route,
  ShieldCheck,
  UsersRound,
  Waypoints,
  Workflow,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import { CommunityPrimaryAction } from './community-primary-action'

type CommunityHomepageSectionsProps = {
  isAuthenticated: boolean
  registerEnabled: boolean
}

export function CommunityHomepageSections(
  props: CommunityHomepageSectionsProps
) {
  const { t } = useTranslation()
  const benefits = [
    {
      icon: UsersRound,
      title: t('Shared community access'),
      description: t(
        'Explore capable AI models through a service maintained for community members.'
      ),
      iconClass: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    },
    {
      icon: Waypoints,
      title: t('One compatible API'),
      description: t(
        'Use one familiar endpoint across models instead of maintaining separate provider integrations.'
      ),
      iconClass: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
    },
    {
      icon: FlaskConical,
      title: t('Learning-friendly by design'),
      description: t(
        'A practical place to learn, evaluate ideas, and turn small experiments into useful tools.'
      ),
      iconClass: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    },
  ]
  const steps = [
    {
      icon: UsersRound,
      title: t('Create your account'),
      description: t(
        'Join with the registration method enabled by the community.'
      ),
    },
    {
      icon: KeyRound,
      title: t('Generate an API key'),
      description: t('Create a key in the console and keep it private.'),
    },
    {
      icon: Route,
      title: t('Choose a model'),
      description: t(
        'Select a model that fits your task, budget, and context.'
      ),
    },
    {
      icon: MessageSquareText,
      title: t('Send your first request'),
      description: t('Connect a compatible client or call the API directly.'),
    },
  ]
  const useCases = [
    {
      icon: Bot,
      title: t('Community bots'),
      description: t(
        'Build assistants that answer questions and support community conversations.'
      ),
    },
    {
      icon: Workflow,
      title: t('Agents and workflows'),
      description: t(
        'Connect models to tools and automate useful multi-step tasks.'
      ),
    },
    {
      icon: Braces,
      title: t('Prototypes'),
      description: t(
        'Validate an idea quickly before committing to a larger implementation.'
      ),
    },
    {
      icon: FlaskConical,
      title: t('Learning and evaluation'),
      description: t(
        'Compare model behavior and learn modern AI application patterns.'
      ),
    },
  ]

  return (
    <>
      <section className='border-border border-b px-6 py-20 md:py-24'>
        <div className='mx-auto max-w-6xl'>
          <div className='max-w-2xl'>
            <p className='text-sm font-medium text-emerald-700 dark:text-emerald-400'>
              {t('Built for community use')}
            </p>
            <h2 className='mt-3 text-3xl leading-tight font-semibold sm:text-4xl'>
              {t('A simpler way to explore and build with AI')}
            </h2>
            <p className='text-muted-foreground mt-5 text-base leading-7'>
              {t(
                'The gateway handles provider differences so community members can focus on learning, creating, and sharing useful work.'
              )}
            </p>
          </div>

          <div className='mt-12 grid gap-4 md:grid-cols-3'>
            {benefits.map((benefit) => (
              <article
                key={benefit.title}
                className='border-border bg-card rounded-lg border p-6'
              >
                <div
                  className={`flex size-10 items-center justify-center rounded-md ${benefit.iconClass}`}
                >
                  <benefit.icon className='size-5' aria-hidden='true' />
                </div>
                <h3 className='mt-5 text-lg font-semibold'>{benefit.title}</h3>
                <p className='text-muted-foreground mt-3 text-sm leading-6'>
                  {benefit.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className='bg-muted/35 border-border border-b px-6 py-20 md:py-24'>
        <div className='mx-auto max-w-6xl'>
          <div className='flex flex-col justify-between gap-5 md:flex-row md:items-end'>
            <div className='max-w-2xl'>
              <p className='text-sm font-medium text-sky-700 dark:text-sky-400'>
                {t('From account to first request')}
              </p>
              <h2 className='mt-3 text-3xl leading-tight font-semibold sm:text-4xl'>
                {t('Start in four clear steps')}
              </h2>
            </div>
            <Button variant='outline' render={<Link to='/pricing' />}>
              {t('View Models')}
            </Button>
          </div>

          <ol className='border-border mt-12 grid border-t md:grid-cols-4'>
            {steps.map((step, index) => (
              <li
                key={step.title}
                className='border-border border-b py-7 md:border-r md:border-b-0 md:px-6 md:first:pl-0 md:last:border-r-0 md:last:pr-0'
              >
                <div className='flex items-center justify-between'>
                  <step.icon
                    className='text-muted-foreground size-5'
                    aria-hidden='true'
                  />
                  <span className='text-muted-foreground text-xs font-medium'>
                    0{index + 1}
                  </span>
                </div>
                <h3 className='mt-8 font-semibold'>{step.title}</h3>
                <p className='text-muted-foreground mt-2 text-sm leading-6'>
                  {step.description}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className='border-border border-b px-6 py-20 md:py-24'>
        <div className='mx-auto grid max-w-6xl gap-12 lg:grid-cols-[0.8fr_1.2fr]'>
          <div>
            <p className='text-sm font-medium text-amber-700 dark:text-amber-400'>
              {t('Made for useful experiments')}
            </p>
            <h2 className='mt-3 text-3xl leading-tight font-semibold sm:text-4xl'>
              {t('Turn an idea into something the community can use')}
            </h2>
          </div>

          <div className='border-border border-t'>
            {useCases.map((useCase) => (
              <article
                key={useCase.title}
                className='border-border grid gap-4 border-b py-6 sm:grid-cols-[auto_1fr] sm:gap-5'
              >
                <useCase.icon
                  className='mt-0.5 size-5 text-emerald-700 dark:text-emerald-400'
                  aria-hidden='true'
                />
                <div>
                  <h3 className='font-semibold'>{useCase.title}</h3>
                  <p className='text-muted-foreground mt-2 text-sm leading-6'>
                    {useCase.description}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className='px-6 py-20 md:py-24'>
        <div className='border-border mx-auto flex max-w-6xl flex-col gap-6 border-y py-10 md:flex-row md:items-center md:justify-between'>
          <div className='flex max-w-3xl gap-4'>
            <ShieldCheck
              className='mt-1 size-6 shrink-0 text-emerald-700 dark:text-emerald-400'
              aria-hidden='true'
            />
            <div>
              <h2 className='text-xl font-semibold'>
                {t('Shared access depends on responsible use')}
              </h2>
              <p className='text-muted-foreground mt-3 text-sm leading-6'>
                {t(
                  'Keep credentials private, follow community rules, and avoid automated abuse so the service remains useful for everyone.'
                )}
              </p>
            </div>
          </div>

          <CommunityPrimaryAction
            isAuthenticated={props.isAuthenticated}
            registerEnabled={props.registerEnabled}
            className='shrink-0'
          />
        </div>
      </section>
    </>
  )
}
