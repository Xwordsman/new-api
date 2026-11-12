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
import { ShieldBan } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { getSettings } from './api'
import { EventsPanel } from './components/events-panel'
import { AuditPanel, RestrictionsPanel } from './components/restrictions-panel'
import { ProtectionSettingsForm } from './components/settings-form'

export function RequestProtectionSettingsPage() {
  const { t } = useTranslation()
  const settings = useQuery({
    queryKey: ['request-protection', 'settings'],
    queryFn: getSettings,
  })
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title
        icon={ShieldBan}
        eyebrow='REQUEST PROTECTION'
        description={t(
          'Configure request screening, enforcement and risk records.'
        )}
      >
        {t('Request protection')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='w-full space-y-6 pb-6'>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Inspect requests locally before forwarding. Configure rules, review evidence and manage temporary API restrictions.'
            )}
          </p>
          <Tabs defaultValue='settings' className='gap-6'>
            <TabsList className='h-auto max-w-full flex-wrap justify-start'>
              <TabsTrigger value='settings'>{t('Settings')}</TabsTrigger>
              <TabsTrigger value='events'>{t('Protection events')}</TabsTrigger>
              <TabsTrigger value='restrictions'>
                {t('Active restrictions')}
              </TabsTrigger>
              <TabsTrigger value='audit'>{t('Audit log')}</TabsTrigger>
            </TabsList>
            <TabsContent value='settings'>
              {settings.isPending && <LoadingState />}
              {settings.isError && (
                <ErrorState onRetry={() => void settings.refetch()} />
              )}
              {settings.data && (
                <ProtectionSettingsForm settings={settings.data} />
              )}
            </TabsContent>
            <TabsContent value='events'>
              <EventsPanel />
            </TabsContent>
            <TabsContent value='restrictions'>
              <RestrictionsPanel />
            </TabsContent>
            <TabsContent value='audit'>
              <AuditPanel />
            </TabsContent>
          </Tabs>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
