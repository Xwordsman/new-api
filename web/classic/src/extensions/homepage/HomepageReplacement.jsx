/*
Copyright (C) 2025 QuantumNous

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
import React, { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import NightSky from './NightSky';

const HomepageReplacement = ({ settings }) => {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const previousTitle = document.title;
    const favicon = document.querySelector("link[rel~='icon']");
    const previousFavicon = favicon?.href;
    const facadeTitle = t('午夜档案');
    const blankFavicon =
      'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
    const applyFacadeMetadata = () => {
      if (document.title !== facadeTitle) document.title = facadeTitle;
      const currentFavicon = document.querySelector("link[rel~='icon']");
      if (currentFavicon?.href !== blankFavicon) {
        currentFavicon?.setAttribute('href', blankFavicon);
      }
    };
    const observer = new MutationObserver(applyFacadeMetadata);
    observer.observe(document.head, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    applyFacadeMetadata();

    return () => {
      observer.disconnect();
      document.title = previousTitle;
      if (favicon && previousFavicon) favicon.href = previousFavicon;
    };
  }, [t]);

  const isNotFound = settings.mode === 'not_found';
  const title = isNotFound
    ? settings.title || t('这里只剩下星光。')
    : settings.title || t('今晚，风从很远的地方来。');
  const description = isNotFound
    ? settings.description || t('这条路径已经漂出了地图。')
    : settings.description || t('请把声音调低一点，星星正在经过。');
  const showButton = Boolean(
    settings.button_text.trim() && settings.button_url.trim(),
  );
  const isExternal = /^https?:\/\//i.test(settings.button_url);

  return (
    <main className='relative isolate min-h-screen overflow-hidden bg-[#061018] text-[#f3efe3]'>
      <NightSky />
      <div className='absolute inset-0 bg-[#061018]/20' aria-hidden='true' />

      <div className='relative z-10 flex min-h-screen flex-col justify-between px-5 py-6 sm:px-8 sm:py-8 lg:px-12 lg:py-10'>
        <header className='flex items-center justify-between border-b border-white/15 pb-4 font-mono text-[11px] uppercase text-white/60 sm:text-xs'>
          <span>{t('午夜档案')}</span>
          <time dateTime={now.toISOString()}>
            {now.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })}
          </time>
        </header>

        <section className='w-full max-w-5xl py-16 sm:py-20'>
          <p className='mb-6 font-mono text-xs uppercase text-cyan-200/75 sm:text-sm'>
            {isNotFound ? '404 / OFF MAP' : 'NIGHT LOG / 07'}
          </p>
          <h1 className='max-w-[14ch] text-4xl font-medium leading-[1.1] sm:text-6xl lg:text-7xl'>
            {title}
          </h1>
          <p className='mt-7 max-w-xl text-base leading-7 text-white/65 sm:text-lg sm:leading-8'>
            {description}
          </p>

          {showButton && (
            <a
              href={settings.button_url}
              target={isExternal ? '_blank' : undefined}
              rel={isExternal ? 'noopener noreferrer' : undefined}
              className='mt-9 inline-flex h-10 items-center gap-2 rounded-md border border-white/25 bg-black/20 px-4 text-sm text-white transition-colors hover:border-white/50 hover:bg-black/40'
            >
              {settings.button_text}
              <ArrowUpRight size={16} aria-hidden='true' />
            </a>
          )}
        </section>

        <footer className='flex flex-wrap items-center justify-between gap-3 border-t border-white/15 pt-4 font-mono text-[10px] uppercase text-white/45 sm:text-xs'>
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
  );
};

export default HomepageReplacement;
