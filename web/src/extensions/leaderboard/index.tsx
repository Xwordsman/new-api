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
import { Clock3, Info, RefreshCw, Trophy } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Tabs } from '@/components/ui/tabs'
import { toIntlLocale } from '@/i18n/languages'
import { useAuthStore } from '@/stores/auth-store'

import { getLeaderboard, leaderboardQueryKey } from './api'
import { PeriodTabs } from './components/period-tabs'
import { RankingCard } from './components/ranking-card'
import { boardIds, type BoardId, type Period } from './types'

export function LeaderboardPage() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const userId = useAuthStore((state) => state.auth.user?.id)
  const [period, setPeriod] = useState<Period>('today')
  const [overrides, setOverrides] = useState<Partial<Record<BoardId, Period>>>(
    {}
  )
  const query = useQuery({
    queryKey: [...leaderboardQueryKey, userId, 'snapshot'],
    queryFn: ({ signal }) => getLeaderboard(signal),
    enabled: !!userId,
    refetchInterval: 30000,
  })
  const data = query.data
  const titles = {
    invitations: t('Invitation leaders'),
    income: t('Referral earnings'),
    tokens: t('Token consumption'),
    savings: t('VIP savings'),
    cyber: t('Cyber warnings'),
  }
  const descriptions = {
    invitations: data?.invitation_paid_only
      ? t(
          'Valid invitations with a qualifying paid order, counted by registration date.'
        )
      : t(
          'Active invitations, counted by registration date. Historical and ineligible bindings are excluded.'
        ),
    income: t(
      'Net referral rewards actually claimed in this period. Refunded rewards are deducted.'
    ),
    tokens: t(
      'Input and output tokens from retained usage statistics. Updates follow usage persistence.'
    ),
    savings: t(
      'Settled savings against the public group rate, including membership and timed discounts. Refunds and corrections are included. Collection starts when enabled.'
    ),
    cyber: t(
      'Upstream GPT safety warnings in the retained {{days}} days. This is a risk reminder, not an honor ranking.',
      { days: data?.warning_retention_days ?? 90 }
    ),
  }
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title
        icon={Trophy}
        eyebrow='LEADERBOARD'
        description={t('Discover the people powering our AI community.')}
      >
        {t('Community leaderboard')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          variant='outline'
          size='sm'
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw
            aria-hidden
            className={query.isFetching ? 'animate-spin' : ''}
          />
          {t('Refresh')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='w-full space-y-5 pb-6'>
          {data?.enabled && (
            <div
              data-console-tone='info'
              className='console-surface bg-card text-muted-foreground flex flex-wrap gap-x-5 gap-y-2 rounded-xl border px-4 py-3 text-xs'
            >
              <span className='flex items-center gap-1.5'>
                <Clock3 className='size-3.5' aria-hidden />
                {t('Updated every {{minutes}} minutes', {
                  minutes: data.refresh_minutes,
                })}
              </span>
              <span>
                {t('Last updated')}:{' '}
                {data.updated_at
                  ? new Date(data.updated_at * 1000).toLocaleString(locale, {
                      timeZone: 'Asia/Shanghai',
                    })
                  : t('Awaiting first update')}
              </span>
            </div>
          )}
          {query.isPending && <LoadingState />}
          {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
          {data && !data.enabled && (
            <EmptyState icon={Trophy} title={t('Leaderboard is disabled')} />
          )}
          {data?.enabled && (
            <>
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <Tabs
                  value={period}
                  onValueChange={(value) => {
                    setPeriod(value as Period)
                    setOverrides({})
                  }}
                >
                  <PeriodTabs label={t('All leaderboards')} />
                </Tabs>
                <span className='text-muted-foreground text-xs'>
                  {t('Daily rankings use Beijing time (UTC+8).')}
                </span>
              </div>
              {data.pending && (
                <Alert>
                  <Info aria-hidden />
                  <AlertDescription>
                    {t(
                      'Leaderboard is being calculated. Results will appear automatically.'
                    )}
                  </AlertDescription>
                </Alert>
              )}
              {data.stale && (
                <Alert>
                  <Clock3 aria-hidden />
                  <AlertDescription>
                    {t(
                      'The latest update is delayed. Showing the last available results.'
                    )}
                  </AlertDescription>
                </Alert>
              )}
              {Object.keys(data.boards).length === 0 && (
                <EmptyState
                  icon={Trophy}
                  title={t('No leaderboards enabled')}
                />
              )}
              <div className='grid items-start gap-5 lg:grid-cols-2'>
                {boardIds.map((board) => {
                  const periods = data.boards[board]
                  if (!periods) return null
                  return (
                    <RankingCard
                      key={board}
                      board={board}
                      title={titles[board]}
                      description={descriptions[board]}
                      periods={periods}
                      period={overrides[board] ?? period}
                      onPeriodChange={(value) =>
                        setOverrides((current) => ({
                          ...current,
                          [board]: value,
                        }))
                      }
                    />
                  )
                })}
              </div>
            </>
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
