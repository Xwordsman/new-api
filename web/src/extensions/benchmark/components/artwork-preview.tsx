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
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  WebPreview,
  WebPreviewBody,
} from '@/components/ai-elements/web-preview'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { cn } from '@/lib/utils'

import { getBenchmarkRun } from '../api'

// This is an opaque-origin sandbox. Do not add allow-same-origin, forms,
// popups, downloads or navigation permissions for model-generated documents.
const policy =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"

export function ArtworkPreview(props: {
  output: string
  paused: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const document = useMemo(
    () =>
      `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;min-height:100%;overflow:hidden}svg{max-width:100%}</style></head><body>${props.output}</body></html>`,
    [props.output]
  )
  if (props.paused) {
    // Unmounting stops JavaScript as well as CSS/SMIL animations.
    return (
      <div
        className={cn(
          'bg-muted text-muted-foreground flex min-h-40 items-center justify-center rounded-lg text-sm',
          props.className
        )}
      >
        {t('Preview paused')}
      </div>
    )
  }
  return (
    <WebPreview className={cn('overflow-hidden', props.className)}>
      <WebPreviewBody
        title={t('SVG artwork preview')}
        srcDoc={document}
        sandbox='allow-scripts'
        referrerPolicy='no-referrer'
        allow=''
      />
    </WebPreview>
  )
}

export function SavedArtwork(props: {
  id: number
  paused: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [nearViewport, setNearViewport] = useState(false)
  useEffect(() => {
    if (props.paused || container == null) {
      setNearViewport(false)
      return
    }
    if (typeof IntersectionObserver === 'undefined') {
      setNearViewport(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        setNearViewport(entry?.isIntersecting ?? false)
      },
      { rootMargin: '200px' }
    )
    observer.observe(container)
    return () => observer.disconnect()
  }, [container, props.paused])
  const query = useQuery({
    queryKey: ['benchmark', 'run', props.id],
    queryFn: () => getBenchmarkRun(props.id),
    enabled: nearViewport && !props.paused,
    staleTime: Infinity,
  })
  if (props.paused) {
    return <ArtworkPreview output='' paused className={props.className} />
  }
  if (!nearViewport) {
    return (
      <div
        ref={setContainer}
        className={cn('min-h-40', props.className)}
        aria-label={t('SVG artwork preview')}
      />
    )
  }
  if (query.isPending) {
    return (
      <div ref={setContainer} className={cn('min-h-40', props.className)}>
        <LoadingState className='min-h-40' />
      </div>
    )
  }
  if (query.isError) {
    return (
      <div ref={setContainer} className={props.className}>
        <ErrorState className='min-h-40' onRetry={() => void query.refetch()} />
      </div>
    )
  }
  if (!query.data.output) {
    return (
      <div ref={setContainer} className={props.className}>
        <EmptyState className='min-h-40' />
      </div>
    )
  }
  return (
    <div ref={setContainer} className={props.className}>
      <ArtworkPreview
        output={query.data.output}
        paused={false}
        className='h-full min-h-40'
      />
    </div>
  )
}
