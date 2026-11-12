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

import { StaticDataTable } from '@/components/data-table'
import { toIntlLocale } from '@/i18n/languages'

import type { PriceEvent } from '../types'

export function PriceEventsTable(props: {
  events: PriceEvent[]
  admin?: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const ratios = new Intl.NumberFormat(locale, { maximumFractionDigits: 8 })
  const actions: Record<string, string> = {
    paused: t('Paused by price protection'),
    accepted: t('Multipliers accepted'),
    opted_out: t('Price protection disabled for Key'),
    settings: t('Settings updated'),
  }
  const reasons: Record<string, string> = {
    confirmation_required: t('Existing Key requires confirmation'),
    group_changed: t('Key routing changed'),
    new_group: t('Unconfirmed group'),
    ratio_increased: t('Group multiplier increased'),
  }
  return (
    <StaticDataTable
      data={props.events}
      getRowKey={(event) => event.id}
      emptyContent={t('No protection events yet')}
      columns={[
        {
          id: 'time',
          header: t('Time'),
          cell: (event) =>
            new Date(event.created_at * 1000).toLocaleString(locale),
        },
        ...(props.admin
          ? [
              {
                id: 'key',
                header: t('User / Key / Actor'),
                cell: (event: PriceEvent) =>
                  `${event.user_id || '—'} / ${event.token_id || '—'} / ${event.actor_id || '—'}`,
              },
            ]
          : []),
        {
          id: 'action',
          header: t('Action'),
          cell: (event) => (
            <div>
              {actions[event.action] ?? event.action}
              <div className='text-muted-foreground text-xs'>
                {reasons[event.reason] ?? event.reason}
              </div>
            </div>
          ),
        },
        {
          id: 'ratio',
          header: t('Multiplier change'),
          cell: (event) =>
            event.group ? (
              <span className='break-all'>
                {event.group}: ×{ratios.format(event.previous_ratio)} → ×
                {ratios.format(event.current_ratio)}
              </span>
            ) : (
              '—'
            ),
        },
      ]}
    />
  )
}
