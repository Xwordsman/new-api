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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { BrainCircuit, Candy, PenTool, RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StatusBadge, dotColorMap } from '@/components/status-badge'
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatTimestamp } from '@/lib/format'
import { cn } from '@/lib/utils'

import { runBenchmark } from '../api'
import { groupStatus, useRunStatuses } from '../hooks/use-run-statuses'
import type { BenchmarkGroup } from '../types'
import { SavedArtwork } from './artwork-preview'

export function GroupCard(props: {
  group: BenchmarkGroup
  canRun: boolean
  paused: boolean
  onOpen: (id: number) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const queryClient = useQueryClient()
  const statuses = useRunStatuses()
  const g = props.group
  const latestSVG = g.runs.find(
    (r) => r.kind === 'svg' && r.status === 'passed'
  )
  const status = groupStatus(g)
  const labels = {
    passed: t('No degradation detected'),
    suspected: t('Suspected degradation'),
    failed: t('Request or output failure'),
    unknown: t('No checks'),
  }
  const variants = {
    passed: 'success',
    suspected: 'danger',
    failed: 'warning',
    unknown: 'neutral',
  } as const
  const retest = useMutation({
    mutationFn: () => runBenchmark(g.group),
    onSuccess: async () => {
      toast.success(t('Benchmark queued'))
      await queryClient.invalidateQueries({
        queryKey: ['benchmark', 'snapshot'],
      })
    },
  })
  return (
    <AccordionItem
      value={g.group}
      className='console-surface bg-card rounded-xl border'
    >
      <div className='grid gap-5 p-4 sm:p-5 xl:grid-cols-[minmax(200px,0.9fr)_minmax(280px,1.4fr)_210px]'>
        <div className='min-w-0'>
          <AccordionTrigger
            className='items-start py-0 hover:no-underline'
            aria-label={g.group}
          >
            <span className='flex min-w-0 items-start gap-3'>
              <span className='console-surface-icon flex size-9 shrink-0 items-center justify-center rounded-lg border'>
                <BrainCircuit className='size-4' aria-hidden />
              </span>
              <span className='min-w-0 text-left'>
                <span className='block text-sm font-semibold break-all'>
                  {g.group}
                </span>
                <span className='text-muted-foreground mt-1 block font-mono text-xs font-normal break-all'>
                  {g.model}
                </span>
              </span>
            </span>
          </AccordionTrigger>
          <div className='mt-3 flex flex-wrap items-center gap-2 text-xs'>
            <StatusBadge
              variant={variants[status]}
              label={g.enabled ? labels[status] : t('Disabled')}
              copyable={false}
            />
            <span className='text-muted-foreground rounded-sm border px-1.5 py-0.5'>
              {t('Every {{minutes}} min', {
                minutes: formatNumber(g.interval_seconds / 60, locale),
              })}
            </span>
          </div>
          <div className='text-muted-foreground mt-2 text-xs'>
            {t('Next check')}:{' '}
            {g.next_at ? formatTimestamp(g.next_at).slice(11) : '—'}
          </div>
          <div className='mt-4 grid grid-cols-2 divide-x rounded-lg border p-2.5 text-xs'>
            <div>
              <p className='text-muted-foreground'>{t('Candy pass rate')}</p>
              <p className='mt-1 font-mono'>
                {g.totals.candy_total
                  ? `${formatNumber((g.totals.candy_passed / g.totals.candy_total) * 100, locale)}%`
                  : '—'}
              </p>
            </div>
            <div className='pl-3'>
              <p className='text-muted-foreground'>{t('Anomalies')}</p>
              <p className='mt-1 font-mono'>
                {formatNumber(g.totals.anomalies, locale)}
              </p>
            </div>
          </div>
        </div>
        <div className='flex min-w-0 flex-col justify-center gap-5'>
          {(['candy', 'svg'] as const).map((kind) => {
            const enabled = kind === 'candy' ? g.candy_enabled : g.svg_enabled
            const runs = g.runs
              .filter((r) => r.kind === kind)
              .slice(0, 72)
              .reverse()
            const Icon = kind === 'candy' ? Candy : PenTool
            return (
              <section
                key={kind}
                aria-label={
                  kind === 'candy' ? t('Candy logic') : t('SVG drawing')
                }
              >
                <div className='mb-2 flex items-center justify-between gap-2 text-xs'>
                  <span className='flex items-center gap-1.5 font-medium'>
                    <Icon className='size-3.5' aria-hidden />
                    {kind === 'candy' ? t('Candy logic') : t('SVG drawing')}
                  </span>
                  <span className='text-muted-foreground font-mono'>
                    {formatNumber(
                      runs.filter((r) => r.status === 'passed').length,
                      locale
                    )}{' '}
                    / {formatNumber(runs.length, locale)}
                  </span>
                </div>
                {!enabled ? (
                  <p className='text-muted-foreground text-xs'>
                    {t('Disabled')}
                  </p>
                ) : (
                  <>
                    <div className='flex h-8 items-stretch gap-[3px]'>
                      {runs.length === 0 ? (
                        <span className='text-muted-foreground self-center text-xs'>
                          {t('No checks yet')}
                        </span>
                      ) : (
                        runs.map((run) => (
                          <Button
                            key={run.id}
                            size='icon-sm'
                            variant='ghost'
                            className={cn(
                              'h-full min-w-1 flex-1 rounded-sm p-0 opacity-85 hover:opacity-100',
                              dotColorMap[statuses[run.status].variant]
                            )}
                            title={`${formatTimestamp(run.created_at)} · ${statuses[run.status].label}`}
                            aria-label={`${kind === 'candy' ? t('Candy logic') : t('SVG drawing')} · ${formatTimestamp(run.created_at)} · ${statuses[run.status].label}`}
                            onClick={() => props.onOpen(run.id)}
                          />
                        ))
                      )}
                    </div>
                    <div className='text-muted-foreground mt-1 flex justify-between font-mono text-[10px]'>
                      <span>
                        {runs[0]
                          ? formatTimestamp(runs[0].created_at).slice(5, 16)
                          : '—'}
                      </span>
                      <span>{t('Now')}</span>
                    </div>
                  </>
                )}
              </section>
            )
          })}
        </div>
        <div className='min-w-0'>
          {latestSVG ? (
            <>
              <SavedArtwork
                id={latestSVG.id}
                paused={props.paused}
                className='pointer-events-none h-36 min-h-36'
              />
              <Button
                variant='link'
                size='sm'
                className='mt-1 h-auto max-w-full justify-start px-0 text-xs'
                onClick={() => props.onOpen(latestSVG.id)}
              >
                <span className='truncate'>
                  {latestSVG.prompt_name || t('View artwork')}
                </span>
                <span className='text-muted-foreground shrink-0 font-mono'>
                  {formatNumber(latestSVG.latency_ms / 1000, locale)} s
                </span>
              </Button>
            </>
          ) : (
            <div className='bg-muted/30 text-muted-foreground flex h-36 items-center justify-center rounded-lg border border-dashed text-xs'>
              {t('No SVG artwork yet')}
            </div>
          )}
        </div>
      </div>
      <AccordionContent className='border-t px-5 py-4'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <p className='text-muted-foreground max-w-2xl text-xs leading-5'>
            {t(
              'The timeline shows recent checks from the last 24 hours. Click a result to inspect its saved prompt and original output. Failures remain visible.'
            )}
          </p>
          {props.canRun && (
            <Button
              size='sm'
              variant='outline'
              disabled={
                !g.enabled ||
                retest.isPending ||
                g.runs.some((r) => r.status === 'running')
              }
              onClick={() => retest.mutate()}
            >
              <RotateCw aria-hidden />
              {t('Retest group')}
            </Button>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}
