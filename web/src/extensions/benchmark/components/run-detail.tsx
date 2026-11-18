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
import { Expand } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatTimestamp } from '@/lib/format'
import { ROLE } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { getBenchmarkRun } from '../api'
import { runDisplayStatus, useRunStatuses } from '../hooks/use-run-statuses'
import { ArtworkPreview } from './artwork-preview'
import { RegenerateResult } from './regenerate-result'
import { ResultActions } from './result-actions'

// Inline results and the enlarged dialog share the same saved data and controls.
export function RunResult(props: {
  id: number
  inline?: boolean
  paused: boolean
  onOpen?: (id: number) => void
  onDeleted?: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const statuses = useRunStatuses()
  const role = useAuthStore((state) => state.auth.user?.role ?? ROLE.GUEST)
  const [version, setVersion] = useState<number | null>(null)
  const id = version ?? props.id
  const query = useQuery({
    queryKey: ['benchmark', 'run', id, version === null ? 'latest' : 'exact'],
    queryFn: () => getBenchmarkRun(id, version === null),
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 5000 : false),
  })
  if (query.isPending) return <LoadingState className='min-h-32' />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  const run = query.data
  const statusLabel =
    run.kind === 'svg' && run.status === 'passed'
      ? t('SVG structure passed')
      : statuses[run.status].label
  return (
    <article
      className={cn(
        'benchmark-result min-w-0 space-y-3',
        props.inline && 'benchmark-result-inline'
      )}
    >
      <div className='benchmark-result-heading flex flex-wrap items-center justify-between gap-2'>
        <h3 className='flex items-center gap-2 text-xs font-semibold'>
          {props.inline && (
            <span className='text-primary font-mono text-[10px]' aria-hidden>
              {run.kind === 'candy' ? 'A' : 'B'}
            </span>
          )}
          {run.kind === 'candy' ? t('Candy logic') : t('SVG drawing')}
        </h3>
        <div className='flex flex-wrap items-center gap-1.5'>
          {props.inline && run.kind === 'candy' && (
            <time
              className='benchmark-result-time'
              dateTime={new Date(run.created_at * 1000).toISOString()}
            >
              {formatTimestamp(run.created_at).slice(5, 16)}
            </time>
          )}
          <StatusBadge
            variant={statuses[run.status].variant}
            label={statusLabel}
            copyable={false}
            className='benchmark-result-status'
          >
            <span className='size-1.5 shrink-0 bg-current' aria-hidden />
            {statusLabel}
          </StatusBadge>
        </div>
      </div>
      {run.origin && (
        <p className='text-muted-foreground text-xs break-words'>
          {t('Sync upstream results')} · {run.model} · {run.upstream_group}
          {' · '}
          {t('Upstream result time')}: {formatTimestamp(run.created_at)}
          {' · '}
          {t('Last successful sync')}:{' '}
          {run.synced_at ? formatTimestamp(run.synced_at) : '—'}
          {run.upstream_url?.startsWith('https://ai.apizn.com/pelican/') && (
            <>
              {' '}
              ·{' '}
              <a
                className='underline'
                href={run.upstream_url}
                target='_blank'
                rel='noopener noreferrer'
              >
                {t('View upstream result')}
              </a>
            </>
          )}
        </p>
      )}
      {(run.versions?.length ?? 0) > 1 && (
        <div className='flex flex-wrap items-center gap-2'>
          <Label
            htmlFor={`versions-${props.inline ? 'inline' : 'dialog'}-${props.id}`}
          >
            {t('Result versions')}
          </Label>
          <NativeSelect
            id={`versions-${props.inline ? 'inline' : 'dialog'}-${props.id}`}
            value={version ?? 'latest'}
            onChange={(event) =>
              setVersion(
                event.target.value === 'latest'
                  ? null
                  : Number(event.target.value)
              )
            }
          >
            <NativeSelectOption value='latest'>
              {t('Latest version')}
            </NativeSelectOption>
            {run.versions?.map((item) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {formatTimestamp(item.created_at)} ·{' '}
                {item.manual ? t('Manual regeneration') : t('Automatic check')}{' '}
                · #{item.id}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      )}
      <RegenerateResult
        key={run.id}
        run={run}
        onOpen={(next) => {
          setVersion(next)
          props.onOpen?.(next)
        }}
        onVersion={setVersion}
      />
      {run.kind === 'svg' && run.status === 'passed' && (
        <div className='space-y-1'>
          <StatusBadge
            variant={statuses[runDisplayStatus(run)].variant}
            label={
              run.quality === 'normal'
                ? t('Visual quality normal')
                : statuses[runDisplayStatus(run)].label
            }
            copyable={false}
          />
          {run.quality_reason && (
            <p className='text-muted-foreground text-xs break-words'>
              {t('Review reason')}: {run.quality_reason}
            </p>
          )}
          {!!run.reviewed_at && (
            <p className='text-muted-foreground text-xs'>
              {t('Administrator review')} · {formatTimestamp(run.reviewed_at)}
            </p>
          )}
        </div>
      )}
      {role >= ROLE.ADMIN && (
        <ResultActions
          key={`${run.id}-${run.reviewed_at ?? 0}`}
          run={run}
          onDeleted={(next) => {
            if (next) setVersion(next)
            else props.onDeleted?.()
          }}
        />
      )}
      {!props.inline && (
        <p className='text-muted-foreground font-mono text-[11px] break-all'>
          {run.group} · {run.model} · {formatTimestamp(run.created_at)}
        </p>
      )}
      {run.kind === 'candy' && (
        <>
          {props.inline && (
            <pre className='benchmark-prompt' aria-label={t('Saved prompt')}>
              {run.prompt}
            </pre>
          )}
          <dl className='benchmark-answers'>
            <div>
              <dt className='text-muted-foreground text-xs'>
                {run.origin ? t('Upstream verdict') : t('Expected answer')}
              </dt>
              <dd
                className={cn(
                  'mt-1 font-mono text-xl break-all',
                  run.status === 'passed' && 'text-success'
                )}
              >
                {run.origin ? statuses[run.status].label : run.expected || '—'}
              </dd>
            </div>
            <div>
              <dt className='text-muted-foreground text-xs'>
                {props.inline ? t('Model final answer') : t('Actual answer')}
              </dt>
              <dd
                className={cn(
                  'mt-1 max-h-40 overflow-auto font-mono text-xl break-all whitespace-pre-wrap',
                  run.status === 'passed' && 'text-success',
                  run.status === 'wrong_answer' && 'text-destructive'
                )}
              >
                {run.output || '—'}
              </dd>
            </div>
          </dl>
        </>
      )}
      {run.kind === 'svg' && run.output && (
        <figure
          aria-label={run.prompt_name || t('SVG drawing')}
          className={cn(
            'space-y-1.5',
            props.inline && 'benchmark-result-artwork'
          )}
        >
          <div className='relative'>
            <ArtworkPreview
              output={run.output}
              paused={props.paused}
              className={
                props.inline
                  ? 'benchmark-inline-preview'
                  : 'h-[min(60vh,560px)]'
              }
            />
            {props.inline && (
              <Button
                size='icon-sm'
                variant='secondary'
                className='benchmark-enlarge'
                aria-label={t('View details')}
                onClick={() => props.onOpen?.(run.id)}
              >
                <Expand aria-hidden />
              </Button>
            )}
          </div>
          <figcaption className='benchmark-art-caption'>
            <div>
              <strong title={run.prompt_name}>
                {run.prompt_name || t('SVG drawing')}
              </strong>
              <span>{formatNumber(run.latency_ms / 1000, locale)}s</span>
            </div>
            <div>
              <time dateTime={new Date(run.created_at * 1000).toISOString()}>
                {formatTimestamp(run.created_at).slice(5, 16)}
              </time>
              <span className='truncate'>{run.group}</span>
            </div>
          </figcaption>
        </figure>
      )}
      {(run.kind === 'candy' || !props.inline) && (
        <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
          <dl className='benchmark-run-metrics'>
            <div>
              <dt className='text-muted-foreground'>{t('Latency')}</dt>
              <dd>{formatNumber(run.latency_ms / 1000, locale)} s</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>{t('Input tokens')}</dt>
              <dd>{formatNumber(run.input_tokens, locale)}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>{t('Output tokens')}</dt>
              <dd>{formatNumber(run.output_tokens, locale)}</dd>
            </div>
          </dl>
          {props.inline && (
            <Button
              size='sm'
              variant='link'
              className='h-auto p-0'
              onClick={() => props.onOpen?.(run.id)}
            >
              {t('View original output')}
            </Button>
          )}
        </div>
      )}
      {!props.inline && (
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
      {(run.kind === 'candy' || !props.inline) && (
        <p className='text-muted-foreground text-[11px] leading-5'>
          {run.kind === 'candy' && !run.origin && (
            <>
              {t(
                'Passing rule: the final answer must exactly match {{answer}} after trimming whitespace; answers embedded in reasoning are not accepted.',
                { answer: run.expected || '—' }
              )}{' '}
            </>
          )}
          {run.origin
            ? t(
                'Imported results reflect upstream checks and do not verify the route used by this site.'
              )
            : t(
                'A group probe samples one routed channel. A passed check does not prove model identity or overall intelligence.'
              )}
        </p>
      )}
    </article>
  )
}

export function RunDetail(props: { id: number; onClose: () => void }) {
  const { t } = useTranslation()
  const [paused, setPaused] = useState(false)
  const [selected, setSelected] = useState({ source: props.id, id: props.id })
  const id = selected.source === props.id ? selected.id : props.id
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
      <RunResult
        key={id}
        id={id}
        paused={paused}
        onOpen={(next) => setSelected({ source: props.id, id: next })}
        onDeleted={props.onClose}
      />
    </Dialog>
  )
}
