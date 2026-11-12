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
import { formatNumber } from '@/lib/format'

import type { Occupancy } from '../types'

export function OccupancyTable(props: { items: Occupancy[] }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return (
    <StaticDataTable
      data={props.items}
      getRowKey={(item) => item.resource}
      emptyContent={t('No concurrency activity yet')}
      columns={[
        {
          id: 'resource',
          header: t('Resource'),
          cell: (item) => {
            const parts = item.resource.split(':')
            if (parts[0] === 'wait') return `${t('Account queue')} #${parts[2]}`
            if (parts[0] === 'user') return `${t('User')} #${parts[1]}`
            if (parts[2] === 'key') {
              return `${t('Channel')} #${parts[1]} · ${t('Credential fingerprint')} ${parts[3]?.slice(0, 12) ?? ''}`
            }
            return `${t('Channel')} #${parts[1]}`
          },
        },
        {
          id: 'active',
          header: t('Active / waiting'),
          cell: (item) => formatNumber(item.active, locale),
        },
        {
          id: 'limit',
          header: t('Last effective limit'),
          cell: (item) =>
            item.limit === 0
              ? t('Unlimited')
              : formatNumber(item.limit, locale),
        },
        {
          id: 'admitted',
          header: t('Admissions'),
          cell: (item) => formatNumber(item.admitted, locale),
        },
        {
          id: 'rejected',
          header: t('Refused attempts'),
          cell: (item) => formatNumber(item.rejected, locale),
        },
      ]}
    />
  )
}
