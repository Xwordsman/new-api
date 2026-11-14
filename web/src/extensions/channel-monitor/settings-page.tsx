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
import { RadioTower } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'

import { getMonitorSettings } from './api'
import { MonitorSettingsForm } from './components/settings-form'

export function ChannelMonitorSettingsPage() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['channel-monitor', 'settings'],
    queryFn: getMonitorSettings,
    refetchOnWindowFocus: false,
  })
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title
        icon={RadioTower}
        eyebrow='MONITOR SETTINGS'
        description={t(
          'Configure visible groups and monitoring. Public discounts are managed in Group pricing.'
        )}
      >
        {t('Channel monitor settings')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='w-full pb-6'>
          {query.isPending && <LoadingState />}
          {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
          {query.data && (
            <MonitorSettingsForm
              key={query.data.settings.revision}
              data={query.data}
            />
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
