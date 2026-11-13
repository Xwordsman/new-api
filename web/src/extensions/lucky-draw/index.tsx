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
import { Gift, RefreshCw, Wallet } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { StatCardValue } from '@/components/stat-card-value'
import { Turnstile } from '@/components/turnstile'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useStatus } from '@/hooks/use-status'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency, getCurrencyDisplay } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import {
  DRAW_QUERY_KEY,
  getDrawDashboard,
  getDrawData,
  recoverDraw,
  submitDraw,
} from './api'
import { DrawTable } from './components/draw-table'
import { PrizeWheel } from './components/prize-wheel'
import { useDrawStore } from './draw-store'
import type { DrawRecord, Winner } from './types'

export function LuckyDrawPage() {
  const userId = useAuthStore((state) => state.auth.user?.id)
  if (!userId) return <LoadingState />
  return <DrawPageContent key={userId} userId={userId} />
}

function DrawPageContent(props: { userId: number }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const client = useQueryClient()
  const { status } = useStatus()
  const request = useDrawStore((s) => s.requests[props.userId])
  const remember = useDrawStore((s) => s.remember)
  const forget = useDrawStore((s) => s.forget)
  const [verificationOpen, setVerificationOpen] = useState(false)
  const [token, setToken] = useState('')
  const [challenge, setChallenge] = useState(0)
  const [discardOpen, setDiscardOpen] = useState(false)
  const dashboard = useQuery({
    queryKey: [...DRAW_QUERY_KEY, 'dashboard', props.userId],
    queryFn: getDrawDashboard,
    refetchInterval: 60_000,
  })
  const recovery = useQuery({
    queryKey: [...DRAW_QUERY_KEY, 'result', props.userId, request?.key],
    queryFn: () => (request ? recoverDraw(request.key) : Promise.resolve(null)),
    enabled: !!request,
  })
  const data = dashboard.data
  const winners = useQuery({
    queryKey: [...DRAW_QUERY_KEY, 'winners', props.userId],
    queryFn: () => getDrawData<Winner[]>('winners'),
    enabled: !!data?.rules.enabled && data.rules.show_winners,
  })
  const draw = useMutation({
    mutationFn: submitDraw,
    retry: false,
    onSuccess: (result) => {
      client.setQueryData(
        [...DRAW_QUERY_KEY, 'result', props.userId, result.record.request_key],
        result
      )
      remember(props.userId, {
        key: result.record.request_key,
        version: result.record.settings_version,
        resolved: true,
      })
      setVerificationOpen(false)
      void client.invalidateQueries({ queryKey: ['account-balance'] })
    },
    onSettled: () => {
      setToken('')
      setChallenge((c) => c + 1)
      void client.invalidateQueries({ queryKey: DRAW_QUERY_KEY })
    },
  })
  const result = draw.data ?? recovery.data ?? undefined
  const pendingRequest = !!request && !recovery.data && !draw.data
  const busy = draw.isPending || (!!request && recovery.isFetching)
  function startDraw(proof?: string) {
    if (!data || busy || !data.drawable || recovery.isError) return
    const active =
      pendingRequest && request
        ? request
        : {
            key: crypto.randomUUID(),
            version: data.rules.version,
            resolved: false,
          }
    remember(props.userId, active)
    draw.mutate({
      request_key: active.key,
      version: active.version,
      turnstile: proof,
    })
  }
  const currency = getCurrencyDisplay().meta
  const symbol = currency.kind === 'tokens' ? undefined : currency.symbol
  const quota = (value: number) =>
    formatQuotaWithCurrency(value, { locale, abbreviate: false })
  const date = (value: number) =>
    value ? new Date(value * 1000).toLocaleString(locale) : t('Unlimited')

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title
        icon={Gift}
        eyebrow='LUCKY DRAW'
        description={t(
          'A little luck, a wallet reward. Check your eligibility and explore the prize pool.'
        )}
      >
        {t('Lucky draw')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          variant='outline'
          size='sm'
          disabled={busy || dashboard.isFetching}
          onClick={() =>
            void client.invalidateQueries({ queryKey: DRAW_QUERY_KEY })
          }
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
        <div className='space-y-5 pb-6'>
          {dashboard.isPending && <LoadingState />}
          {dashboard.isError && !data && (
            <ErrorState onRetry={() => void dashboard.refetch()} />
          )}
          {data && (
            <>
              {!data.rules.enabled && (
                <EmptyState
                  icon={Gift}
                  title={t('Lucky draw is not enabled')}
                  description={t('Previous rewards remain in your wallet.')}
                />
              )}
              <div className='grid gap-4 sm:grid-cols-3'>
                {[
                  {
                    title: t('Attempts remaining today'),
                    value: formatNumber(data.remaining_attempts, locale),
                  },
                  {
                    title: t('Total draws'),
                    value: formatNumber(data.account.total_draws, locale),
                  },
                  {
                    title: t('Total earned'),
                    value: quota(data.account.total_quota),
                    symbol,
                  },
                ].map((stat) => (
                  <Card key={stat.title} data-card-hover='false'>
                    <CardContent className='space-y-4'>
                      <p className='text-muted-foreground text-sm'>
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
              {(data.rules.enabled || result) && (
                <div className='grid items-start gap-5 xl:grid-cols-2'>
                  <Card data-card-hover='false'>
                    <CardHeader>
                      <CardTitle>{t('Try your luck')}</CardTitle>
                    </CardHeader>
                    <CardContent className='space-y-4'>
                      <PrizeWheel
                        key={result?.record.id ?? 'ready'}
                        prizes={data.rules.prizes}
                        result={result}
                        animate={!!draw.data && !draw.data.replay}
                      />
                      {recovery.isError && (
                        <ErrorState onRetry={() => void recovery.refetch()} />
                      )}
                      <div className='space-y-3 text-center'>
                        {data.reason && (
                          <p
                            className='text-muted-foreground text-sm'
                            role='status'
                          >
                            {t(data.reason)}
                          </p>
                        )}
                        {pendingRequest && (
                          <p className='text-muted-foreground text-sm'>
                            {t(
                              'An unfinished draw was found. Retry to recover the same result.'
                            )}
                          </p>
                        )}
                        <Button
                          className='min-w-40'
                          size='lg'
                          disabled={!data.drawable || busy || recovery.isError}
                          onClick={() => {
                            if (data.verification_required) {
                              setToken('')
                              setChallenge((c) => c + 1)
                              setVerificationOpen(true)
                            } else startDraw()
                          }}
                        >
                          {draw.isPending ? t('Drawing...') : t('Draw now')}
                        </Button>
                        {pendingRequest && !busy && !recovery.isError && (
                          <Button
                            variant='ghost'
                            onClick={() => setDiscardOpen(true)}
                          >
                            {t('Discard unfinished draw')}
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                  <Card data-card-hover='false'>
                    <CardHeader>
                      <CardTitle>{t('Prize pool and rules')}</CardTitle>
                    </CardHeader>
                    <CardContent className='space-y-5'>
                      <ul className='text-muted-foreground space-y-2 text-sm'>
                        <li>
                          {t('Recharge requirement')}: {data.rules.currency}{' '}
                          {data.rules.threshold_amount} ·{' '}
                          {t(
                            data.rules.recharge_mode === 'lifetime'
                              ? 'Lifetime recharge'
                              : 'Recent recharge'
                          )}{' '}
                          {data.rules.recharge_mode === 'rolling' &&
                            t('{{count}} days', {
                              count: data.rules.lookback_days,
                            })}
                        </li>
                        <li>
                          {t('Qualified recharge')}: {data.rules.currency}{' '}
                          {data.qualified_amount} · {t('Still required')}:{' '}
                          {data.remaining_amount}
                        </li>
                        <li>
                          {t('Daily attempts')}:{' '}
                          {formatNumber(data.rules.daily_attempts, locale)} ·{' '}
                          {t('Next reset')}: {date(data.account.next_reset_at)}{' '}
                          ({data.rules.timezone})
                        </li>
                        <li>
                          {t('Qualification expires')}: {date(data.expires_at)}
                        </li>
                        <li>
                          {t('Activity period')}: {date(data.rules.starts_at)} —{' '}
                          {date(data.rules.ends_at)}
                        </li>
                        <li>
                          {t(
                            'Gifts, referral rewards and wallet transfers do not count as recharge. Refunds reduce qualification.'
                          )}
                        </li>
                        <li>
                          {t(
                            data.rules.include_subscriptions
                              ? 'Verified external subscription payments are included.'
                              : 'Subscription payments are excluded.'
                          )}
                        </li>
                        <li>
                          {t(
                            'Equal wheel sectors are decorative. The published probabilities determine each draw.'
                          )}
                        </li>
                        <li>
                          {t(
                            'If any prize cannot be honored, drawing pauses without changing the odds.'
                          )}
                        </li>
                        {(data.rules.daily_budget_quota > 0 ||
                          data.rules.total_budget_quota > 0 ||
                          data.rules.user_cap_quota > 0) && (
                          <li>
                            {t('Daily prize budget')}:{' '}
                            {data.rules.daily_budget_quota
                              ? quota(data.rules.daily_budget_quota)
                              : t('Unlimited')}{' '}
                            · {t('Total prize budget')}:{' '}
                            {data.rules.total_budget_quota
                              ? quota(data.rules.total_budget_quota)
                              : t('Unlimited')}{' '}
                            · {t('Per-user reward cap')}:{' '}
                            {data.rules.user_cap_quota
                              ? quota(data.rules.user_cap_quota)
                              : t('Unlimited')}
                          </li>
                        )}
                      </ul>
                      <ul
                        className='divide-y'
                        aria-label={t('Prize probabilities')}
                      >
                        {data.rules.prizes.map((p) => (
                          <li
                            key={p.id}
                            className='flex flex-wrap items-center justify-between gap-2 py-3 text-sm'
                          >
                            <span className='flex min-w-0 items-center gap-2'>
                              <span
                                aria-hidden='true'
                                className='size-2.5 shrink-0 rounded-full'
                                style={{ backgroundColor: p.color }}
                              />
                              <span className='break-all'>{t(p.name)}</span>
                            </span>
                            <span>
                              {p.kind === 'credit'
                                ? quota(p.quota)
                                : t('No reward')}{' '}
                              ·{' '}
                              {new Intl.NumberFormat(locale, {
                                maximumFractionDigits: 4,
                              }).format(p.weight / 10000)}
                              %
                            </span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              )}
              <Card data-card-hover='false'>
                <CardHeader>
                  <CardTitle>{t('Draw history')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <DrawTable<DrawRecord>
                    resource='history'
                    userId={props.userId}
                    getRowKey={(r) => r.id}
                    columns={[
                      {
                        id: 'date',
                        header: t('Time'),
                        cell: (r) => date(r.created_at),
                      },
                      {
                        id: 'prize',
                        header: t('Prize'),
                        cell: (r) => t(r.prize_name),
                      },
                      {
                        id: 'amount',
                        header: t('Reward'),
                        cell: (r) => quota(r.quota_awarded),
                      },
                      {
                        id: 'id',
                        header: t('Draw ID'),
                        cell: (r) => `#${r.id}`,
                      },
                    ]}
                  />
                </CardContent>
              </Card>
              {!!winners.data?.length && (
                <Card data-card-hover='false'>
                  <CardHeader>
                    <CardTitle>{t('Recent winners')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className='grid gap-3 sm:grid-cols-2'>
                      {winners.data.map((w) => (
                        <li className='text-sm' key={w.id}>
                          {w.participant} · {t(w.prize_name)} ·{' '}
                          {quota(w.quota_awarded)}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
        <ConfirmDialog
          open={discardOpen}
          onOpenChange={setDiscardOpen}
          title={t('Discard unfinished draw')}
          desc={t(
            'Check once more for a saved result before discarding. Existing rewards and attempts are never reversed.'
          )}
          handleConfirm={async () => {
            if (!request) return
            const recovered = await recovery.refetch()
            if (recovered.isError) return
            if (!recovered.data) {
              forget(props.userId)
              draw.reset()
            }
            setDiscardOpen(false)
          }}
        />
        <Dialog
          open={verificationOpen}
          onOpenChange={(open) => {
            if (!draw.isPending) {
              setVerificationOpen(open)
              setToken('')
            }
          }}
          title={t('Security Check')}
          description={t('Please complete the security check to continue.')}
          footer={
            <Button
              disabled={!token || busy || !data?.drawable}
              onClick={() => startDraw(token)}
            >
              {t('Verify and draw')}
            </Button>
          }
        >
          {status?.turnstile_site_key && (
            <Turnstile
              key={challenge}
              siteKey={status.turnstile_site_key}
              onVerify={setToken}
              onExpire={() => setToken('')}
            />
          )}
        </Dialog>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
