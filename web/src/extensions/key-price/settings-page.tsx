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
import { ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { getPriceEvents, getPriceSettings } from './api'
import { PriceEventsTable } from './components/events-table'
import { PriceSettingsForm } from './components/settings-form'

export function KeyPriceSettingsPage() {
  const { t, i18n } = useTranslation()
  const [page, setPage] = useState(1)
  const settings = useQuery({
    queryKey: ['key-price', 'settings'],
    queryFn: getPriceSettings,
  })
  const events = useQuery({
    queryKey: ['key-price', 'events', page],
    queryFn: () => getPriceEvents(page),
  })
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title
        icon={ShieldCheck}
        eyebrow='PRICE PROTECTION'
        description={t(
          'Configure automatic API key protection when group rates increase.'
        )}
      >
        {t('Key price protection')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='w-full space-y-6 pb-6'>
          {settings.isPending && <LoadingState />}
          {settings.isError && (
            <ErrorState onRetry={() => void settings.refetch()} />
          )}
          {settings.data && <PriceSettingsForm settings={settings.data} />}
          <div
            data-console-tone='warning'
            className='console-surface bg-card space-y-4 rounded-xl border p-5 sm:p-6'
          >
            <h3 className='font-semibold'>{t('Protection history')}</h3>
            {events.isPending && <LoadingState />}
            {events.isError && (
              <ErrorState onRetry={() => void events.refetch()} />
            )}
            {events.data && (
              <>
                <PriceEventsTable events={events.data.items} admin />
                <div className='flex items-center justify-end gap-3 text-sm'>
                  <span>
                    {formatNumber(
                      events.data.total,
                      toIntlLocale(i18n.resolvedLanguage || i18n.language)
                    )}{' '}
                    {t('Events')}
                  </span>
                  <Button
                    variant='outline'
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    {t('Previous')}
                  </Button>
                  <Button
                    variant='outline'
                    disabled={page * 20 >= events.data.total}
                    onClick={() => setPage(page + 1)}
                  >
                    {t('Next')}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
