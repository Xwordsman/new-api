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
import { useTranslation } from 'react-i18next'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'

import { formatCheckinPayment } from '../lib/format'
import type { CheckinDashboard } from '../types'

export function CheckinRules(props: { data: CheckinDashboard }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const rules = props.data.rules
  const requiresRecharge = Number(rules.threshold_amount) > 0
  const amount = (quota: number) =>
    formatQuotaWithCurrency(quota, { locale, abbreviate: false })
  const reward =
    rules.reward_mode === 'fixed'
      ? amount(rules.reward_min_quota)
      : `${amount(rules.reward_min_quota)} – ${amount(rules.reward_max_quota)}`
  const ruleRows = [
    { label: t('Daily reward'), value: reward },
    {
      label: t('Recharge threshold'),
      value: requiresRecharge
        ? formatCheckinPayment(rules.threshold_amount, rules.currency, locale)
        : t('No recharge required'),
    },
    ...(requiresRecharge
      ? [
          {
            label: t('Eligible recharge period'),
            value:
              rules.recharge_mode === 'lifetime'
                ? t('Lifetime net recharge')
                : t('Past {{days}} days', {
                    days: formatNumber(rules.lookback_days, locale),
                  }),
          },
          {
            label: t('Qualification duration'),
            value:
              rules.eligibility_days === 0
                ? t('No expiry')
                : t('{{days}} days', {
                    days: formatNumber(rules.eligibility_days, locale),
                  }),
          },
        ]
      : []),
    {
      label: t('Monthly reward cap'),
      value:
        rules.monthly_cap_quota === 0
          ? t('Unlimited')
          : amount(rules.monthly_cap_quota),
    },
    {
      label: t('Lifetime reward cap'),
      value:
        rules.lifetime_cap_quota === 0
          ? t('Unlimited')
          : amount(rules.lifetime_cap_quota),
    },
    {
      label: t('Daily site budget'),
      value:
        rules.daily_budget_quota === 0
          ? t('Unlimited')
          : amount(rules.daily_budget_quota),
    },
  ]

  return (
    <Card data-card-hover='false' className='h-fit min-w-0'>
      <CardHeader>
        <CardTitle>{t('Check-in rules')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-5'>
        <dl className='divide-y'>
          {ruleRows.map((row) => (
            <div
              key={row.label}
              className='flex items-start justify-between gap-4 py-3 first:pt-0'
            >
              <dt className='text-muted-foreground text-xs'>{row.label}</dt>
              <dd className='text-right text-sm font-medium tabular-nums'>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
        <div className='text-muted-foreground space-y-2 text-xs leading-6'>
          {requiresRecharge ? (
            <>
              <p>
                {t(
                  'Only verified payments count. Refunds are deducted; gifts, redemption codes and administrator balance adjustments do not count.'
                )}
              </p>
              <p>
                {rules.include_subscriptions
                  ? t(
                      'Verified subscription payments also count toward qualification.'
                    )
                  : t(
                      'Subscription payments do not count toward qualification.'
                    )}
              </p>
              {rules.eligibility_days > 0 && (
                <p>
                  {rules.renew_on_recharge
                    ? t(
                        'A new qualifying recharge renews the qualification period.'
                      )
                    : t(
                        'Later recharges do not extend the qualification period.'
                      )}
                </p>
              )}
            </>
          ) : (
            <p>
              {t(
                'A zero recharge threshold removes recharge and qualification expiry requirements. Other checks still apply.'
              )}
            </p>
          )}
          {rules.follow_registration_risk && (
            <p>
              {t(
                'Accounts under registration risk review cannot claim check-in rewards until cleared.'
              )}
            </p>
          )}
          <p>
            {t('Next reset: {{date}}', {
              date: new Intl.DateTimeFormat(locale, {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: props.data.timezone,
              }).format(props.data.next_reset_at * 1000),
            })}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
