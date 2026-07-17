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
import { ArrowRight, Braces, Cpu, Network } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'

import type { HomepageSettings } from './types'

type HomepageReplacementProps = {
  settings: HomepageSettings
  systemName?: string
  logo?: string
}

export function HomepageReplacement(props: HomepageReplacementProps) {
  const { t } = useTranslation()
  const destination = props.settings.button_url || '/console'
  const buttonText = props.settings.button_text || t('Open Console')
  const isExternal = /^https?:\/\//i.test(destination)

  if (props.settings.mode === 'not_found') {
    return (
      <PublicLayout showMainContainer={false}>
        <main className='flex min-h-svh items-center justify-center px-6 pt-16'>
          <div className='max-w-xl text-center'>
            <div className='text-muted-foreground mb-5 font-mono text-sm'>
              HTTP / 404
            </div>
            <div className='text-foreground text-8xl leading-none font-bold'>
              404
            </div>
            <h1 className='mt-6 text-2xl font-semibold'>
              {props.settings.title || t('This page is not available')}
            </h1>
            <p className='text-muted-foreground mx-auto mt-3 max-w-md text-base leading-7'>
              {props.settings.description ||
                t('The public homepage has been closed by the administrator.')}
            </p>
            <Button
              className='mt-8 rounded-md'
              render={<a href={destination} />}
            >
              {buttonText}
              <ArrowRight />
            </Button>
          </div>
        </main>
      </PublicLayout>
    )
  }

  return (
    <PublicLayout showMainContainer={false}>
      <main className='bg-background relative flex min-h-svh items-center overflow-hidden px-6 pt-20'>
        <div
          aria-hidden='true'
          className='pointer-events-none absolute inset-0 opacity-60'
        >
          <div className='border-border absolute inset-y-0 left-[12%] border-l' />
          <div className='border-border absolute inset-y-0 left-[36%] border-l' />
          <div className='border-border absolute inset-y-0 right-[36%] border-l' />
          <div className='border-border absolute inset-y-0 right-[12%] border-l' />
          <div className='border-border absolute inset-x-0 top-[28%] border-t' />
          <div className='border-border absolute inset-x-0 bottom-[24%] border-t' />
          <div className='absolute top-[28%] left-[12%] size-2 -translate-x-1 -translate-y-1 bg-emerald-500' />
          <div className='absolute right-[12%] bottom-[24%] size-2 translate-x-1 translate-y-1 bg-cyan-500' />
          <div className='absolute top-[28%] right-[36%] h-px w-24 bg-red-500' />
        </div>

        <div className='relative mx-auto w-full max-w-5xl py-24 text-center'>
          <div className='mx-auto mb-7 flex size-16 items-center justify-center border'>
            {props.logo ? (
              <img src={props.logo} alt='' className='size-11 object-contain' />
            ) : (
              <Network className='size-8' aria-hidden='true' />
            )}
          </div>
          <div className='text-muted-foreground mb-5 flex items-center justify-center gap-3 font-mono text-xs uppercase'>
            <span className='size-1.5 bg-emerald-500' aria-hidden='true' />
            {t('Gateway Online')}
          </div>
          <h1 className='text-4xl font-bold sm:text-5xl md:text-6xl'>
            {props.systemName || 'New API'}
          </h1>
          <p className='text-foreground mx-auto mt-6 max-w-3xl text-xl font-medium sm:text-2xl'>
            {props.settings.title || t('One gateway. Every model.')}
          </p>
          <p className='text-muted-foreground mx-auto mt-4 max-w-2xl text-base leading-7'>
            {props.settings.description ||
              t(
                'A focused access point for your AI services, built for speed and reliability.'
              )}
          </p>
          <Button
            className='mt-9 rounded-md'
            render={
              <a
                href={destination}
                target={isExternal ? '_blank' : undefined}
                rel={isExternal ? 'noopener noreferrer' : undefined}
              />
            }
          >
            {buttonText}
            <ArrowRight />
          </Button>

          <div className='text-muted-foreground mx-auto mt-16 flex max-w-md items-center justify-between border-t pt-5'>
            <span className='flex items-center gap-2 text-xs'>
              <Braces className='size-4' aria-hidden='true' /> API
            </span>
            <span className='flex items-center gap-2 text-xs'>
              <Cpu className='size-4' aria-hidden='true' /> AI
            </span>
            <span className='flex items-center gap-2 text-xs'>
              <Network className='size-4' aria-hidden='true' /> Gateway
            </span>
          </div>
        </div>
      </main>
    </PublicLayout>
  )
}
