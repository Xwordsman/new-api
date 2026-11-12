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
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from '@/components/ui/pagination'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatTimestamp } from '@/lib/format'

import { getBenchmarkArtworks } from '../api'
import { SavedArtwork } from './artwork-preview'

export function ArtworkGallery(props: {
  group: string
  paused: boolean
  automatic: boolean
  onOpen: (id: number) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ['benchmark', 'artworks', props.group, page],
    queryFn: () => getBenchmarkArtworks(page, props.group),
    refetchInterval: props.automatic ? 15000 : false,
  })
  const data = query.data
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 15))
  return (
    <section className='mt-5 space-y-4' aria-label={t('SVG artwork gallery')}>
      <div className='flex items-center justify-between gap-3'>
        <h2 className='text-base font-semibold'>{t('SVG artwork gallery')}</h2>
        <span className='text-muted-foreground text-xs'>
          {t('{{count}} artworks', { count: data?.total ?? 0 })}
        </span>
      </div>
      {query.isPending && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {data?.items.length === 0 && (
        <EmptyState
          title={t('No SVG artwork yet')}
          description={t('Completed SVG checks will appear here.')}
        />
      )}
      {data && (
        <>
          <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
            {data.items.map((item) => (
              <article
                key={item.id}
                data-console-tone='chart-4'
                className='console-surface bg-card min-w-0 overflow-hidden rounded-xl border'
              >
                <SavedArtwork
                  id={item.id}
                  paused={props.paused}
                  className='pointer-events-none h-52 rounded-none border-0'
                />
                <div className='space-y-2 border-t p-3'>
                  <Button
                    variant='link'
                    className='h-auto w-full justify-start px-0 text-sm'
                    onClick={() => props.onOpen(item.id)}
                  >
                    <span className='truncate'>
                      {item.prompt_name || t('View artwork')}
                    </span>
                  </Button>
                  <p className='text-muted-foreground truncate font-mono text-xs'>
                    {item.group} · {item.model}
                  </p>
                  <div className='text-muted-foreground flex justify-between text-xs'>
                    <span>{formatTimestamp(item.created_at)}</span>
                    <span>
                      {formatNumber(item.latency_ms / 1000, locale)} s
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <Pagination aria-label={t('Artwork pages')}>
            <PaginationContent>
              <PaginationItem>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={page <= 1 || query.isFetching}
                  onClick={() => setPage(page - 1)}
                >
                  {t('Previous')}
                </Button>
              </PaginationItem>
              <PaginationItem className='px-3 text-xs tabular-nums'>
                {formatNumber(page, locale)} / {formatNumber(pages, locale)}
              </PaginationItem>
              <PaginationItem>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={page >= pages || query.isFetching}
                  onClick={() => setPage(page + 1)}
                >
                  {t('Next')}
                </Button>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </>
      )}
    </section>
  )
}
