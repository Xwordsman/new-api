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
import { VChart } from '@visactor/react-vchart'
import { BarChart3 } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { LoadingState } from '@/components/loading-state'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { useChartTheme } from '@/lib/use-chart-theme'
import { VCHART_OPTION } from '@/lib/vchart'

import { formatTokens } from '../lib/format'
import type { ModelHistorySeries, ModelRanking, RankingPeriod } from '../types'

const PERIOD_DESCRIPTIONS: Record<RankingPeriod, string> = {
  today: 'Hourly token usage by model across the last 24 hours',
  week: 'Weekly token usage by model across the past few weeks',
  month: 'Daily token usage by model across the past month',
  year: 'Weekly token usage by model across the past year',
}

const TOOLTIP_MAX_ROWS = 10
const MODEL_PALETTE = [
  '#8b5cf6',
  '#c4b5fd',
  '#3b82f6',
  '#a5b4fc',
  '#14b8a6',
  '#99f6e4',
  '#f59e0b',
  '#fcd34d',
  '#ec4899',
  '#f9a8d4',
]

type ModelsSectionProps = {
  history: ModelHistorySeries
  rows: ModelRanking[]
  period: RankingPeriod
}

export function ModelsSection(props: ModelsSectionProps) {
  const { t } = useTranslation()
  const { resolvedTheme, themeReady } = useChartTheme()
  const chartTextColor =
    resolvedTheme === 'dark'
      ? 'rgba(255, 255, 255, 0.68)'
      : 'rgba(15, 23, 42, 0.58)'
  const chartGridColor =
    resolvedTheme === 'dark'
      ? 'rgba(255, 255, 255, 0.12)'
      : 'rgba(15, 23, 42, 0.12)'

  // Order points so the largest model appears at the bottom of every stack.
  const orderedPoints = useMemo(() => {
    const order = new Map(
      props.history.models.map((m, idx) => [m.name, idx] as const)
    )
    return [...props.history.points].sort((a, b) => {
      const tsCmp = a.ts.localeCompare(b.ts)
      if (tsCmp !== 0) return tsCmp
      return (order.get(a.model) ?? 999) - (order.get(b.model) ?? 999)
    })
  }, [props.history])

  const totalTokens = useMemo(
    () => props.rows.reduce((s, r) => s + r.total_tokens, 0),
    [props.rows]
  )

  const spec = useMemo(() => {
    if (orderedPoints.length === 0) return null
    return {
      type: 'bar' as const,
      data: [{ id: 'models-history', values: orderedPoints }],
      xField: 'label',
      yField: 'tokens',
      seriesField: 'model',
      color: MODEL_PALETTE,
      stack: true,
      legends: { visible: false },
      axes: [
        {
          orient: 'bottom',
          label: {
            style: { fill: chartTextColor, fontSize: 10 },
            autoHide: true,
            autoLimit: true,
          },
          tick: { visible: false },
        },
        {
          orient: 'left',
          label: {
            formatMethod: (val: number | string) => formatTokens(Number(val)),
            style: { fill: chartTextColor, fontSize: 10 },
          },
          grid: {
            visible: true,
            style: { lineDash: [3, 3], stroke: chartGridColor },
          },
        },
      ],
      tooltip: {
        mark: {
          content: [
            {
              key: (datum: Record<string, unknown>) =>
                String(datum?.model ?? ''),
              value: (datum: Record<string, unknown>) =>
                formatTokens(Number(datum?.tokens) || 0),
            },
          ],
        },
        dimension: {
          title: {
            value: (datum: Record<string, unknown>) =>
              String(datum?.label ?? ''),
          },
          content: [
            {
              key: (datum: Record<string, unknown>) =>
                String(datum?.model ?? ''),
              value: (datum: Record<string, unknown>) =>
                Number(datum?.tokens) || 0,
            },
          ],
          updateContent: (
            array: Array<{ key: string; value: string | number }>
          ) => {
            array.sort((a, b) => Number(b.value) - Number(a.value))
            const sum = array.reduce((s, x) => s + (Number(x.value) || 0), 0)
            const visible = array.slice(0, TOOLTIP_MAX_ROWS)
            const overflow = array.slice(TOOLTIP_MAX_ROWS)
            const result = visible.map((item) => ({
              key: item.key,
              value: formatTokens(Number(item.value) || 0),
            }))
            if (overflow.length > 0) {
              const otherSum = overflow.reduce(
                (s, item) => s + (Number(item.value) || 0),
                0
              )
              result.push({
                key: t('+{{count}} more', { count: overflow.length }),
                value: formatTokens(otherSum),
              })
            }
            result.unshift({ key: t('Total:'), value: formatTokens(sum) })
            return result
          },
        },
      },
      animationAppear: { duration: 500 },
    }
  }, [chartGridColor, chartTextColor, orderedPoints, t])

  return (
    <Card className='rankings-panel'>
      <CardHeader className='rankings-panel-header'>
        <div className='rankings-chart-heading'>
          <div className='rankings-panel-title'>
            <span className='rankings-panel-icon'>
              <BarChart3 className='size-4' aria-hidden />
            </span>
            <h3>{t('Top Models')}</h3>
          </div>
          <span className='rankings-chart-total'>
            {formatTokens(totalTokens)} <small>{t('tokens')}</small>
          </span>
        </div>
        <CardDescription>
          {t(PERIOD_DESCRIPTIONS[props.period])}
        </CardDescription>
      </CardHeader>
      <CardContent className='rankings-chart-content'>
        {spec ? (
          <div
            className='rankings-chart'
            role='img'
            aria-label={t('Top Models')}
          >
            {themeReady ? (
              <VChart
                key={`models-history-${resolvedTheme}-${props.period}`}
                spec={{
                  ...spec,
                  theme: resolvedTheme === 'dark' ? 'dark' : 'light',
                  background: 'transparent',
                }}
                option={VCHART_OPTION}
              />
            ) : (
              <LoadingState />
            )}
          </div>
        ) : (
          <EmptyState
            title={t('No history data available')}
            className='rankings-compact-state'
          />
        )}
      </CardContent>
    </Card>
  )
}
