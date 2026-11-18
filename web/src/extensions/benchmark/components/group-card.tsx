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
import { BrainCircuit, Candy, Expand, PenTool, X } from 'lucide-react'
import { memo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatTimestamp } from '@/lib/format'
import { getLobeIcon } from '@/lib/lobe-icon'
import { resolveModelProvider } from '@/lib/model-provider'

import {
  groupStatus,
  runDisplayStatus,
  useRunStatuses,
  type DisplayStatus,
} from '../hooks/use-run-statuses'
import { buildTimeline } from '../lib/timeline'
import type { BenchmarkGroup, RunSummary } from '../types'
import { SavedArtwork } from './artwork-preview'
import { RunResult } from './run-detail'

const severity: Record<DisplayStatus, number> = {
  passed: 0,
  pending: 1,
  running: 1,
  interrupted: 2,
  invalid: 3,
  truncated: 3,
  request_failed: 3,
  timeout: 3,
  wrong_answer: 4,
  suspected: 4,
  abnormal: 5,
}

export const GroupCard = memo(function GroupCard(props: {
  group: BenchmarkGroup
  now: number
  historyHours: number
  paused: boolean
  onOpen: (id: number) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const statuses = useRunStatuses()
  const g = props.group
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<RunSummary[]>([])
  const runs = g.runs
    .filter((run) => !run.manual)
    .sort((a, b) => b.created_at - a.created_at || b.id - a.id)
  const latestSVG = g.svg_enabled
    ? runs.find((r) => r.kind === 'svg' && r.status === 'passed')
    : undefined
  const latestCandy = g.candy_enabled
    ? runs.find((r) => r.kind === 'candy')
    : undefined
  const status = groupStatus(g)
  const checking =
    (g.candy_enabled &&
      runs.find((r) => r.kind === 'candy')?.status === 'running') ||
    (g.svg_enabled && runs.find((r) => r.kind === 'svg')?.status === 'running')
  const labels = {
    passed: t('Checks normal'),
    pending: t('Awaiting visual review'),
    suspected: t('Suspected degradation'),
    failed: t('Request or output failure'),
    unknown: checking ? t('Checking') : t('No checks'),
  }
  const variants = {
    passed: 'success',
    pending: 'neutral',
    suspected: 'danger',
    failed: 'warning',
    unknown: checking ? 'info' : 'neutral',
  } as const
  let healthLabel = g.enabled ? labels[status] : t('Disabled')
  let healthVariant: 'success' | 'neutral' | 'danger' | 'warning' | 'info' =
    variants[status]
  if (g.enabled && g.mode === 'upstream') {
    if (g.sync_error) {
      healthLabel = t('Upstream sync failed')
      if (
        g.sync_error === 'upstream_unauthorized' ||
        g.sync_error === 'upstream_token_missing'
      ) {
        healthLabel = t('Upstream authorization required')
      }
      if (g.sync_error === 'upstream_target_missing') {
        healthLabel = t('Upstream group or model unavailable')
      }
      healthVariant = 'warning'
    } else if (!g.last_sync_at) {
      healthLabel = t('Waiting for first sync')
      healthVariant = 'neutral'
    } else if (g.sync_stale) {
      healthLabel = t('Upstream results out of date')
      healthVariant = 'warning'
    }
  }
  const provider = resolveModelProvider(g.model)
  const completed = runs.filter(
    (r) =>
      r.created_at >= props.now - 86400 &&
      r.created_at <= props.now &&
      r.status !== 'running' &&
      (r.kind === 'candy' ? g.candy_enabled : g.svg_enabled)
  )
  const total = g.totals.candy_total + g.totals.svg_total
  const averageLatency = completed.length
    ? completed.reduce((sum, r) => sum + r.latency_ms, 0) /
      completed.length /
      1000
    : null
  const timeline = buildTimeline(
    runs,
    g.interval_seconds,
    g.next_at,
    props.now,
    props.historyHours
  )
  const selectedRuns = selected.flatMap((item) =>
    runs.filter((run) => run.id === item.id)
  )
  const displayed = selectedRuns.length
    ? selectedRuns
    : [
        latestCandy,
        g.svg_enabled ? runs.find((r) => r.kind === 'svg') : undefined,
      ].filter((r): r is RunSummary => Boolean(r))
  return (
    <Accordion
      value={open ? [g.group] : []}
      onValueChange={(value) => setOpen(value.length > 0)}
    >
      <AccordionItem value={g.group} className='benchmark-target'>
        <div className='benchmark-target-grid'>
          <div className='benchmark-target-info'>
            <AccordionTrigger
              aria-label={g.group}
              className='items-center p-0 hover:no-underline'
            >
              <span className='flex min-w-0 items-center gap-2.5'>
                <span className='benchmark-provider' aria-hidden>
                  {provider ? (
                    getLobeIcon(provider.icon, 18)
                  ) : (
                    <BrainCircuit className='size-[18px]' />
                  )}
                </span>
                <span className='min-w-0'>
                  <span
                    className='block truncate text-sm leading-[21px] font-semibold'
                    title={g.group}
                  >
                    {g.group}
                  </span>
                  <span
                    className='text-muted-foreground block truncate font-mono text-[11.5px] font-normal'
                    title={g.model}
                  >
                    {g.model}
                  </span>
                </span>
              </span>
            </AccordionTrigger>
            <div className='benchmark-badges'>
              <StatusBadge
                variant={healthVariant}
                label={healthLabel}
                copyable={false}
                className='text-[11px]'
              />
              <span>
                {g.mode === 'upstream'
                  ? t('Sync upstream results')
                  : t('Local checks')}
              </span>
              <span className='rounded-sm border px-1.5 py-0.5'>
                {t('Every {{minutes}} min', {
                  minutes: formatNumber(g.interval_seconds / 60, locale),
                })}
              </span>
              <span className='text-muted-foreground'>
                {g.mode === 'upstream' ? t('Next sync') : t('Next check')}{' '}
                {g.next_at ? formatTimestamp(g.next_at).slice(11, 16) : '—'}
              </span>
            </div>
            {g.mode === 'upstream' && (
              <p className='text-muted-foreground text-xs break-words'>
                {t('Last successful sync')}:{' '}
                {g.last_sync_at ? formatTimestamp(g.last_sync_at) : '—'}
                {' · '}
                {t('Upstream result time')}:{' '}
                {g.upstream_at ? formatTimestamp(g.upstream_at) : '—'}
              </p>
            )}
            <dl className='benchmark-group-stats'>
              <div>
                <dt>{t('Basic check pass rate')}</dt>
                <dd>
                  {total
                    ? `${formatNumber(((g.totals.candy_passed + g.totals.svg_passed) / total) * 100, locale)}%`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>{t('Anomalies')}</dt>
                <dd>{formatNumber(g.totals.anomalies, locale)}</dd>
              </div>
              <div>
                <dt>{t('Average latency')}</dt>
                <dd>
                  {averageLatency === null
                    ? '—'
                    : `${formatNumber(averageLatency, locale)}s`}
                </dd>
              </div>
            </dl>
          </div>
          <div className='benchmark-lanes'>
            <div
              className='benchmark-timeline'
              style={{ '--benchmark-slots': timeline.length } as CSSProperties}
            >
              {(['candy', 'svg'] as const).map((kind) => {
                const enabled =
                  g.enabled &&
                  (kind === 'candy' ? g.candy_enabled : g.svg_enabled)
                const slots = timeline.map((slot) => ({
                  ...slot,
                  runs: slot.runs.filter((run) => run.kind === kind),
                }))
                const recent = slots.flatMap((slot) => slot.runs)
                const Icon = kind === 'candy' ? Candy : PenTool
                const label =
                  kind === 'candy' ? t('Candy logic') : t('SVG drawing')
                return (
                  <section
                    className='benchmark-lane'
                    key={kind}
                    aria-label={label}
                  >
                    <div className='benchmark-lane-name'>
                      <span>
                        <Icon className='size-3.5' aria-hidden />
                        {label}
                      </span>
                      <small>{kind === 'candy' ? 'CANDY' : 'ARTWORK'}</small>
                    </div>
                    <div className='benchmark-lane-cells'>
                      {slots.map((slot) => {
                        const representative = slot.runs.reduce<
                          RunSummary | undefined
                        >(
                          (worst, run) =>
                            !worst ||
                            severity[runDisplayStatus(run)] >
                              severity[runDisplayStatus(worst)]
                              ? run
                              : worst,
                          undefined
                        )
                        let state = 'empty'
                        let description = t('No checks yet')
                        if (!enabled) {
                          state = 'disabled'
                          description = t('Disabled')
                        } else if (representative) {
                          state = runDisplayStatus(representative)
                          description =
                            statuses[runDisplayStatus(representative)].label
                        }
                        const time = representative?.created_at ?? slot.start
                        return (
                          <Tooltip key={slot.start}>
                            <TooltipTrigger
                              render={
                                <Button
                                  size='icon-sm'
                                  variant='ghost'
                                  className='benchmark-lane-cell'
                                  data-status={state}
                                  disabled={!enabled || !representative}
                                  aria-label={`${label} · ${formatTimestamp(time)} · ${description}`}
                                  aria-pressed={Boolean(
                                    open &&
                                    selectedRuns.some((run) =>
                                      slot.runs.some((r) => r.id === run.id)
                                    )
                                  )}
                                  onClick={() => {
                                    setSelected(slot.runs)
                                    setOpen(true)
                                  }}
                                />
                              }
                            />
                            <TooltipContent>
                              <span>
                                {formatTimestamp(time)} · {description}
                                {slot.runs.length > 1
                                  ? ` · ${formatNumber(slot.runs.length, locale)}`
                                  : ''}
                              </span>
                            </TooltipContent>
                          </Tooltip>
                        )
                      })}
                    </div>
                    <span className='benchmark-lane-count'>
                      {enabled
                        ? `${formatNumber(recent.filter((r) => r.status === 'passed').length, locale)}/${formatNumber(recent.filter((r) => r.status !== 'running').length, locale)}`
                        : t('Disabled')}
                    </span>
                  </section>
                )
              })}
              <div
                className='benchmark-lane-axis'
                data-compact={timeline.length < 24}
              >
                <span>
                  {formatTimestamp(props.now - props.historyHours * 3600)}
                </span>
                <span>
                  −{t('{{count}} hours', { count: props.historyHours / 2 })}
                </span>
                <span>{t('Now')}</span>
              </div>
            </div>
          </div>
          <article className='benchmark-art'>
            <div className='benchmark-thumb'>
              {latestSVG ? (
                <>
                  <SavedArtwork
                    id={latestSVG.id}
                    paused={props.paused}
                    className='h-full min-h-0'
                  />
                  <Button
                    size='icon-sm'
                    variant='secondary'
                    className='benchmark-enlarge'
                    aria-label={t('View artwork')}
                    onClick={() => props.onOpen(latestSVG.id)}
                  >
                    <Expand aria-hidden />
                  </Button>
                </>
              ) : (
                <div className='benchmark-art-empty'>
                  {g.svg_enabled ? t('No SVG artwork yet') : t('Disabled')}
                </div>
              )}
            </div>
            <div className='benchmark-art-caption'>
              <div>
                <strong title={latestSVG?.prompt_name}>
                  {latestSVG?.prompt_name || t('SVG drawing')}
                </strong>
                <span>
                  {latestSVG
                    ? `${formatNumber(latestSVG.latency_ms / 1000, locale)}s`
                    : '—'}
                </span>
              </div>
              <div>
                <span>
                  {latestSVG
                    ? formatTimestamp(latestSVG.created_at).slice(5, 16)
                    : '—'}
                </span>
                <span className='truncate'>{g.group}</span>
              </div>
            </div>
          </article>
        </div>
        <AccordionContent className='benchmark-expanded'>
          <div className='benchmark-results'>
            <Button
              size='icon-sm'
              variant='ghost'
              className='benchmark-results-close'
              aria-label={t('Close')}
              onClick={() => setOpen(false)}
            >
              <X aria-hidden />
            </Button>
            {displayed.map((run) => (
              <RunResult
                key={run.id}
                id={run.id}
                inline
                paused={props.paused}
                onOpen={props.onOpen}
                onDeleted={() => setSelected([])}
              />
            ))}
            {displayed.length === 0 && (
              <p className='text-muted-foreground text-sm'>
                {t('No checks yet')}
              </p>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
})
