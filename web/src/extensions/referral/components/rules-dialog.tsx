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

import { Dialog } from '@/components/dialog'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'

import type { ReferralSettings } from '../types'

export function RulesDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings?: ReferralSettings
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const settings = props.settings
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Referral program rules')}
      description={t('Transparent rewards. Verified payments.')}
      bodyClassName='space-y-5 text-sm leading-7'
    >
      {settings && (
        <div className='bg-muted/30 rounded-lg border p-4 font-medium'>
          {t('Reward rule summary', {
            rate: formatNumber(settings.rate_bps / 100, locale),
            days: settings.window_days,
            hours: settings.cooling_hours,
            cap: formatQuotaWithCurrency(settings.cap_quota, {
              locale,
              abbreviate: false,
            }),
          })}
        </div>
      )}
      <ol className='list-decimal space-y-3 pl-5'>
        <li>
          {t(
            'Rewards apply only to verified wallet payments, net of refunds. Gifts, redemption codes, subscriptions and referral transfers do not qualify.'
          )}
        </li>
        <li>
          {t(
            'The reward window starts when your friend registers. Rules are saved at registration; later changes apply to new invitees.'
          )}
        </li>
        <li>
          {t(
            'After cooling, eligible rewards can be claimed into your referral balance and transferred to your wallet. They do not count as paid top-ups or VIP spending.'
          )}
        </li>
        <li>
          {t(
            'Self-referrals are not eligible. Shared registration networks, clients or payment accounts require review. Qualification is checked again when claiming.'
          )}
        </li>
        <li>
          {t(
            'Refunds reverse the corresponding reward. Any shortfall offsets future referral income; your wallet is not debited.'
          )}
        </li>
        <li>
          {t(
            'Historical invitations require approval. Old orders and unsupported currencies require explicit reconciliation before rewards can be issued.'
          )}
        </li>
      </ol>
    </Dialog>
  )
}
