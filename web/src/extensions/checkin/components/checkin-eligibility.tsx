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
import { Link } from '@tanstack/react-router'
import { CircleCheck, Gift, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from '@/components/ui/progress'
import { toIntlLocale } from '@/i18n/languages'

import { formatCheckinPayment } from '../lib/format'
import type { CheckinDashboard } from '../types'

export function CheckinEligibility(props: {
  data: CheckinDashboard
  pending: boolean
  onClaim: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const eligibility = props.data.eligibility
  const threshold = Number(props.data.rules.threshold_amount)
  const qualified = Number(eligibility.qualified_amount)
  const progress =
    threshold > 0
      ? Math.min(100, Math.max(0, (qualified / threshold) * 100))
      : 100
  let buttonLabel = t('Check in now')
  if (props.pending) buttonLabel = t('Checking in...')
  else if (props.data.checked_in_today) buttonLabel = t('Checked in')
  const blockedReason = props.data.claim_reason || eligibility.reason

  return (
    <Card data-card-hover='false'>
      <CardContent className='flex flex-col gap-6 sm:flex-row sm:items-center'>
        <div className='flex min-w-0 flex-1 gap-3'>
          <IconBadge tone='primary' size='lg'>
            {props.data.checked_in_today ? (
              <CircleCheck aria-hidden='true' />
            ) : (
              <Gift aria-hidden='true' />
            )}
          </IconBadge>
          <div className='min-w-0 flex-1 space-y-3'>
            <div>
              <h2 className='text-base font-semibold'>
                {eligibility.eligible
                  ? t('Your check-in qualification is active')
                  : t('Check-in qualification')}
              </h2>
              {blockedReason && (
                <p className='text-muted-foreground mt-1 text-sm' role='status'>
                  {t(blockedReason)}
                </p>
              )}
            </div>
            {threshold > 0 ? (
              <Progress value={progress} className='max-w-xl'>
                <ProgressLabel className='text-muted-foreground text-xs'>
                  {t('Verified net recharge')}
                </ProgressLabel>
                <ProgressValue className='text-xs'>
                  {() =>
                    `${formatCheckinPayment(eligibility.qualified_amount, eligibility.currency, locale)} / ${formatCheckinPayment(props.data.rules.threshold_amount, eligibility.currency, locale)}`
                  }
                </ProgressValue>
              </Progress>
            ) : (
              <p className='text-muted-foreground text-sm'>
                {t('No recharge required')}
              </p>
            )}
            {threshold > 0 && Number(eligibility.remaining_amount) > 0 && (
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Recharge {{amount}} more to reach the check-in threshold.',
                  {
                    amount: formatCheckinPayment(
                      eligibility.remaining_amount,
                      eligibility.currency,
                      locale
                    ),
                  }
                )}
              </p>
            )}
            {threshold > 0 && eligibility.expires_at > 0 && (
              <p className='text-muted-foreground text-xs'>
                {t('Qualification expires: {{date}}', {
                  date: new Intl.DateTimeFormat(locale, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: props.data.timezone,
                  }).format(eligibility.expires_at * 1000),
                })}
              </p>
            )}
          </div>
        </div>
        <div className='flex shrink-0 flex-col gap-2 sm:min-w-36'>
          <Button
            onClick={props.onClaim}
            disabled={!props.data.claimable || props.pending}
          >
            <Gift aria-hidden='true' />
            {buttonLabel}
          </Button>
          {!eligibility.eligible && (
            <Button variant='outline' render={<Link to='/wallet' />}>
              <Wallet aria-hidden='true' />
              {t('Go to wallet')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
