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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { getMonitorStatus } from '../api'
import type { MonitorStatusResponse, MonitorLogItem } from '../types'

export function MonitorStatusPage() {
  const { t } = useTranslation()
  const [data, setData] = useState<MonitorStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadData()
    // Refresh every 5 minutes
    const interval = setInterval(loadData, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  const loadData = async () => {
    try {
      const response = await getMonitorStatus(12)
      if (response.success) {
        setData(response.data)
        setError(null)
      }
    } catch (err) {
      setError(t('Failed to load monitor data'))
    } finally {
      setLoading(false)
    }
  }

  const hasFailures = data
    ? Object.values(data.channel_stats).some(
        (stats) => stats.uptime_percent < 100
      )
    : false

  if (loading) {
    return (
      <div className='container mx-auto max-w-7xl space-y-6 p-6'>
        <Skeleton className='h-12 w-64' />
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-96 w-full' />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className='container mx-auto max-w-7xl p-6'>
        <Alert variant='destructive'>
          <AlertCircle className='h-4 w-4' />
          <AlertDescription>{error || t('No data available')}</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className='container mx-auto max-w-7xl space-y-6 p-6'>
      {/* Header */}
      <div className='flex items-center gap-3'>
        <Activity className='text-primary h-8 w-8' />
        <h1 className='text-3xl font-bold'>{t('Service Status Monitor')}</h1>
      </div>

      {/* Warning Banner */}
      {hasFailures && (
        <Alert variant='default' className='border-warning bg-warning/10'>
          <AlertCircle className='text-warning h-4 w-4' />
          <AlertDescription className='text-warning-foreground'>
            {t('Some services are experiencing issues')}
          </AlertDescription>
        </Alert>
      )}

      {/* Model Groups */}
      <div className='space-y-8'>
        {Object.entries(data.model_groups)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([modelName, logs]) => (
            <ModelGroupSection
              key={modelName}
              modelName={modelName}
              logs={logs}
              channelStats={data.channel_stats}
              startTime={data.start_time}
              endTime={data.end_time}
            />
          ))}
      </div>

      {data.total_logs === 0 && (
        <div className='text-muted-foreground py-12 text-center'>
          {t('No monitoring data available yet')}
        </div>
      )}
    </div>
  )
}

interface ModelGroupSectionProps {
  modelName: string
  logs: MonitorLogItem[]
  channelStats: Record<number, any>
  startTime: number
  endTime: number
}

function ModelGroupSection({
  modelName,
  logs,
  channelStats,
  startTime,
  endTime,
}: ModelGroupSectionProps) {
  const { t } = useTranslation()

  // Group logs by channel
  const channelLogs = logs.reduce(
    (acc, log) => {
      if (!acc[log.channel_id]) {
        acc[log.channel_id] = []
      }
      acc[log.channel_id].push(log)
      return acc
    },
    {} as Record<number, MonitorLogItem[]>
  )

  return (
    <div className='space-y-4'>
      <h2 className='text-xl font-semibold'>{modelName}</h2>

      <div className='bg-card border-border space-y-0 overflow-hidden rounded-lg border'>
        {Object.entries(channelLogs).map(([channelIdStr, channelLogs], idx) => {
          const channelId = parseInt(channelIdStr)
          const stats = channelStats[channelId]
          const channelName = channelLogs[0]?.channel_name || `Channel ${channelId}`

          return (
            <ChannelStatusRow
              key={channelId}
              channelName={channelName}
              logs={channelLogs}
              stats={stats}
              startTime={startTime}
              endTime={endTime}
              isLast={idx === Object.keys(channelLogs).length - 1}
            />
          )
        })}
      </div>
    </div>
  )
}

interface ChannelStatusRowProps {
  channelName: string
  logs: MonitorLogItem[]
  stats: any
  startTime: number
  endTime: number
  isLast: boolean
}

function ChannelStatusRow({
  channelName,
  logs,
  stats,
  startTime,
  endTime,
  isLast,
}: ChannelStatusRowProps) {
  const uptimePercent = stats?.uptime_percent || 0
  const { t } = useTranslation()

  // Generate timeline bars (one per test)
  const bars = logs.map((log) => ({
    status: log.status,
    time: log.tested_at,
    errorMessage: log.error_message,
  }))

  return (
    <div
      className={cn(
        'hover:bg-muted/30 flex items-center gap-4 p-4 transition-colors',
        !isLast && 'border-border/60 border-b'
      )}
    >
      {/* Uptime Badge */}
      <div
        className={cn(
          'flex h-8 shrink-0 items-center justify-center rounded-full px-3 text-xs font-semibold',
          uptimePercent >= 99
            ? 'bg-success/20 text-success'
            : uptimePercent >= 95
              ? 'bg-warning/20 text-warning'
              : 'bg-destructive/20 text-destructive'
        )}
      >
        {uptimePercent.toFixed(2)}%
      </div>

      {/* Channel Name */}
      <div className='min-w-0 flex-1'>
        <div className='truncate text-sm font-medium'>{channelName}</div>
      </div>

      {/* Timeline */}
      <div className='flex flex-1 items-center gap-0.5'>
        {bars.map((bar, idx) => (
          <StatusBar
            key={idx}
            status={bar.status}
            time={bar.time}
            errorMessage={bar.errorMessage}
          />
        ))}
      </div>

      {/* Time Labels */}
      <div className='text-muted-foreground flex shrink-0 items-center gap-4 text-xs'>
        <span>{formatTimeAgo(startTime)}</span>
        <span>{t('Now')}</span>
      </div>
    </div>
  )
}

interface StatusBarProps {
  status: number
  time: number
  errorMessage?: string
}

function StatusBar({ status, time, errorMessage }: StatusBarProps) {
  const { t } = useTranslation()
  const [showTooltip, setShowTooltip] = useState(false)

  return (
    <div
      className='group relative h-8 w-1 cursor-pointer'
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div
        className={cn(
          'h-full w-full',
          status === 1 ? 'bg-success' : 'bg-destructive'
        )}
      />
      {showTooltip && (
        <div className='bg-popover text-popover-foreground absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border px-3 py-2 text-xs shadow-md'>
          <div className='font-medium'>
            {status === 1 ? t('Normal') : t('Failed')}
          </div>
          <div className='text-muted-foreground'>
            {new Date(time * 1000).toLocaleString()}
          </div>
          {errorMessage && (
            <div className='text-destructive mt-1 max-w-xs truncate'>
              {errorMessage}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatTimeAgo(timestamp: number): string {
  const now = Date.now() / 1000
  const diff = now - timestamp
  const hours = Math.floor(diff / 3600)
  return `${hours}h`
}
