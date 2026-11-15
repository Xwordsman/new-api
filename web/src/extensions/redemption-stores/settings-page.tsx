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
import { Store } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'

import { getSettings, redemptionStoreSettingsKey } from './api'
import { StoreSettingsForm } from './components/settings-form'

export function RedemptionStoreSettingsPage() {
  const { t } = useTranslation()
  const settings = useQuery({
    queryKey: redemptionStoreSettingsKey,
    queryFn: getSettings,
  })
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title
        icon={Store}
        eyebrow='REDEMPTION STORES'
        description={t('Manage external code stores and their wallet cards.')}
      >
        {t('Redemption stores')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='w-full space-y-5 pb-6'>
          {settings.isPending && <LoadingState />}
          {settings.isError && !settings.data && (
            <ErrorState onRetry={() => void settings.refetch()} />
          )}
          {settings.data && <StoreSettingsForm settings={settings.data} />}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
