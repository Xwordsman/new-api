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

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Markdown } from '@/components/ui/markdown'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatTimestamp } from '@/lib/format'

import { getBenchmarkRun } from '../api'
import { useRunStatuses } from '../hooks/use-run-statuses'
import { ArtworkPreview } from './artwork-preview'

// Inline results and the enlarged dialog share the same saved data and controls.
export function RunResult(props: {
  id: number
  inline?: boolean
  paused: boolean
  onOpen?: (id: number) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const statuses = useRunStatuses()
  const query = useQuery({
    queryKey: ['benchmark', 'run', props.id],
    queryFn: () => getBenchmarkRun(props.id),
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 5000 : false),
  })
  if (query.isPending) return <LoadingState className='min-h-32' />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  const run = query.data
  return (
    <article className='benchmark-result min-w-0 space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h3 className='text-sm font-semibold'>
          {run.kind === 'candy' ? t('Candy logic') : t('SVG drawing')}
        </h3>
        <StatusBadge {...statuses[run.status]} copyable={false} />
      </div>
      <p className='text-muted-foreground font-mono text-[11px] break-all'>
        {run.group} · {run.model} · {formatTimestamp(run.created_at)}
      </p>
      {run.kind === 'candy' && (
        <>
          {props.inline && (
            <section className='benchmark-prompt'>
              <Markdown>{run.prompt}</Markdown>
            </section>
          )}
          <dl className='bg-muted/30 grid grid-cols-2 gap-4 rounded-sm border p-3'>
            <div>
              <dt className='text-muted-foreground text-xs'>
                {t('Expected answer')}
              </dt>
              <dd className='mt-1 font-mono text-xl break-all'>
                {run.expected || '—'}
              </dd>
            </div>
            <div>
              <dt className='text-muted-foreground text-xs'>
                {t('Actual answer')}
              </dt>
              <dd className='mt-1 max-h-40 overflow-auto font-mono text-xl break-all whitespace-pre-wrap'>
                {run.output || '—'}
              </dd>
            </div>
          </dl>
        </>
      )}
      {run.kind === 'svg' && run.output && (
        <section className='space-y-2'>
          <ArtworkPreview
            output={run.output}
            paused={props.paused}
            className={
              props.inline ? 'aspect-[4/3] w-full' : 'h-[min(60vh,560px)]'
            }
          />
          <p className='text-sm font-medium'>{run.prompt_name}</p>
        </section>
      )}
      <dl className='flex flex-wrap gap-x-5 gap-y-2 text-xs'>
        <div>
          <dt className='text-muted-foreground'>{t('Latency')}</dt>
          <dd className='mt-1 font-mono'>
            {formatNumber(run.latency_ms / 1000, locale)} s
          </dd>
        </div>
        <div>
          <dt className='text-muted-foreground'>{t('Input tokens')}</dt>
          <dd className='mt-1 font-mono'>
            {formatNumber(run.input_tokens, locale)}
          </dd>
        </div>
        <div>
          <dt className='text-muted-foreground'>{t('Output tokens')}</dt>
          <dd className='mt-1 font-mono'>
            {formatNumber(run.output_tokens, locale)}
          </dd>
        </div>
      </dl>
      {run.manual && (
        <p className='text-muted-foreground text-xs'>{t('Manual retest')}</p>
      )}
      {props.inline ? (
        <Button
          size='sm'
          variant='link'
          className='h-auto p-0'
          onClick={() => props.onOpen?.(run.id)}
        >
          {t('View details')}
        </Button>
      ) : (
        <>
          <section className='space-y-2'>
            <div className='flex items-center justify-between'>
              <h3 className='text-sm font-medium'>{t('Saved prompt')}</h3>
              <CopyButton value={run.prompt} aria-label={t('Copy prompt')} />
            </div>
            <pre className='bg-muted/50 max-h-60 overflow-auto rounded-lg border p-4 font-mono text-xs break-words whitespace-pre-wrap'>
              {run.prompt}
            </pre>
          </section>
          <section className='space-y-2'>
            <div className='flex items-center justify-between'>
              <h3 className='text-sm font-medium'>{t('Raw output')}</h3>
              <CopyButton value={run.output} aria-label={t('Copy output')} />
            </div>
            <pre className='bg-muted/50 max-h-64 overflow-auto rounded-lg border p-4 font-mono text-xs break-words whitespace-pre-wrap'>
              {run.output || '—'}
            </pre>
          </section>
        </>
      )}
      <p className='text-muted-foreground text-xs leading-5'>
        {t(
          'A group probe samples one routed channel. A passed check does not prove model identity or overall intelligence.'
        )}
      </p>
    </article>
  )
}

export function RunDetail(props: { id: number; onClose: () => void }) {
  const { t } = useTranslation()
  const [paused, setPaused] = useState(false)
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={t('Benchmark result')}
      contentClassName='sm:max-w-5xl'
      bodyClassName='space-y-5'
    >
      <Button variant='outline' size='sm' onClick={() => setPaused(!paused)}>
        {paused ? t('Resume previews') : t('Pause previews')}
      </Button>
      <RunResult id={props.id} paused={paused} />
    </Dialog>
  )
}
