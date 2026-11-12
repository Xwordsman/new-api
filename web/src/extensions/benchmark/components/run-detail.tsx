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
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatTimestamp } from '@/lib/format'

import { getBenchmarkRun } from '../api'
import { useRunStatuses } from '../hooks/use-run-statuses'
import { ArtworkPreview } from './artwork-preview'

export function RunDetail(props: { id: number; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const statuses = useRunStatuses()
  const [paused, setPaused] = useState(false)
  const query = useQuery({
    queryKey: ['benchmark', 'run', props.id],
    queryFn: () => getBenchmarkRun(props.id),
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 5000 : false),
  })
  const run = query.data
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={t('Benchmark result')}
      description={
        run &&
        `${run.group} · ${run.model} · ${formatTimestamp(run.created_at)}`
      }
      contentClassName='sm:max-w-5xl'
      bodyClassName='space-y-5'
    >
      {query.isPending && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {run && (
        <>
          <div className='flex flex-wrap items-center gap-x-5 gap-y-2 text-sm'>
            <StatusBadge {...statuses[run.status]} copyable={false} />
            <span>
              {run.kind === 'candy' ? t('Candy logic') : t('SVG drawing')}
            </span>
            <span>
              {t('Latency')}: {formatNumber(run.latency_ms / 1000, locale)} s
            </span>
            <span>
              {t('Input tokens')}: {formatNumber(run.input_tokens, locale)}
            </span>
            <span>
              {t('Output tokens')}: {formatNumber(run.output_tokens, locale)}
            </span>
            {run.manual && (
              <span className='text-muted-foreground'>
                {t('Manual retest')}
              </span>
            )}
          </div>
          {run.kind === 'candy' && (
            <div className='bg-muted/50 grid gap-4 rounded-lg border p-4 sm:grid-cols-2'>
              <div>
                <p className='text-muted-foreground mb-1 text-xs'>
                  {t('Expected answer')}
                </p>
                <p className='font-mono text-xl break-all'>{run.expected}</p>
              </div>
              <div>
                <p className='text-muted-foreground mb-1 text-xs'>
                  {t('Actual answer')}
                </p>
                <p className='font-mono text-xl break-all'>
                  {run.output || '—'}
                </p>
              </div>
            </div>
          )}
          {run.kind === 'svg' && run.output && (
            <section className='space-y-3'>
              <div className='flex items-center justify-between gap-3'>
                <h3 className='text-sm font-medium'>{run.prompt_name}</h3>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => setPaused(!paused)}
                >
                  {paused ? t('Resume previews') : t('Pause previews')}
                </Button>
              </div>
              <ArtworkPreview
                output={run.output}
                paused={paused}
                className='h-[min(60vh,560px)]'
              />
            </section>
          )}
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
          <p className='text-muted-foreground text-xs'>
            {t(
              'A group probe samples one routed channel. A passed check does not prove model identity or overall intelligence.'
            )}
          </p>
        </>
      )}
    </Dialog>
  )
}
