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
import { PieChart } from 'lucide-react'
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

import { formatShare, formatTokens } from '../lib/format'
import type { RankingPeriod, VendorRanking, VendorShareSeries } from '../types'
import { VendorLink } from './entity-links'

const PERIOD_DESCRIPTIONS: Record<RankingPeriod, string> = {
  today: 'Token share by model author across the last 24 hours',
  week: 'Token share by model author across the past few weeks',
  month: 'Token share by model author across the past month',
  year: 'Token share by model author across the past year',
}

/** Stable colour palette for vendors, used in both the share chart and the
 * legend dots. Falls back to a neutral palette for unknown vendors so that
 * future additions still render. */
const VENDOR_COLOURS: Record<string, string> = {
  OpenAI: '#10a37f',
  Anthropic: '#d97757',
  Google: '#4285f4',
  DeepSeek: '#7c5cff',
  Alibaba: '#ff9900',
  xAI: '#1f2937',
  Meta: '#1877f2',
  Moonshot: '#ec4899',
  Zhipu: '#06b6d4',
  Mistral: '#ff7000',
  ByteDance: '#3b82f6',
  Tencent: '#22c55e',
  MiniMax: '#a855f7',
  Cohere: '#fb923c',
  Baidu: '#ef4444',
  Others: '#94a3b8',
}

const FALLBACK_PALETTE = [
  '#0ea5e9',
  '#22c55e',
  '#a855f7',
  '#f97316',
  '#14b8a6',
  '#eab308',
  '#ec4899',
  '#84cc16',
  '#6366f1',
  '#10b981',
  '#f43f5e',
  '#0891b2',
  '#94a3b8',
]

function buildVendorColourMap(names: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  let fallbackIdx = 0
  for (const name of names) {
    if (VENDOR_COLOURS[name]) {
      result[name] = VENDOR_COLOURS[name]
    } else {
      result[name] = FALLBACK_PALETTE[fallbackIdx % FALLBACK_PALETTE.length]
      fallbackIdx += 1
    }
  }
  return result
}

const MAX_VENDORS_IN_LIST = 12

type MarketShareSectionProps = {
  history: VendorShareSeries
  rows: VendorRanking[]
  period: RankingPeriod
}

/**
 * Combined "Market Share" card: a 100%-stacked bar chart showing each
 * vendor's slice of total token volume, paired with a vendor list.
 */
export function MarketShareSection(props: MarketShareSectionProps) {
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

  const colourMap = useMemo(
    () =>
      buildVendorColourMap([
        ...new Set([
          ...props.history.vendors.map((vendor) => vendor.name),
          ...props.rows.map((vendor) => vendor.vendor),
        ]),
      ]),
    [props.history, props.rows]
  )

  const orderedPoints = useMemo(() => {
    const order = new Map(
      props.history.vendors.map((v, idx) => [v.name, idx] as const)
    )
    return [...props.history.points].sort((a, b) => {
      const tsCmp = a.ts.localeCompare(b.ts)
      if (tsCmp !== 0) return tsCmp
      return (order.get(a.vendor) ?? 999) - (order.get(b.vendor) ?? 999)
    })
  }, [props.history])

  const spec = useMemo(() => {
    if (orderedPoints.length === 0) return null
    return {
      type: 'bar' as const,
      data: [{ id: 'vendor-share', values: orderedPoints }],
      xField: 'label',
      yField: 'share',
      seriesField: 'vendor',
      stack: true,
      paddingInner: 0.12,
      legends: { visible: false },
      color: { specified: colourMap },
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
          min: 0,
          max: 1,
          label: {
            formatMethod: (val: number | string) =>
              `${Math.round(Number(val) * 100)}%`,
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
                String(datum?.vendor ?? ''),
              value: (datum: Record<string, unknown>) =>
                `${(Number(datum?.share) * 100).toFixed(1)}% · ${formatTokens(Number(datum?.tokens) || 0)}`,
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
                String(datum?.vendor ?? ''),
              value: (datum: Record<string, unknown>) =>
                Number(datum?.share) || 0,
            },
          ],
          updateContent: (
            array: Array<{ key: string; value: string | number }>
          ) => {
            return array
              .filter((item) => Number(item.value) > 0.001)
              .sort((a, b) => Number(b.value) - Number(a.value))
              .map((item) => ({
                key: item.key,
                value: `${(Number(item.value) * 100).toFixed(1)}%`,
              }))
          },
        },
      },
      animationAppear: { duration: 500 },
    }
  }, [chartGridColor, chartTextColor, colourMap, orderedPoints])

  const visible = props.rows.slice(0, MAX_VENDORS_IN_LIST)

  return (
    <Card className='rankings-panel'>
      <CardHeader className='rankings-panel-header'>
        <div className='rankings-panel-title'>
          <span className='rankings-panel-icon'>
            <PieChart className='size-4' aria-hidden />
          </span>
          <h3>{t('Market Share')}</h3>
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
            aria-label={t('Market Share')}
          >
            {themeReady ? (
              <VChart
                key={`vendor-share-${resolvedTheme}-${props.period}`}
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
      <div className='rankings-vendors'>
        <h4>{t('By model author')}</h4>
        {visible.length === 0 ? (
          <EmptyState
            title={t('No vendor data available')}
            className='rankings-compact-state'
          />
        ) : (
          <ul aria-label={t('Vendors ranked by aggregated token volume')}>
            {visible.map((vendor) => (
              <li key={vendor.vendor}>
                <span className='rankings-vendor-rank'>{vendor.rank}.</span>
                <span
                  aria-hidden
                  className='rankings-vendor-dot'
                  style={{ backgroundColor: colourMap[vendor.vendor] }}
                />
                <VendorLink
                  vendor={vendor.vendor}
                  className='rankings-vendor-name'
                />
                <strong>{formatShare(vendor.share)}</strong>
                <span className='rankings-vendor-tokens'>
                  {formatTokens(vendor.total_tokens)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}
