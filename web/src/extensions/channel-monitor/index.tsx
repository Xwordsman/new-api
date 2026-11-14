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
  Activity,
  ArrowDownUp,
  ChevronDown,
  Clock3,
  Database,
  Gauge,
  Radio,
  RefreshCw,
  Search,
} from 'lucide-react'
import { useEffect, useEffectEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTableRowActionMenu,
  StaticDataTable,
} from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { ConsolePageHeader, Main } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { StatCardValue } from '@/components/stat-card-value'
import { dotColorMap } from '@/components/status-badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import {
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatTimestamp } from '@/lib/format'
import { cn } from '@/lib/utils'

import { getMonitorSnapshot } from './api'
import { GroupRow } from './components/group-row'
import { useMonitorStatuses } from './hooks/use-monitor-statuses'

import '@/styles/channel-monitor.css'

export function ChannelMonitorPage() {
  const { t, i18n } = useTranslation()
  const [window, setWindow] = useState('24h')
  const [automatic, setAutomatic] = useState(true)
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState('success')
  const [search, setSearch] = useState('')
  const statuses = useMonitorStatuses()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const sortOptions = [
    {
      value: 'success',
      label: t('Request success rate'),
      direction: t('High → low'),
    },
    {
      value: 'latency',
      label: t('Time to first token'),
      direction: t('Low → high'),
    },
    {
      value: 'speed',
      label: t('Generation speed'),
      direction: t('High → low'),
    },
    {
      value: 'cache',
      label: t('Cache hit rate'),
      direction: t('High → low'),
    },
    {
      value: 'ratio',
      label: t('Current multiplier'),
      direction: t('Low → high'),
    },
    { value: 'name', label: t('Name'), direction: 'A→Z' },
    { value: 'default', label: t('Configured order'), direction: '' },
  ]
  const currentSort = sortOptions.find((option) => option.value === sort)
  const query = useQuery({
    queryKey: ['channel-monitor', 'snapshot', window],
    queryFn: () => getMonitorSnapshot(window),
    refetchInterval: automatic ? 30_000 : false,
    staleTime: 25_000,
  })
  const data = query.data
  // Price transitions must refresh even when metric auto-refresh is off. Use
  // server-relative time so a misconfigured client clock cannot shift a period.
  const nextPriceChange = Math.min(
    ...(data?.groups ?? []).map((group) => {
      const schedule = group.offer.schedule
      if (!schedule || !schedule.period_end) return Infinity
      return (schedule.period_end - schedule.evaluated_at) * 1000
    })
  )
  const refetchPricing = useEffectEvent(() => void query.refetch())
  useEffect(() => {
    if (!Number.isFinite(nextPriceChange)) return
    const remaining = nextPriceChange - (Date.now() - query.dataUpdatedAt)
    const timer = globalThis.setTimeout(
      refetchPricing,
      Math.min(Math.max(0, remaining), 2_147_483_647)
    )
    return () => globalThis.clearTimeout(timer)
  }, [nextPriceChange, query.dataUpdatedAt])
  const needle = search.trim().toLowerCase()
  const groups = (data?.groups ?? []).filter(
    (group) =>
      (status === 'all' || group.status === status) &&
      [
        group.group,
        group.display_name,
        group.description,
        ...group.models.map((model) => model.model),
      ].some((value) => value.toLowerCase().includes(needle))
  )
  if (sort === 'success') {
    groups.sort((a, b) => (b.success_rate ?? -1) - (a.success_rate ?? -1))
  }
  if (sort === 'ratio') groups.sort((a, b) => a.ratio - b.ratio)
  if (sort === 'latency') {
    groups.sort(
      (a, b) => (a.ttft_seconds ?? Infinity) - (b.ttft_seconds ?? Infinity)
    )
  }
  if (sort === 'speed') {
    groups.sort(
      (a, b) => (b.tokens_per_second ?? -1) - (a.tokens_per_second ?? -1)
    )
  }
  if (sort === 'cache') {
    groups.sort((a, b) => (b.cache_hit_rate ?? -1) - (a.cache_hit_rate ?? -1))
  }
  if (sort === 'name') {
    groups.sort((a, b) =>
      (a.display_name || a.group).localeCompare(
        b.display_name || b.group,
        locale
      )
    )
  }
  const summary = data?.summary
  const cards = [
    {
      title: t('Request success rate'),
      code: 'SUCCESS',
      value: summary?.success_rate,
      suffix: '%',
      icon: Activity,
      tone: 'success',
      description: t('{{count}} real requests', {
        count: formatNumber(summary?.outcomes ?? 0, locale),
      }),
    },
    {
      title: t('Time to first token'),
      code: 'TTFT',
      value: summary?.ttft_seconds,
      suffix: 's',
      icon: Clock3,
      tone: 'latency',
      description: t('Fastest {{value}}s', {
        value: formatNumber(summary?.fastest_ttft_seconds, locale),
      }),
    },
    {
      title: t('Generation speed'),
      code: 'TPS',
      value: summary?.tokens_per_second,
      suffix: 't/s',
      icon: Gauge,
      tone: 'speed',
      description: t('Peak {{value}} t/s', {
        value: formatNumber(summary?.max_tokens_per_second, locale),
      }),
    },
    {
      title: t('Cache hit rate'),
      code: 'CACHE HIT',
      value: summary?.cache_hit_rate,
      suffix: '%',
      icon: Database,
      tone: 'cache',
      description: t('Weighted by measured input tokens'),
    },
  ]
  return (
    <Main className='console-page channel-monitor @container/monitor'>
      <ConsolePageHeader
        icon={Radio}
        eyebrow='CHANNEL MONITOR'
        eyebrowMeta={
          <p className='text-muted-foreground flex flex-wrap items-center gap-2 text-xs leading-4'>
            <span
              className={cn(
                'size-1.5 rounded-full',
                query.isError ? 'bg-destructive' : 'bg-success'
              )}
              aria-hidden
            />
            {automatic ? t('Live') : t('Manual')}
            {data && (
              <span>
                · {t('Updated at')} {formatTimestamp(data.updated_at).slice(11)}
              </span>
            )}
          </p>
        }
        title={t('Channel monitor')}
        description={t(
          'Real request observations. Unobserved periods remain unknown.'
        )}
        actions={
          <div className='monitor-controls flex flex-wrap items-center gap-2.5'>
            <NativeSelect
              size='sm'
              aria-label={t('Time range')}
              value={window}
              onChange={(event) => setWindow(event.target.value)}
              className='bg-background/70'
            >
              <NativeSelectOption value='24h'>
                {t('Last 24 hours')}
              </NativeSelectOption>
              <NativeSelectOption value='7d'>
                {t('Last 7 days')}
              </NativeSelectOption>
              <NativeSelectOption value='30d'>
                {t('Last 30 days')}
              </NativeSelectOption>
            </NativeSelect>
            <div className='flex items-center gap-2'>
              <Switch
                id='monitor-auto-refresh'
                checked={automatic}
                onCheckedChange={setAutomatic}
              />
              <Label htmlFor='monitor-auto-refresh' className='text-xs'>
                {t('Auto refresh')}
              </Label>
            </div>
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
      />
      <section
        aria-label={t('Channel monitor')}
        className='monitor-content min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-6 lg:px-8'
      >
        <div className='flex flex-col gap-3'>
          {query.isPending && <LoadingState />}
          {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
          {data && !data.enabled && (
            <EmptyState
              icon={Activity}
              title={t('Channel monitor is not enabled')}
              description={t(
                'The administrator can publish groups in System Settings → Channel monitor.'
              )}
            />
          )}
          {data?.enabled && (
            <>
              {(!data.consume_logs_enabled || !data.error_logs_enabled) && (
                <Alert variant='destructive'>
                  <AlertDescription>
                    {t(
                      'Consumption and error logging must both be enabled for success rates. Missing measurements stay unknown.'
                    )}
                  </AlertDescription>
                </Alert>
              )}
              {data.groups.some((group) => group.sample_limited) && (
                <Alert>
                  <AlertDescription>
                    {t(
                      'High-traffic groups show the latest {{count}} log records in this time range. Metrics describe this sample.',
                      {
                        count: formatNumber(
                          data.sample_limit_per_group,
                          locale
                        ),
                      }
                    )}
                  </AlertDescription>
                </Alert>
              )}
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
                    <div className='flex items-center justify-between gap-2 text-[13px] font-medium'>
                      <span className='flex items-center gap-2'>
                        <span className='monitor-metric-icon flex size-6.5 shrink-0 items-center justify-center rounded-[calc(var(--radius)*0.4)] border'>
                          <card.icon className='size-3.5' aria-hidden />
                        </span>
                        {card.title}
                      </span>
                      <span className='text-muted-foreground hidden font-mono text-[10px] font-normal tracking-wide @min-[42rem]/monitor:inline'>
                        {card.code}
                      </span>
                    </div>
                    <div className='mt-3 flex flex-wrap items-baseline gap-1.5'>
                      <StatCardValue
                        value={
                          card.value == null
                            ? '—'
                            : formatNumber(card.value, locale)
                        }
                      />
                      <span className='monitor-metric-unit font-mono text-[13px] leading-none'>
                        {card.suffix}
                      </span>
                    </div>
                    <p className='text-muted-foreground mt-3.5 font-mono text-[11px] leading-4.5'>
                      {card.description}
                    </p>
                  </section>
                ))}
              </div>
              <Card className='mt-1 min-w-0 gap-3 p-4 sm:p-5'>
                <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b pb-2'>
                  <div
                    role='group'
                    aria-label={t('All statuses')}
                    className='flex max-w-full min-w-0 flex-auto gap-0.5 overflow-x-auto'
                  >
                    {[
                      { value: 'all', label: t('All') },
                      ...Object.entries(statuses).map(([value, item]) => ({
                        value,
                        label: item.label,
                      })),
                    ].map((item) => (
                      <Button
                        key={item.value}
                        variant='ghost'
                        size='sm'
                        aria-label={item.label}
                        aria-pressed={status === item.value}
                        onClick={() => setStatus(item.value)}
                        className={cn(
                          'text-muted-foreground h-8 shrink-0 gap-1.5 rounded-none border-x-0 border-t-0 border-b-2 border-transparent px-3 text-[13px]',
                          status === item.value && 'border-primary text-primary'
                        )}
                      >
                        {item.value === 'all' ? (
                          item.label
                        ) : (
                          <>
                            <span
                              aria-hidden
                              className={cn(
                                'size-1.5 shrink-0',
                                dotColorMap[
                                  statuses[item.value as keyof typeof statuses]
                                    .variant
                                ]
                              )}
                            />
                            {item.label}
                          </>
                        )}
                        <span className='font-mono text-[10px] font-normal opacity-80'>
                          {
                            data.groups.filter(
                              (group) =>
                                item.value === 'all' ||
                                group.status === item.value
                            ).length
                          }
                        </span>
                      </Button>
                    ))}
                  </div>
                  <div
                    role='group'
                    aria-label={t('Filters')}
                    className='monitor-controls ml-auto flex w-full max-w-full flex-wrap items-center justify-end gap-2.5 sm:w-auto'
                  >
                    <span className='text-muted-foreground hidden shrink-0 font-mono text-[11px] sm:block'>
                      {t('{{count}} groups', { count: groups.length })}
                    </span>
                    <DataTableRowActionMenu
                      ariaLabel={t('Sort groups')}
                      align='start'
                      contentClassName='w-auto min-w-56 rounded-[calc(var(--radius)*0.7)]'
                      trigger={
                        <Button
                          variant='outline'
                          size='sm'
                          className='h-8 gap-1.5 rounded-[calc(var(--radius)*0.4)] px-2.5 text-xs font-normal'
                        >
                          <ArrowDownUp className='size-3.5' aria-hidden />
                          <span>{currentSort?.label}</span>
                          <span className='text-muted-foreground text-[10px]'>
                            {currentSort?.direction}
                          </span>
                          <ChevronDown className='size-3' aria-hidden />
                        </Button>
                      }
                    >
                      <DropdownMenuRadioGroup
                        value={sort}
                        onValueChange={setSort}
                      >
                        {sortOptions.map((option) => (
                          <DropdownMenuRadioItem
                            key={option.value}
                            value={option.value}
                            aria-label={`${option.label} ${option.direction}`.trim()}
                            closeOnClick
                            className='gap-3 py-1.5 text-[13px]'
                          >
                            <span>{option.label}</span>
                            <span className='text-muted-foreground text-[10px]'>
                              {option.direction}
                            </span>
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DataTableRowActionMenu>
                    <div className='relative w-full sm:w-60'>
                      <Search
                        className='text-muted-foreground absolute top-2.5 left-2.5 size-3.5'
                        aria-hidden
                      />
                      <Input
                        className='h-8 rounded-[calc(var(--radius)*0.45)] pl-8 text-xs'
                        aria-label={t('Search groups or models')}
                        placeholder={t('Search groups or models')}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </div>
                  </div>
                </div>
                {groups.length === 0 ? (
                  <EmptyState
                    title={t('No matching groups')}
                    description={t(
                      'Only published groups available to your account are shown.'
                    )}
                  />
                ) : (
                  <StaticDataTable
                    tableClassName='min-w-260 table-fixed [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:h-9.5 [&_th]:text-xs [&_th]:font-normal [&_th]:text-muted-foreground'
                    tableProps={{ typography: 'content' }}
                    className='bg-card rounded-[calc(var(--radius)*0.7)]'
                  >
                    <colgroup>
                      <col className='w-[30%]' />
                      <col className='w-28' />
                      <col className='w-28' />
                      <col />
                      <col className='w-28' />
                      <col className='w-22' />
                      <col className='w-24' />
                      <col className='w-8' />
                    </colgroup>
                    <TableHeader>
                      <TableRow className='bg-muted/40 text-xs'>
                        <TableHead
                          className='pl-4.5'
                          aria-sort={sort === 'name' ? 'ascending' : undefined}
                        >
                          {t('Name')}
                        </TableHead>
                        <TableHead
                          aria-sort={sort === 'ratio' ? 'ascending' : undefined}
                        >
                          {t('Current multiplier')}
                        </TableHead>
                        <TableHead>{t('Status')}</TableHead>
                        <TableHead
                          aria-sort={
                            sort === 'success' ? 'descending' : undefined
                          }
                        >
                          <span
                            className={cn(
                              'inline-flex items-center gap-1',
                              sort === 'success' && 'text-primary'
                            )}
                          >
                            {t('Request success rate')}
                            {sort === 'success' && <span aria-hidden>↓</span>}
                          </span>
                        </TableHead>
                        <TableHead
                          className='text-right'
                          aria-sort={
                            sort === 'latency' ? 'ascending' : undefined
                          }
                        >
                          {t('Time to first token')}
                        </TableHead>
                        <TableHead
                          className='text-right'
                          aria-sort={
                            sort === 'speed' ? 'descending' : undefined
                          }
                        >
                          TPS
                        </TableHead>
                        <TableHead
                          className='text-right'
                          aria-sort={
                            sort === 'cache' ? 'descending' : undefined
                          }
                        >
                          {t('Cache hit rate')}
                        </TableHead>
                        <TableHead>
                          <span className='sr-only'>{t('Details')}</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className='[&>tr]:h-16.5'>
                      {groups.map((group) => (
                        <GroupRow
                          key={group.group}
                          group={group}
                          updatedAt={data.updated_at}
                          receivedAt={query.dataUpdatedAt}
                          search={
                            group.models.some((model) =>
                              model.model.toLowerCase().includes(needle)
                            )
                              ? needle
                              : ''
                          }
                        />
                      ))}
                    </TableBody>
                  </StaticDataTable>
                )}
              </Card>
              <p className='text-muted-foreground text-center text-[11px] leading-5'>
                {t(
                  'Model base price × public group multiplier · Scheduled discounts apply automatically · Success rates are weighted by real requests'
                )}
              </p>
            </>
          )}
        </div>
      </section>
    </Main>
  )
}
