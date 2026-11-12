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
import { Gauge } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { concurrencySettingsKey, getSettings, getStatus } from './api'
import { OccupancyTable } from './components/occupancy-table'
import { ConcurrencySettingsForm } from './components/settings-form'

export function ConcurrencySettingsPage() {
  const { t } = useTranslation()
  const settings = useQuery({
    queryKey: concurrencySettingsKey,
    queryFn: getSettings,
  })
  const status = useQuery({
    queryKey: ['concurrency', 'status'],
    queryFn: getStatus,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title
        icon={Gauge}
        eyebrow='CONCURRENCY'
        description={t(
          'Control simultaneous requests across accounts, channels and upstream credentials.'
        )}
      >
        {t('Concurrency management')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='w-full space-y-6 pb-6'>
          {settings.isPending && <LoadingState />}
          {settings.isError && (
            <ErrorState onRetry={() => void settings.refetch()} />
          )}
          {settings.data && (
            <ConcurrencySettingsForm settings={settings.data} />
          )}
          <section className='console-surface bg-card space-y-4 rounded-xl border p-5'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <div className='flex flex-wrap items-center gap-3'>
                <h2 className='font-semibold'>{t('Live concurrency')}</h2>
                {status.data && (
                  <Badge variant='secondary'>
                    {status.data.mode === 'redis'
                      ? t('Redis shared counters')
                      : t('Process-local counters')}
                  </Badge>
                )}
              </div>
              <Button
                variant='outline'
                disabled={status.isFetching}
                onClick={() => void status.refetch()}
              >
                {t('Refresh')}
              </Button>
            </div>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Refreshes every 5 seconds while visible. Shows up to 1,000 recently active resources. Counters expire after 24 hours of inactivity; memory counters reset on restart. Limits reflect the latest admission attempt; refused attempts can include channel fallback.'
              )}
            </p>
            {status.data?.mode === 'memory' && (
              <p className='text-muted-foreground text-sm'>
                {t(
                  'Configure Redis for shared limits across multiple gateway processes. A configured Redis outage rejects new requests instead of switching to local counters.'
                )}
              </p>
            )}
            {status.isPending && <LoadingState />}
            {status.isError && (
              <ErrorState onRetry={() => void status.refetch()} />
            )}
            {status.data && <OccupancyTable items={status.data.items} />}
          </section>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
