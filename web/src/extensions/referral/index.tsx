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
import { Gift, BookOpen, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import type { StaticDataTableColumn } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TransferDialog } from '@/features/wallet/components/dialogs/transfer-dialog'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatTimestamp } from '@/lib/format'
import {
  getServerErrorSources,
  getServerErrorStatus,
} from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { claimRewards, getDashboard, transferRewards } from './api'
import { Invitees } from './components/invitees'
import { ReferralSummary } from './components/referral-summary'
import { ReferralTable } from './components/referral-table'
import { Rewards } from './components/rewards'
import { RulesDialog } from './components/rules-dialog'
import { useReferralTransferStore } from './transfer-store'
import type { ReferralTransfer } from './types'

export function ReferralPage() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const queryClient = useQueryClient()
  const [rulesOpen, setRulesOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [claimID, setClaimID] = useState<number | null>(null)
  const userID = useAuthStore((state) => state.auth.user?.id ?? 0)
  const transferRequest = useReferralTransferStore(
    (state) => state.requests[userID]
  )
  const setRequest = useReferralTransferStore((state) => state.setRequest)
  const dashboard = useQuery({
    queryKey: ['referral-extension', 'dashboard'],
    queryFn: getDashboard,
    refetchInterval: 30_000,
  })
  const data = dashboard.data
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['referral-extension'] })
  const claim = useMutation({
    mutationFn: claimRewards,
    onSuccess: async () => {
      setClaimID(null)
      await refresh()
      toast.success(t('Referral rewards claimed'))
    },
  })
  const transfer = useMutation({
    mutationFn: transferRewards,
    onSuccess: async () => {
      setRequest(userID, null)
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: ['self'] }),
      ])
      toast.success(t('Referral rewards transferred'))
    },
  })
  const onTransfer = async (quota: number) => {
    const request = transferRequest ?? {
      quota,
      request_id: crypto.randomUUID(),
    }
    setRequest(userID, request)
    try {
      await transfer.mutateAsync(request)
      return true
    } catch (error) {
      const status = getServerErrorStatus(error)
      // A lost response may follow a committed credit. Keep its amount and
      // idempotency key locked until that same transfer is resolved.
      if (
        getServerErrorSources(error).some(
          (source) => source.success === false
        ) ||
        (status && status >= 400 && status < 500)
      ) {
        setRequest(userID, null)
      }
      return false
    }
  }
  const columns: StaticDataTableColumn<ReferralTransfer>[] = [
    {
      id: 'id',
      header: t('Transfer ID'),
      cell: (row) => <code className='text-xs'>#{row.id}</code>,
    },
    {
      id: 'time',
      header: t('Time'),
      cell: (row) => formatTimestamp(row.created_at),
    },
    {
      id: 'debit',
      header: t('Referral balance debit'),
      cell: (row) =>
        formatQuotaWithCurrency(row.quota, { locale, abbreviate: false }),
    },
    {
      id: 'offset',
      header: t('Debt offset'),
      cell: (row) =>
        formatQuotaWithCurrency(row.offset, { locale, abbreviate: false }),
    },
    {
      id: 'credit',
      header: t('Wallet credit'),
      cell: (row) =>
        formatQuotaWithCurrency(row.quota - row.offset, {
          locale,
          abbreviate: false,
        }),
    },
    {
      id: 'state',
      header: t('Status'),
      cell: () => (
        <span className='text-blue-600 dark:text-blue-400'>
          {t('Completed')}
        </span>
      ),
    },
  ]
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title
        icon={Gift}
        eyebrow='REFERRAL PROGRAM'
        description={t(
          'Grow together. Turn trusted recommendations into lasting value.'
        )}
      >
        {t('Referral program')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          variant='outline'
          size='sm'
          onClick={() => void refresh()}
          disabled={dashboard.isFetching}
        >
          <RefreshCw className={dashboard.isFetching ? 'animate-spin' : ''} />
          {t('Refresh')}
        </Button>
        <Button variant='outline' size='sm' onClick={() => setRulesOpen(true)}>
          <BookOpen />
          {t('Program rules')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        {dashboard.isPending && <LoadingState />}
        {dashboard.isError && (
          <ErrorState onRetry={() => void dashboard.refetch()} />
        )}
        {data && (
          <div className='w-full space-y-5 pb-6'>
            {!data.settings.enabled && (
              <p
                className='rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm'
                role='status'
              >
                {t(
                  'The referral program is paused. Existing balances can still be transferred.'
                )}
              </p>
            )}
            {data.account.debt > 0 && (
              <p
                className='rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm'
                role='status'
              >
                {t('Refund offset notice', {
                  amount: formatQuotaWithCurrency(data.account.debt, {
                    locale,
                    abbreviate: false,
                  }),
                })}
              </p>
            )}
            <ReferralSummary
              data={data}
              onTransfer={() => setTransferOpen(true)}
              pendingTransfer={Boolean(transferRequest)}
            />
            <Tabs
              defaultValue='invitees'
              data-console-tone='info'
              className='console-surface bg-card rounded-xl border p-4 sm:p-6'
            >
              <div className='mb-5 flex flex-wrap items-center justify-between gap-3'>
                <TabsList variant='line'>
                  <TabsTrigger value='invitees'>
                    {t('Invited friends')}
                  </TabsTrigger>
                  <TabsTrigger value='rewards'>
                    {t('Reward records')}
                  </TabsTrigger>
                  <TabsTrigger value='transfers'>
                    {t('Transfer records')}
                  </TabsTrigger>
                </TabsList>
                <Button
                  size='sm'
                  disabled={
                    !data.settings.enabled ||
                    data.claimable <= 0 ||
                    claim.isPending
                  }
                  onClick={() => setClaimID(0)}
                >
                  {t('Claim all rewards')}
                  {data.claimable > 0 &&
                    ` · ${formatQuotaWithCurrency(data.claimable, { locale, abbreviate: false })}`}
                </Button>
              </div>
              <TabsContent value='invitees'>
                <Invitees
                  now={data.server_time}
                  onClaim={setClaimID}
                  claiming={claim.isPending}
                  enabled={data.settings.enabled}
                />
              </TabsContent>
              <TabsContent value='rewards'>
                <Rewards
                  now={data.server_time}
                  onClaim={setClaimID}
                  claiming={claim.isPending}
                  enabled={data.settings.enabled}
                />
              </TabsContent>
              <TabsContent value='transfers'>
                <ReferralTable<ReferralTransfer>
                  resource='transfers'
                  columns={columns}
                />
              </TabsContent>
            </Tabs>
            <RulesDialog
              open={rulesOpen}
              onOpenChange={setRulesOpen}
              settings={data.settings}
            />
            <TransferDialog
              open={transferOpen}
              onOpenChange={setTransferOpen}
              onConfirm={onTransfer}
              availableQuota={data.account.balance}
              transferring={transfer.isPending}
              minimumQuota={1}
              initialQuota={data.account.balance}
              lockedQuota={transferRequest?.quota}
            />
            <ConfirmDialog
              open={claimID !== null}
              onOpenChange={(open) => {
                if (!open) setClaimID(null)
              }}
              title={t('Claim referral rewards')}
              desc={t(
                'Eligible cooled rewards are added to your referral balance. Refund debt is offset first.'
              )}
              confirmText={t('Claim reward')}
              isLoading={claim.isPending}
              handleConfirm={() => {
                if (claimID !== null) claim.mutate(claimID)
              }}
            />
          </div>
        )}
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
