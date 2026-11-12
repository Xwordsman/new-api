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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trophy, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { useAuthStore } from '@/stores/auth-store'

import {
  getLeaderboardSettings,
  leaderboardQueryKey,
  refreshLeaderboard,
} from './api'
import { LeaderboardSettingsForm } from './components/settings-form'

export function LeaderboardSettingsPage() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const userId = useAuthStore((state) => state.auth.user?.id)
  const client = useQueryClient()
  const query = useQuery({
    queryKey: [...leaderboardQueryKey, userId, 'settings'],
    queryFn: ({ signal }) => getLeaderboardSettings(signal),
    enabled: !!userId,
    refetchOnWindowFocus: false,
    refetchInterval: 15000,
  })
  const refresh = useMutation({
    mutationFn: refreshLeaderboard,
    onSuccess: async () => {
      toast.success(t('Leaderboard refresh queued'))
      await client.invalidateQueries({ queryKey: leaderboardQueryKey })
    },
  })
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title
        icon={Trophy}
        eyebrow='LEADERBOARD SETTINGS'
        description={t(
          'Configure public rankings, visibility and update intervals.'
        )}
      >
        {t('Leaderboard settings')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          variant='outline'
          size='sm'
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          <RefreshCw aria-hidden />
          {t('Recalculate now')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='w-full space-y-5 pb-6'>
          <Alert>
            <AlertDescription>
              {t(
                'Rankings are aggregated in the background. Saving settings queues a refresh. Savings and warnings have no historical backfill; token totals depend on retained usage statistics.'
              )}
            </AlertDescription>
          </Alert>
          {query.isPending && <LoadingState />}
          {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
          {query.data && (
            <>
              <p className='text-muted-foreground text-xs'>
                {t('Last updated')}:{' '}
                {query.data.updated_at
                  ? new Date(query.data.updated_at * 1000).toLocaleString(
                      locale,
                      { timeZone: 'Asia/Shanghai' }
                    )
                  : t('Awaiting first update')}
              </p>
              <LeaderboardSettingsForm
                key={userId}
                settings={query.data.settings}
              />
            </>
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
