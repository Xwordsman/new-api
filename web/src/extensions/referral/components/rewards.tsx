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
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatTimestamp } from '@/lib/format'

import type { ReferralReward } from '../types'
import { ReferralState } from './referral-state'
import { ReferralTable } from './referral-table'

export function Rewards(props: {
  now: number
  onClaim: (id: number) => void
  claiming: boolean
  enabled: boolean
  userID?: number
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [scope, setScope] = useState('current')
  const money = (quota: number) =>
    formatQuotaWithCurrency(quota, { locale, abbreviate: false })
  const columns: StaticDataTableColumn<ReferralReward>[] = [
    {
      id: 'order',
      header: t('Payment order'),
      className: 'max-w-44',
      cell: (row) => (
        <div>
          <p className='truncate font-mono text-[11px]' title={row.trade_no}>
            {row.trade_no}
          </p>
          <p className='text-muted-foreground mt-1 text-[11px]'>
            ID {row.user_id} · {row.provider}
          </p>
        </div>
      ),
    },
    {
      id: 'paid',
      header: t('Net paid top-ups'),
      cell: (row) => money(row.paid_quota - row.refunded_quota),
    },
    {
      id: 'reward',
      header: t('Reward'),
      cell: (row) => (
        <div>
          <p className='font-medium tabular-nums'>
            {money(row.quota - row.reversed)}
          </p>
          {row.reversed > 0 && (
            <p className='text-muted-foreground mt-1 text-[11px]'>
              {t('Reversed')}: {money(row.reversed)}
            </p>
          )}
          {row.offset > 0 && (
            <p className='text-muted-foreground mt-1 text-[11px]'>
              {t('Debt offset')}: {money(row.offset)}
            </p>
          )}
        </div>
      ),
    },
    {
      id: 'available',
      header: t('Available after'),
      cell: (row) => (
        <div>
          <p className='text-xs tabular-nums'>
            {formatTimestamp(row.available_at)}
          </p>
          {row.claimed_at > 0 && (
            <p className='text-muted-foreground mt-1 text-[10px]'>
              {t('Claimed')}: {formatTimestamp(row.claimed_at)}
            </p>
          )}
        </div>
      ),
    },
    {
      id: 'state',
      header: t('Status'),
      cell: (row) => {
        let state = row.state
        if (state === 'pending' && row.available_at > props.now) {
          state = 'cooling'
        }
        if (row.state === 'pending' && row.quota === 0) state = 'empty'
        if (row.state === 'pending' && row.qualification !== 'active') {
          state = row.qualification
        }
        if (row.quota > 0 && row.reversed >= row.quota) state = 'refunded'
        return <ReferralState state={state} />
      },
    },
    {
      id: 'claim',
      header: t('Actions'),
      cell: (row) => (
        <Button
          size='sm'
          variant='outline'
          disabled={
            !props.enabled ||
            props.claiming ||
            row.qualification !== 'active' ||
            row.state !== 'pending' ||
            row.available_at > props.now ||
            row.quota <= row.reversed
          }
          onClick={() => props.onClaim(row.id)}
        >
          {t('Claim reward')}
        </Button>
      ),
    },
  ]
  return (
    <div className='space-y-4'>
      <Tabs value={scope} onValueChange={(value) => setScope(String(value))}>
        <TabsList variant='line'>
          <TabsTrigger value='current'>{t('Current rewards')}</TabsTrigger>
          <TabsTrigger value='history'>{t('Historical rewards')}</TabsTrigger>
        </TabsList>
      </Tabs>
      <p className='text-muted-foreground text-xs'>
        {scope === 'history'
          ? t('Only issued historical rewards are shown here.')
          : t(
              'Cooling ends at the time shown. Qualification is rechecked when claiming.'
            )}
      </p>
      <ReferralTable<ReferralReward>
        key={`${scope}-${props.userID ?? 0}`}
        resource='rewards'
        params={{ historical: scope === 'history', user_id: props.userID }}
        columns={columns}
      />
    </div>
  )
}
