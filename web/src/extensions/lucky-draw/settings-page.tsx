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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Gift, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'

import { DRAW_QUERY_KEY, getDrawSettings, getDrawSummary } from './api'
import { DrawAdminLedgers } from './components/admin-ledgers'
import { DrawSettingsForm } from './components/settings-form'

export function LuckyDrawSettingsPage() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const client = useQueryClient()
  const settings = useQuery({
    queryKey: [...DRAW_QUERY_KEY, 'settings'],
    queryFn: getDrawSettings,
  })
  const summary = useQuery({
    queryKey: [...DRAW_QUERY_KEY, 'summary'],
    queryFn: getDrawSummary,
  })
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title
        icon={Gift}
        eyebrow='LUCKY DRAW SETTINGS'
        description={t(
          'Configure recharge qualification, prize probabilities, inventory and reward budgets. Review every draw and account decision.'
        )}
      >
        {t('Lucky draw')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          size='sm'
          variant='outline'
          disabled={settings.isFetching}
          onClick={() =>
            void client.invalidateQueries({ queryKey: DRAW_QUERY_KEY })
          }
        >
          <RefreshCw aria-hidden='true' />
          {t('Refresh')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='space-y-5 pb-6'>
          {settings.isPending && <LoadingState />}
          {settings.isError && (
            <ErrorState onRetry={() => void settings.refetch()} />
          )}
          {summary.data && (
            <Card data-card-hover='false'>
              <CardContent className='flex flex-wrap gap-6 text-sm'>
                <span>
                  {t('Total draws')}:{' '}
                  {formatNumber(summary.data.pool.total_draws, locale)}
                </span>
                <span>
                  {t('Rewards today')}:{' '}
                  {formatQuotaWithCurrency(summary.data.pool.daily_quota, {
                    locale,
                    abbreviate: false,
                  })}
                </span>
                <span>
                  {t('Total earned')}:{' '}
                  {formatQuotaWithCurrency(summary.data.pool.total_quota, {
                    locale,
                    abbreviate: false,
                  })}
                </span>
              </CardContent>
            </Card>
          )}
          {settings.data && (
            <DrawSettingsForm settings={settings.data} summary={summary.data} />
          )}
          <DrawAdminLedgers />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
