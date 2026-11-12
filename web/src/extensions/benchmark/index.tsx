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
import {
  Candy,
  Clock3,
  FlaskConical,
  Pause,
  PenTool,
  Play,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { ConsolePageHeader, Main } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { StatCardValue } from '@/components/stat-card-value'
import { dotColorMap } from '@/components/status-badge'
import { Accordion } from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { ROLE } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { getBenchmarkSnapshot } from './api'
import { ArtworkGallery } from './components/artwork-gallery'
import { GroupCard } from './components/group-card'
import { RunDetail } from './components/run-detail'
import { groupStatus, useRunStatuses } from './hooks/use-run-statuses'

import '@/styles/channel-monitor.css'

export function BenchmarkPage() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const user = useAuthStore((s) => s.auth.user)
  const [automatic, setAutomatic] = useState(true)
  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState('all')
  const [group, setGroup] = useState('')
  const [detail, setDetail] = useState<number | null>(null)
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  const statuses = useRunStatuses()
  const query = useQuery({
    queryKey: ['benchmark', 'snapshot'],
    queryFn: getBenchmarkSnapshot,
    refetchInterval: automatic ? 15000 : false,
  })
  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000
    )
    return () => window.clearInterval(timer)
  }, [])
  const data = query.data
  const groups = data?.groups ?? []
  const nextAt = Math.min(
    ...groups.filter((g) => g.next_at > 0).map((g) => g.next_at)
  )
  const remaining = Math.max(0, nextAt - now)
  const summary = data?.summary
  const cards = [
    {
      title: t('Next check in'),
      code: 'NEXT RUN',
      icon: Clock3,
      tone: 'latency',
      value: Number.isFinite(remaining)
        ? `${Math.floor(remaining / 60)
            .toString()
            .padStart(2, '0')}:${(remaining % 60).toString().padStart(2, '0')}`
        : '—',
      suffix: '',
      description: t(
        'Each group follows its configured interval. Busy routing may delay a check.'
      ),
    },
    {
      title: t('Candy pass rate'),
      code: 'CANDY',
      icon: Candy,
      tone: 'success',
      value: summary?.candy_total
        ? formatNumber(
            (summary.candy_passed / summary.candy_total) * 100,
            locale
          )
        : '—',
      suffix: '%',
      description: t('Passed {{passed}} / {{total}} in the last 24 hours', {
        passed: formatNumber(summary?.candy_passed ?? 0, locale),
        total: formatNumber(summary?.candy_total ?? 0, locale),
      }),
    },
    {
      title: t('SVG success rate'),
      code: 'ARTWORK',
      icon: PenTool,
      tone: 'speed',
      value: summary?.svg_total
        ? formatNumber((summary.svg_passed / summary.svg_total) * 100, locale)
        : '—',
      suffix: '%',
      description: t(
        'SVG success indicates valid structure, not visual quality.'
      ),
    },
    {
      title: t('Anomalies'),
      code: 'ABNORMAL',
      icon: TriangleAlert,
      tone: 'cache',
      value: formatNumber(summary?.anomalies ?? 0, locale),
      suffix: '',
      description: t(
        'Answer mismatches, request failures and incomplete output are retained.'
      ),
    },
  ]
  const filters = [
    { value: 'all', label: t('All') },
    { value: 'passed', label: t('No degradation detected') },
    { value: 'suspected', label: t('Suspected degradation') },
    { value: 'failed', label: t('Request or output failure') },
    { value: 'unknown', label: t('No checks') },
  ]
  const visible = groups.filter(
    (g) =>
      (!group || group === g.group) &&
      (filter === 'all' || groupStatus(g) === filter)
  )
  return (
    <Main className='console-page @container/monitor'>
      <ConsolePageHeader
        icon={FlaskConical}
        eyebrow='MODEL BENCHMARK'
        title={t('Model benchmark')}
        description={t(
          'Scheduled candy logic and SVG checks for selected groups. Disabled checks do not count as successes or failures.'
        )}
        actions={
          <div className='monitor-controls flex flex-wrap items-center gap-3'>
            <div className='flex items-center gap-2'>
              <Switch
                id='benchmark-auto'
                checked={automatic}
                onCheckedChange={setAutomatic}
              />
              <Label htmlFor='benchmark-auto' className='text-xs'>
                {t('Auto refresh')}
              </Label>
            </div>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setPaused(!paused)}
            >
              {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
              {paused ? t('Resume previews') : t('Pause previews')}
            </Button>
            <Button
              variant='outline'
              size='icon-sm'
              aria-label={t('Refresh')}
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              <RefreshCw
                aria-hidden
                className={cn(query.isFetching && 'animate-spin')}
              />
            </Button>
          </div>
        }
      >
        <p className='text-muted-foreground flex flex-wrap items-center gap-2 border-t pt-3 text-xs'>
          <span>{automatic ? t('Live') : t('Manual')}</span>
          <span>
            · {t('Refresh every {{seconds}} seconds', { seconds: 15 })}
          </span>
        </p>
      </ConsolePageHeader>
      <div className='min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-6 sm:px-6 lg:px-8'>
        {query.isPending && <LoadingState />}
        {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
        {data && !data.enabled && (
          <EmptyState
            icon={FlaskConical}
            title={t('Model benchmark is not enabled')}
            description={t(
              'The administrator can configure checks in Plugins → Model benchmark.'
            )}
          />
        )}
        {data?.enabled && (
          <>
            <div
              role='group'
              aria-label={t('Period metrics')}
              className='monitor-metrics grid grid-cols-2 gap-4 @min-[56rem]/monitor:grid-cols-4'
            >
              {cards.map((card) => (
                <section
                  key={card.code}
                  aria-label={card.title}
                  data-tone={card.tone}
                  className='console-surface console-metric monitor-metric relative min-w-0 rounded-xl border p-5'
                >
                  <div className='flex items-center justify-between gap-2 text-xs font-medium'>
                    <span className='flex items-center gap-2'>
                      <span className='monitor-metric-icon flex size-6 items-center justify-center rounded-md border'>
                        <card.icon className='size-3.5' aria-hidden />
                      </span>
                      {card.title}
                    </span>
                    <span className='text-muted-foreground hidden font-mono text-[10px] @min-[66rem]/monitor:inline'>
                      {card.code}
                    </span>
                  </div>
                  <div className='mt-4 flex flex-wrap items-baseline gap-1.5'>
                    <StatCardValue value={card.value} />
                    <span className='monitor-metric-unit font-mono text-xs leading-none'>
                      {card.suffix}
                    </span>
                  </div>
                  <p className='text-muted-foreground mt-4 max-w-56 text-xs leading-5'>
                    {card.description}
                  </p>
                </section>
              ))}
            </div>
            <div className='flex flex-wrap items-center justify-between gap-3 border-b'>
              <div
                role='group'
                aria-label={t('All statuses')}
                className='flex max-w-full gap-1 overflow-x-auto'
              >
                {filters.map((item) => (
                  <Button
                    key={item.value}
                    variant='ghost'
                    size='sm'
                    aria-pressed={filter === item.value}
                    onClick={() => setFilter(item.value)}
                    className={cn(
                      'text-muted-foreground shrink-0 rounded-none border-b-2 border-transparent px-3 text-xs',
                      filter === item.value && 'border-primary text-primary'
                    )}
                  >
                    {item.label}
                    <span className='font-mono text-[10px]'>
                      {formatNumber(
                        groups.filter(
                          (g) =>
                            item.value === 'all' ||
                            groupStatus(g) === item.value
                        ).length,
                        locale
                      )}
                    </span>
                  </Button>
                ))}
              </div>
              <div className='flex flex-wrap gap-3 pb-2'>
                {(
                  [
                    'passed',
                    'wrong_answer',
                    'request_failed',
                    'running',
                  ] as const
                ).map((s) => (
                  <span
                    key={s}
                    className='text-muted-foreground flex items-center gap-1.5 text-[10px]'
                  >
                    <span
                      className={cn(
                        'size-1.5',
                        dotColorMap[statuses[s].variant]
                      )}
                      aria-hidden
                    />
                    {statuses[s].label}
                  </span>
                ))}
              </div>
            </div>
            <div className='space-y-3'>
              <NativeSelect
                aria-label={t('Benchmark group filter')}
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                className='w-full sm:w-52'
              >
                <NativeSelectOption value=''>
                  {t('All groups')}
                </NativeSelectOption>
                {groups.map((g) => (
                  <NativeSelectOption key={g.group} value={g.group}>
                    {g.group}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <p className='text-muted-foreground text-xs leading-5'>
                {t(
                  'A group probe samples one routed channel. A passed check does not prove model identity or overall intelligence.'
                )}
              </p>
            </div>
            {visible.length === 0 ? (
              <EmptyState
                title={t('No matching groups')}
                description={t(
                  'Only published groups available to your account are shown.'
                )}
              />
            ) : (
              <Accordion multiple className='gap-3'>
                {visible.map((g) => (
                  <GroupCard
                    key={g.group}
                    group={g}
                    paused={paused}
                    canRun={user?.role === ROLE.SUPER_ADMIN}
                    onOpen={setDetail}
                  />
                ))}
              </Accordion>
            )}
            <ArtworkGallery
              key={group}
              group={group}
              paused={paused}
              automatic={automatic}
              onOpen={setDetail}
            />
          </>
        )}
      </div>
      {detail !== null && (
        <RunDetail key={detail} id={detail} onClose={() => setDetail(null)} />
      )}
    </Main>
  )
}
