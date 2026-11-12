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

export function RatesTable(props: {
  accepted: Record<string, number> | null
  current: Record<string, number>
}) {
  const { t, i18n } = useTranslation()
  const formatter = new Intl.NumberFormat(
    toIntlLocale(i18n.resolvedLanguage || i18n.language),
    { maximumFractionDigits: 8 }
  )
  const groups = [
    ...new Set([
      ...Object.keys(props.accepted ?? {}),
      ...Object.keys(props.current),
    ]),
  ]
  return (
    <StaticDataTable
      data={groups}
      getRowKey={(group) => group}
      emptyContent={t('No available groups')}
      columns={[
        {
          id: 'group',
          header: t('Group'),
          cell: (group) => <span className='break-all'>{group}</span>,
        },
        {
          id: 'accepted',
          header: t('Accepted multiplier'),
          cell: (group) =>
            props.accepted?.[group] === undefined
              ? '—'
              : `×${formatter.format(props.accepted[group])}`,
        },
        {
          id: 'current',
          header: t('Current multiplier'),
          cell: (group) =>
            props.current[group] === undefined
              ? t('Unavailable')
              : `×${formatter.format(props.current[group])}`,
        },
      ]}
    />
  )
}
