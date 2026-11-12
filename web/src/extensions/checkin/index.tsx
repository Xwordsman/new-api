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
import { Link } from '@tanstack/react-router'
import { CalendarCheck, RefreshCw, Wallet } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { StatCardValue } from '@/components/stat-card-value'
import { Turnstile } from '@/components/turnstile'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useStatus } from '@/hooks/use-status'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency, getCurrencyDisplay } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { CHECKIN_QUERY_KEY, claimCheckin, getCheckinDashboard } from './api'
import { CheckinEligibility } from './components/checkin-eligibility'
import { CheckinRules } from './components/checkin-rules'
import { RewardCalendar } from './components/reward-calendar'

export function CheckinPage() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const queryClient = useQueryClient()
  const { status } = useStatus()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const [month, setMonth] = useState<string>()
  const [verificationOpen, setVerificationOpen] = useState(false)
  const [token, setToken] = useState('')
  const [challenge, setChallenge] = useState(0)
  useEffect(() => {
    setMonth(undefined)
    setVerificationOpen(false)
    setToken('')
    setChallenge((value) => value + 1)
  }, [userId])
  const dashboard = useQuery({
    queryKey: [...CHECKIN_QUERY_KEY, 'dashboard', userId, month],
    queryFn: () => getCheckinDashboard(month),
    enabled: !!userId,
    refetchInterval: 60_000,
  })
  const claim = useMutation({
    mutationFn: claimCheckin,
    retry: false,
    onSuccess: async (record) => {
      setVerificationOpen(false)
      toast.success(
        t('Check-in successful! Earned {{quota}} quota', {
          quota: formatQuotaWithCurrency(record.quota_awarded, {
            locale,
            abbreviate: false,
          }),
        })
      )
      await queryClient.invalidateQueries({ queryKey: ['account-balance'] })
    },
    onSettled: async () => {
      setToken('')
      setChallenge((value) => value + 1)
      await queryClient.invalidateQueries({ queryKey: CHECKIN_QUERY_KEY })
    },
  })
  const data = dashboard.data
  const { meta } = getCurrencyDisplay()
  const symbol = meta.kind === 'tokens' ? undefined : meta.symbol
  const stats = data
    ? [
        {
          title: t('Total check-ins'),
          value: formatNumber(data.stats.total_checkins, locale),
        },
        {
          title: t('Check-ins this month'),
          value: formatNumber(data.stats.month_checkins, locale),
        },
        {
          title: t('Rewards this month'),
          value: formatQuotaWithCurrency(data.stats.month_quota, {
            locale,
            abbreviate: false,
          }),
          symbol,
        },
        {
          title: t('Total earned'),
          value: formatQuotaWithCurrency(data.stats.total_quota, {
            locale,
            abbreviate: false,
          }),
          symbol,
        },
      ]
    : []

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title
        icon={CalendarCheck}
        eyebrow='DAILY CHECK-IN'
        description={t(
          'Unlock daily wallet rewards with verified recharge and keep track of every check-in.'
        )}
      >
        {t('Daily Check-in')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          variant='outline'
          size='sm'
          disabled={dashboard.isFetching}
          onClick={() => void dashboard.refetch()}
        >
          <RefreshCw aria-hidden='true' />
          {t('Refresh')}
        </Button>
        <Button variant='outline' size='sm' render={<Link to='/wallet' />}>
          <Wallet aria-hidden='true' />
          {t('Wallet')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='w-full space-y-5 pb-6'>
          {dashboard.isPending && <LoadingState />}
          {dashboard.isError && !data && (
            <ErrorState onRetry={() => void dashboard.refetch()} />
          )}
          {data && !data.enabled && (
            <EmptyState
              icon={CalendarCheck}
              title={t('Check-in is currently unavailable')}
              description={t(
                'The administrator has paused daily check-ins. Your previous rewards remain in your wallet.'
              )}
            />
          )}
          {data?.enabled && (
            <>
              <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
                {stats.map((stat) => (
                  <Card key={stat.title} data-card-hover='false'>
                    <CardContent className='space-y-4'>
                      <p className='text-muted-foreground text-xs font-medium'>
                        {stat.title}
                      </p>
                      <StatCardValue
                        value={stat.value}
                        currencySymbol={stat.symbol}
                      />
                    </CardContent>
                  </Card>
                ))}
              </div>
              <CheckinEligibility
                data={data}
                pending={claim.isPending || dashboard.isFetching}
                onClaim={() => {
                  if (data.verification_required) {
                    setToken('')
                    setChallenge((value) => value + 1)
                    setVerificationOpen(true)
                  } else claim.mutate(undefined)
                }}
              />
              <div className='grid items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]'>
                <RewardCalendar
                  data={data}
                  onMonthChange={setMonth}
                  loading={dashboard.isFetching}
                />
                <CheckinRules data={data} />
              </div>
            </>
          )}
        </div>
        <Dialog
          open={verificationOpen}
          onOpenChange={(open) => {
            if (claim.isPending) return
            setVerificationOpen(open)
            setToken('')
          }}
          title={t('Security Check')}
          description={t('Please complete the security check to continue.')}
          contentClassName='sm:max-w-md'
          footer={
            <Button
              disabled={!token || claim.isPending || !data?.claimable}
              onClick={() => claim.mutate(token)}
            >
              {t('Verify and check in')}
            </Button>
          }
        >
          {status?.turnstile_site_key ? (
            <div className='space-y-4'>
              <Turnstile
                key={challenge}
                siteKey={status.turnstile_site_key}
                onVerify={setToken}
                onExpire={() => setToken('')}
              />
              <Button
                variant='ghost'
                size='sm'
                disabled={claim.isPending}
                onClick={() => {
                  setToken('')
                  setChallenge((value) => value + 1)
                }}
              >
                {t('Retry verification')}
              </Button>
            </div>
          ) : (
            <p className='text-muted-foreground text-sm'>
              {t(
                'Check-in verification is not configured. Please contact an administrator.'
              )}
            </p>
          )}
        </Dialog>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
