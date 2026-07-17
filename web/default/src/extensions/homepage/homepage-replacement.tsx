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
import { ArrowUpRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { NightSky } from './night-sky'
import type { HomepageSettings } from './types'

type HomepageReplacementProps = {
  settings: HomepageSettings
}

export function HomepageReplacement(props: HomepageReplacementProps) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const previousTitle = document.title
    const favicon = document.querySelector<HTMLLinkElement>("link[rel~='icon']")
    const previousFavicon = favicon?.href
    const facadeTitle = t('Midnight Archive')
    const blankFavicon =
      'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
    const applyFacadeMetadata = () => {
      if (document.title !== facadeTitle) document.title = facadeTitle
      const currentFavicon =
        document.querySelector<HTMLLinkElement>("link[rel~='icon']")
      if (currentFavicon?.href !== blankFavicon) {
        currentFavicon?.setAttribute('href', blankFavicon)
      }
    }
    const observer = new MutationObserver(applyFacadeMetadata)
    observer.observe(document.head, {
      attributes: true,
      childList: true,
      subtree: true,
    })
    applyFacadeMetadata()

    return () => {
      observer.disconnect()
      document.title = previousTitle
      if (favicon && previousFavicon) favicon.href = previousFavicon
    }
  }, [t])

  const isNotFound = props.settings.mode === 'not_found'
  const title = isNotFound
    ? props.settings.title || t('Nothing here but starlight.')
    : props.settings.title ||
      t('Tonight, the wind comes from somewhere far away.')
  const description = isNotFound
    ? props.settings.description || t('This path drifted beyond the map.')
    : props.settings.description ||
      t('Turn the volume down. The stars are passing by.')
  const showButton = Boolean(
    props.settings.button_text.trim() && props.settings.button_url.trim()
  )
  const isExternal = /^https?:\/\//i.test(props.settings.button_url)

  return (
    <main className='relative isolate min-h-svh overflow-hidden bg-[#061018] text-[#f3efe3]'>
      <NightSky />
      <div className='absolute inset-0 bg-[#061018]/20' aria-hidden='true' />

      <div className='relative z-10 flex min-h-svh flex-col justify-between px-5 py-6 sm:px-8 sm:py-8 lg:px-12 lg:py-10'>
        <header className='flex items-center justify-between border-b border-white/15 pb-4 font-mono text-[11px] text-white/60 uppercase sm:text-xs'>
          <span>{t('Midnight Archive')}</span>
          <time dateTime={now.toISOString()}>
            {now.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })}
          </time>
        </header>

        <section className='w-full max-w-5xl py-16 sm:py-20'>
          <p className='mb-6 font-mono text-xs text-cyan-200/75 uppercase sm:text-sm'>
            {isNotFound ? '404 / OFF MAP' : 'NIGHT LOG / 07'}
          </p>
          <h1 className='max-w-[14ch] text-4xl leading-[1.1] font-medium text-balance sm:text-6xl lg:text-7xl'>
            {title}
          </h1>
          <p className='mt-7 max-w-xl text-base leading-7 text-white/65 sm:text-lg sm:leading-8'>
            {description}
          </p>

          {showButton && (
            <a
              href={props.settings.button_url}
              target={isExternal ? '_blank' : undefined}
              rel={isExternal ? 'noopener noreferrer' : undefined}
              className='mt-9 inline-flex h-10 items-center gap-2 rounded-md border border-white/25 bg-black/20 px-4 text-sm text-white transition-colors hover:border-white/50 hover:bg-black/40'
            >
              {props.settings.button_text}
              <ArrowUpRight className='size-4' aria-hidden='true' />
            </a>
          )}
        </section>

        <footer className='flex flex-wrap items-center justify-between gap-3 border-t border-white/15 pt-4 font-mono text-[10px] text-white/45 uppercase sm:text-xs'>
          <span>N 77° 07' / NIGHT WATCH</span>
          <span>
            FIELD NOTES /{' '}
            {now.toLocaleDateString([], {
              month: 'short',
              day: '2-digit',
              year: 'numeric',
            })}
          </span>
        </footer>
      </div>
    </main>
  )
}
