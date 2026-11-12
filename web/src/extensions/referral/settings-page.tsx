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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { StaticDataTableColumn } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatTimestamp } from '@/lib/format'

import { getReferralSettings } from './api'
import { OrderActionDialog, ReviewDialog } from './components/admin-actions'
import { ReferralState } from './components/referral-state'
import { ReferralTable } from './components/referral-table'
import { SettingsForm } from './components/settings-form'
import type { Invitee, ReferralAudit } from './types'

export function ReferralSettingsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const settings = useQuery({
    queryKey: ['referral-extension', 'settings'],
    queryFn: getReferralSettings,
  })
  const [state, setState] = useState('review')
  const [review, setReview] = useState<{
    invitee: Invitee
    approve: boolean
  } | null>(null)
  const [operation, setOperation] = useState<'reconcile' | 'refund' | null>(
    null
  )
  const filters = [
    { value: 'review', label: t('Under review') },
    { value: 'historical', label: t('Historical invitation') },
    { value: 'all', label: t('All invitees') },
    { value: 'ineligible', label: t('Not eligible') },
  ]
  const reviews: StaticDataTableColumn<Invitee>[] = [
    {
      id: 'user',
      header: t('Invitee'),
      cell: (row) => (
        <p>
          {row.username}{' '}
          <span className='text-muted-foreground text-xs'>
            ID {row.user_id}
          </span>
        </p>
      ),
    },
    { id: 'inviter', header: t('Inviter ID'), cell: (row) => row.inviter_id },
    {
      id: 'time',
      header: t('Registered at'),
      cell: (row) => formatTimestamp(row.registered_at),
    },
    {
      id: 'state',
      header: t('Status'),
      cell: (row) => <ReferralState state={row.state} />,
    },
    {
      id: 'reason',
      header: t('Reason'),
      className: 'min-w-44',
      cell: (row) => (row.reason ? t(row.reason) : '—'),
    },
    {
      id: 'actions',
      header: t('Actions'),
      cell: (row) => (
        <div className='flex gap-1'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setReview({ invitee: row, approve: true })}
          >
            {t('Approve')}
          </Button>
          <Button
            variant='ghost'
            size='sm'
            className='text-destructive'
            onClick={() => setReview({ invitee: row, approve: false })}
          >
            {t('Reject')}
          </Button>
        </div>
      ),
    },
  ]
  const audits: StaticDataTableColumn<ReferralAudit>[] = [
    {
      id: 'time',
      header: t('Time'),
      cell: (row) => formatTimestamp(row.created_at),
    },
    {
      id: 'actor',
      header: t('Operator ID'),
      cell: (row) => row.actor_id || '—',
    },
    { id: 'user', header: t('User ID'), cell: (row) => row.user_id || '—' },
    {
      id: 'action',
      header: t('Action'),
      cell: (row) => <code className='text-xs'>{row.action}</code>,
    },
    {
      id: 'detail',
      header: t('Details'),
      className: 'min-w-80',
      cell: (row) => (
        <p className='max-w-xl text-xs break-all whitespace-pre-wrap'>
          {row.detail}
        </p>
      ),
    },
  ]
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title
        icon={Gift}
        eyebrow='REFERRAL SETTINGS'
        description={t(
          'Configure referral rewards, eligibility and review rules.'
        )}
      >
        {t('Referral program')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          variant='outline'
          size='sm'
          disabled={settings.isFetching}
          onClick={() =>
            void queryClient.invalidateQueries({
              queryKey: ['referral-extension'],
            })
          }
        >
          <RefreshCw />
          {t('Refresh')}
        </Button>
        <Button
          variant='outline'
          size='sm'
          onClick={() => setOperation('reconcile')}
        >
          {t('Reconcile order')}
        </Button>
        <Button
          variant='outline'
          size='sm'
          onClick={() => setOperation('refund')}
        >
          {t('Record refund')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='w-full space-y-5 pb-6'>
          {settings.isPending && <LoadingState />}
          {settings.isError && (
            <ErrorState onRetry={() => void settings.refetch()} />
          )}
          {settings.data && <SettingsForm settings={settings.data} />}
          <Tabs
            defaultValue='review'
            data-console-tone='warning'
            className='console-surface bg-card rounded-xl border p-5'
          >
            <TabsList variant='line' className='mb-5'>
              <TabsTrigger value='review'>
                {t('Qualification review')}
              </TabsTrigger>
              <TabsTrigger value='audit'>{t('Audit trail')}</TabsTrigger>
            </TabsList>
            <TabsContent value='review' className='space-y-4'>
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'Review shared registration or payment signals and historical invitations.'
                  )}
                </p>
                <Select
                  items={filters}
                  value={state}
                  onValueChange={(value) => setState(value ?? 'review')}
                >
                  <SelectTrigger aria-label={t('Filter invitees')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {filters.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <ReferralTable<Invitee>
                key={state}
                resource='admin/reviews'
                params={{ state }}
                columns={reviews}
              />
            </TabsContent>
            <TabsContent value='audit'>
              <ReferralTable<ReferralAudit>
                resource='admin/audit'
                columns={audits}
              />
            </TabsContent>
          </Tabs>
          {review && (
            <ReviewDialog value={review} onClose={() => setReview(null)} />
          )}
          {operation && (
            <OrderActionDialog
              mode={operation}
              open
              onOpenChange={(open) => {
                if (!open) setOperation(null)
              }}
            />
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
