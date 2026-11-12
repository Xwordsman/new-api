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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { StaticDataTableColumn } from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber, formatTimestamp } from '@/lib/format'

import type { Invitee } from '../types'
import { ReferralState } from './referral-state'
import { ReferralTable } from './referral-table'
import { Rewards } from './rewards'

export function Invitees(props: {
  now: number
  onClaim: (id: number) => void
  claiming: boolean
  enabled: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [state, setState] = useState('all')
  const [detail, setDetail] = useState<Invitee | null>(null)
  const money = (quota: number) =>
    formatQuotaWithCurrency(quota, { locale, abbreviate: false })
  const filters = [
    { value: 'all', label: t('All invitees') },
    { value: 'active', label: t('Earning rewards') },
    { value: 'review', label: t('Under review') },
    { value: 'historical', label: t('Historical invitation') },
    { value: 'expired', label: t('Reward window ended') },
    { value: 'capped', label: t('Reward cap reached') },
    { value: 'ineligible', label: t('Not eligible') },
  ]
  const columns: StaticDataTableColumn<Invitee>[] = [
    {
      id: 'user',
      header: t('Invitee'),
      cell: (row) => (
        <div>
          <p className='font-medium'>{row.username}</p>
          <p className='text-muted-foreground mt-1 font-mono text-[10px]'>
            ID {row.user_id}
          </p>
        </div>
      ),
    },
    {
      id: 'window',
      header: t('Reward window'),
      className: 'min-w-48',
      cell: (row) => (
        <div className='space-y-2'>
          <p className='text-xs'>
            {formatTimestamp(row.registered_at).slice(0, 10)} →{' '}
            {formatTimestamp(row.expires_at).slice(0, 10)}
          </p>
          <Progress
            value={Math.min(
              100,
              Math.max(
                0,
                ((props.now - row.registered_at) /
                  (row.expires_at - row.registered_at)) *
                  100
              )
            )}
            aria-label={t('Reward window progress')}
          />
        </div>
      ),
    },
    {
      id: 'paid',
      header: t('Net paid top-ups'),
      cell: (row) => money(row.net_paid),
    },
    {
      id: 'earned',
      header: t('Earned / cap'),
      cell: (row) => (
        <div>
          <p className='tabular-nums'>
            {money(row.earned)}{' '}
            <span className='text-muted-foreground'>
              / {money(row.cap_quota)}
            </span>
          </p>
          <p className='text-muted-foreground mt-1 text-[11px]'>
            {t('Pending')}: {money(row.pending)}
          </p>
        </div>
      ),
    },
    {
      id: 'state',
      header: t('Status'),
      cell: (row) => {
        let visible = row.state
        if (visible === 'active' && row.expires_at <= props.now) {
          visible = 'expired'
        }
        if (visible === 'active' && row.reserved >= row.cap_quota) {
          visible = 'capped'
        }
        return <ReferralState state={visible} />
      },
    },
    {
      id: 'detail',
      header: t('Details'),
      cell: (row) => (
        <Button size='sm' variant='ghost' onClick={() => setDetail(row)}>
          {t('Details')}
        </Button>
      ),
    },
  ]
  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <p className='text-muted-foreground text-xs'>
          {t('Track each friend’s eligibility and reward cap.')}
        </p>
        <Select
          items={filters}
          value={state}
          onValueChange={(value) => setState(value ?? 'all')}
        >
          <SelectTrigger aria-label={t('Filter invitees')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {filters.map((item) => (
              <SelectItem value={item.value} key={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ReferralTable<Invitee>
        key={state}
        resource='invitees'
        params={{ state }}
        columns={columns}
      />
      <Dialog
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null)
        }}
        title={t('Invitee details')}
        description={detail ? `${detail.username} · ID ${detail.user_id}` : ''}
        contentClassName='sm:max-w-4xl'
        bodyClassName='space-y-5'
      >
        {detail && (
          <>
            <div className='bg-muted/20 rounded-lg border p-4 text-sm'>
              <p>
                {t('Saved invitation rule', {
                  rate: formatNumber(detail.rate_bps / 100, locale),
                  hours: detail.cooling_hours,
                  cap: money(detail.cap_quota),
                })}
              </p>
              <p className='text-muted-foreground mt-2 text-xs'>
                {formatTimestamp(detail.registered_at)} →{' '}
                {formatTimestamp(detail.expires_at)}
              </p>
              {detail.reason && (
                <p className='mt-3 text-amber-700 dark:text-amber-400'>
                  {t(detail.reason)}
                </p>
              )}
            </div>
            <Rewards
              now={props.now}
              onClaim={props.onClaim}
              claiming={props.claiming}
              enabled={props.enabled}
              userID={detail.user_id}
            />
          </>
        )}
      </Dialog>
    </div>
  )
}
