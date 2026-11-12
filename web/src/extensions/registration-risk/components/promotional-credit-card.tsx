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
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useSystemConfig } from '@/hooks/use-system-config'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { getCredit, registrationQueryKey } from '../api'

export function PromotionalCreditCard() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  useSystemConfig()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const query = useQuery({
    queryKey: [...registrationQueryKey, userId, 'credit'],
    queryFn: ({ signal }) => getCredit(signal),
    enabled: !!userId,
    refetchInterval: 30000,
  })
  if (query.isError) {
    return (
      <ErrorState
        className='bg-card rounded-xl border border-solid'
        onRetry={() => void query.refetch()}
      />
    )
  }
  const credit = query.data
  if (!credit?.grant) return null
  const grant = credit.grant
  const labels: Record<string, string> = {
    active: t('Active'),
    review: t('Pending review'),
    rejected: t('Rejected'),
    expired: t('Expired'),
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex flex-wrap items-center justify-between gap-3'>
          {t('Promotional credits')}
          <Badge variant='secondary'>
            {credit.enabled ? labels[grant.state ?? ''] : t('Paused')}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className='space-y-3'>
        <p className='text-2xl font-semibold tabular-nums'>
          {formatQuotaWithCurrency(grant.remaining ?? 0, { locale })}
          <span className='text-muted-foreground ml-2 text-sm font-normal'>
            / {formatQuotaWithCurrency(grant.total ?? 0, { locale })}
          </span>
        </p>
        <p className='text-muted-foreground text-sm'>
          {t('Expires at')}:{' '}
          {grant.expires_at
            ? new Date(grant.expires_at * 1000).toLocaleString(locale)
            : '—'}
        </p>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Promotional credits are separate from paid balance and cannot be transferred. Eligible synchronous requests use them for the initial estimate; additional costs use paid balance. Asynchronous tasks and realtime requests use their usual funding.'
          )}
        </p>
        {credit.models && (
          <p className='text-muted-foreground text-sm break-words'>
            {t('Eligible models')}:{' '}
            {credit.models.length
              ? credit.models.join(', ')
              : t('All synchronous models')}{' '}
            · {t('Requests/min')}: {formatNumber(credit.rpm ?? 0, locale)} ·{' '}
            {t('Concurrency')}: {formatNumber(credit.concurrency ?? 0, locale)}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
