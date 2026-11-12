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
import { FlaskConical } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'

import { getBenchmarkSettings } from './api'
import { BenchmarkSettingsForm } from './components/settings-form'

export function BenchmarkSettingsPage() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['benchmark', 'settings'],
    queryFn: getBenchmarkSettings,
    refetchOnWindowFocus: false,
  })
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title
        icon={FlaskConical}
        eyebrow='BENCHMARK SETTINGS'
        description={t(
          'Configure benchmark groups, schedules and test prompts.'
        )}
      >
        {t('Benchmark settings')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='w-full pb-6'>
          {query.isPending && <LoadingState />}
          {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
          {query.data && (
            <BenchmarkSettingsForm
              key={query.data.settings.revision}
              data={query.data}
            />
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
