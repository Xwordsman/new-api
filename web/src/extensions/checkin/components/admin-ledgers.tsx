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
import { Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { StaticDataTableColumn } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber, formatTimestamp } from '@/lib/format'

import { formatCheckinPayment } from '../lib/format'
import type { CheckinAccount, CheckinAudit, CheckinPayment } from '../types'
import { CheckinAccountAction } from './account-action'
import { CheckinTable } from './checkin-table'
import { CheckinReconcileDialog, CheckinRefundDialog } from './payment-actions'

export function CheckinAdminLedgers() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [filterText, setFilterText] = useState('')
  const [userId, setUserId] = useState<number>()
  const [state, setState] = useState('all')
  const [action, setAction] = useState('all')
  const [accountAction, setAccountAction] = useState<{
    userId: number
    state: 'active' | 'paused'
  } | null>(null)
  const [paymentAction, setPaymentAction] = useState<{
    mode: 'reconcile' | 'refund'
    payment?: CheckinPayment
  } | null>(null)
  const stateOptions = [
    { value: 'all', label: t('All accounts') },
    { value: 'active', label: t('Active') },
    { value: 'paused', label: t('Paused') },
  ]
  const auditActions: Record<string, string> = {
    claim: t('Reward claimed'),
    settings: t('Settings updated'),
    account_active: t('Check-in rewards resumed'),
    account_paused: t('Check-in rewards paused'),
    payment_reconcile: t('Payment reconciled'),
    payment_refund: t('Refund recorded'),
  }
  const actionOptions = [
    { value: 'all', label: t('All actions') },
    ...Object.entries(auditActions).map(([value, label]) => ({ value, label })),
  ]
  const accountColumns: StaticDataTableColumn<CheckinAccount>[] = [
    {
      id: 'user',
      header: t('User'),
      cell: (row) => (
        <div>
          <p>{row.username}</p>
          <p className='text-muted-foreground text-xs'>
            ID {formatNumber(row.user_id, locale)}
          </p>
        </div>
      ),
    },
    {
      id: 'state',
      header: t('Status'),
      cell: (row) => (
        <Badge variant={row.state === 'paused' ? 'warning' : 'secondary'}>
          {row.state === 'paused' ? t('Paused') : t('Active')}
        </Badge>
      ),
    },
    {
      id: 'count',
      header: t('Total check-ins'),
      cell: (row) => formatNumber(row.total_checkins, locale),
    },
    {
      id: 'quota',
      header: t('Total earned'),
      cell: (row) =>
        formatQuotaWithCurrency(row.total_quota, { locale, abbreviate: false }),
    },
    {
      id: 'last',
      header: t('Last check-in'),
      cell: (row) =>
        row.last_checkin_at ? formatTimestamp(row.last_checkin_at) : '—',
    },
    {
      id: 'reason',
      header: t('Review reason'),
      cell: (row) => (
        <p className='max-w-72 text-xs whitespace-pre-wrap'>
          {row.reason || '—'}
        </p>
      ),
    },
    {
      id: 'actions',
      header: t('Actions'),
      cell: (row) => (
        <Button
          variant='outline'
          size='sm'
          onClick={() =>
            setAccountAction({
              userId: row.user_id,
              state: row.state === 'paused' ? 'active' : 'paused',
            })
          }
        >
          {row.state === 'paused' ? t('Resume') : t('Pause')}
        </Button>
      ),
    },
  ]
  const paymentColumns: StaticDataTableColumn<CheckinPayment>[] = [
    {
      id: 'order',
      header: t('Payment order'),
      cell: (row) => (
        <div className='max-w-72 break-all'>
          <p className='font-mono text-xs'>{row.trade_no}</p>
          <p className='text-muted-foreground text-xs'>{row.provider}</p>
        </div>
      ),
    },
    {
      id: 'user',
      header: t('User ID'),
      cell: (row) => formatNumber(row.user_id, locale),
    },
    {
      id: 'source',
      header: t('Payment source'),
      cell: (row) => {
        let source = t('Wallet recharge')
        let origin = t('Payment provider')
        if (row.source === 'subscription') source = t('Subscription payment')
        if (row.source === 'redemption') source = t('Sale-code redemption')
        if (row.origin === 'admin') origin = t('Manual reconciliation')
        if (row.origin === 'redemption') origin = t('Admin-declared sale value')
        return (
          <div className='space-y-1'>
            <p className='text-xs'>{source}</p>
            <Badge variant='outline'>{origin}</Badge>
            {row.historical && (
              <Badge variant='warning'>{t('Historical payment')}</Badge>
            )}
          </div>
        )
      },
    },
    {
      id: 'amount',
      header: t('Qualifying recharge amount'),
      cell: (row) => formatCheckinPayment(row.amount, row.currency, locale),
    },
    {
      id: 'refund',
      header: t('Cumulative refunded amount'),
      cell: (row) =>
        formatCheckinPayment(row.refunded_amount, row.currency, locale),
    },
    {
      id: 'state',
      header: t('Status'),
      cell: (row) => {
        if (row.source === 'redemption') {
          return <Badge variant='secondary'>{t('Recorded sale value')}</Badge>
        }
        return (
          <Badge variant={row.status === 'priced' ? 'secondary' : 'warning'}>
            {row.status === 'priced'
              ? t('Verified payment')
              : t('Needs reconciliation')}
          </Badge>
        )
      },
    },
    {
      id: 'date',
      header: t('Payment time'),
      cell: (row) => formatTimestamp(row.paid_at),
    },
    {
      id: 'actions',
      header: t('Actions'),
      cell: (row) => (
        <div className='flex gap-2'>
          {row.source !== 'redemption' && (
            <Button
              variant='outline'
              size='sm'
              onClick={() =>
                setPaymentAction({ mode: 'reconcile', payment: row })
              }
            >
              {t('Reconcile order')}
            </Button>
          )}
          <Button
            variant='ghost'
            size='sm'
            onClick={() => setPaymentAction({ mode: 'refund', payment: row })}
          >
            {t('Record refund')}
          </Button>
        </div>
      ),
    },
  ]
  const auditColumns: StaticDataTableColumn<CheckinAudit>[] = [
    {
      id: 'date',
      header: t('Time'),
      cell: (row) => formatTimestamp(row.created_at),
    },
    {
      id: 'actor',
      header: t('Operator ID'),
      cell: (row) => (row.actor_id ? formatNumber(row.actor_id, locale) : '—'),
    },
    {
      id: 'user',
      header: t('User ID'),
      cell: (row) => (row.user_id ? formatNumber(row.user_id, locale) : '—'),
    },
    {
      id: 'action',
      header: t('Action'),
      cell: (row) => (
        <span className='text-xs'>
          {auditActions[row.action] ?? row.action}
        </span>
      ),
    },
    {
      id: 'reason',
      header: t('Review reason'),
      cell: (row) => (
        <p className='max-w-64 text-xs whitespace-pre-wrap'>
          {row.reason || '—'}
        </p>
      ),
    },
    {
      id: 'detail',
      header: t('Details'),
      cell: (row) => (
        <p className='max-w-lg text-xs break-all whitespace-pre-wrap'>
          {row.detail}
        </p>
      ),
    },
  ]

  return (
    <Card data-card-hover='false'>
      <CardContent className='space-y-5'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <form
            className='flex gap-2'
            onSubmit={(event) => {
              event.preventDefault()
              setUserId(filterText ? Number(filterText) : undefined)
            }}
          >
            <Input
              aria-label={t('Filter by user ID')}
              placeholder={t('User ID')}
              inputMode='numeric'
              pattern='[1-9][0-9]*'
              value={filterText}
              onChange={(event) => setFilterText(event.target.value)}
              className='w-40'
            />
            <Button
              type='submit'
              variant='outline'
              size='icon'
              aria-label={t('Search')}
            >
              <Search aria-hidden='true' />
            </Button>
            {userId && (
              <Button
                variant='ghost'
                type='button'
                onClick={() => {
                  setFilterText('')
                  setUserId(undefined)
                }}
              >
                {t('Reset')}
              </Button>
            )}
          </form>
          <div className='flex flex-wrap gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setPaymentAction({ mode: 'reconcile' })}
            >
              {t('Reconcile historical payment')}
            </Button>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setPaymentAction({ mode: 'refund' })}
            >
              {t('Record refund')}
            </Button>
          </div>
        </div>
        <Tabs defaultValue='accounts'>
          <TabsList variant='line' className='mb-5'>
            <TabsTrigger value='accounts'>{t('Check-in accounts')}</TabsTrigger>
            <TabsTrigger value='payments'>{t('Payment records')}</TabsTrigger>
            <TabsTrigger value='audit'>{t('Audit trail')}</TabsTrigger>
          </TabsList>
          <TabsContent value='accounts' className='space-y-4'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Pause or resume check-in rewards for individual accounts. Other eligibility rules still apply.'
                )}
              </p>
              <Select
                items={stateOptions}
                value={state}
                onValueChange={(value) => setState(value ?? 'all')}
              >
                <SelectTrigger aria-label={t('Filter check-in accounts')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {stateOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {userId && (
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setAccountAction({ userId, state: 'paused' })}
                >
                  {t('Pause this user')}
                </Button>
              )}
            </div>
            <CheckinTable<CheckinAccount>
              key={`accounts-${userId}-${state}`}
              resource='accounts'
              params={{
                user_id: userId,
                state: state === 'all' ? undefined : state,
              }}
              columns={accountColumns}
              getRowKey={(row) => row.user_id}
            />
          </TabsContent>
          <TabsContent value='payments'>
            <CheckinTable<CheckinPayment>
              key={`payments-${userId}`}
              resource='payments'
              params={{ user_id: userId }}
              columns={paymentColumns}
              getRowKey={(row) => row.id}
            />
          </TabsContent>
          <TabsContent value='audit' className='space-y-4'>
            <Select
              items={actionOptions}
              value={action}
              onValueChange={(value) => setAction(value ?? 'all')}
            >
              <SelectTrigger aria-label={t('Filter audit actions')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {actionOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <CheckinTable<CheckinAudit>
              key={`audit-${userId}-${action}`}
              resource='audit'
              params={{
                user_id: userId,
                action: action === 'all' ? undefined : action,
              }}
              columns={auditColumns}
              getRowKey={(row) => row.id}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
      {accountAction && (
        <CheckinAccountAction
          {...accountAction}
          onClose={() => setAccountAction(null)}
        />
      )}
      {paymentAction?.mode === 'reconcile' && (
        <CheckinReconcileDialog
          payment={paymentAction.payment}
          onClose={() => setPaymentAction(null)}
        />
      )}
      {paymentAction?.mode === 'refund' && (
        <CheckinRefundDialog
          payment={paymentAction.payment}
          onClose={() => setPaymentAction(null)}
        />
      )}
    </Card>
  )
}
