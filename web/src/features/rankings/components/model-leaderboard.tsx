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

import {
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { getLobeIcon } from '@/lib/lobe-icon'

import { formatShare, formatTokens } from '../lib/format'
import type { ModelRanking } from '../types'
import { ModelLink, VendorLink } from './entity-links'
import { GrowthText } from './growth-text'

type ModelLeaderboardProps = {
  rows: ModelRanking[]
}

export function ModelLeaderboard(props: ModelLeaderboardProps) {
  const { t } = useTranslation()
  const columns: StaticDataTableColumn<ModelRanking>[] = [
    {
      id: 'rank',
      header: <span aria-label={t('Rank')}>#</span>,
      className: 'rankings-rank-column',
      cell: (row) => (
        <span className='rankings-table-rank' data-rank={row.rank}>
          {row.rank}
        </span>
      ),
    },
    {
      id: 'model',
      header: t('Model'),
      cell: (row) => (
        <div className='rankings-table-model'>
          <span className='rankings-table-brand' aria-hidden>
            {getLobeIcon(row.vendor_icon, 24)}
          </span>
          <div className='min-w-0'>
            <ModelLink
              modelName={row.model_name}
              className='rankings-table-name'
            />
            <VendorLink vendor={row.vendor} className='rankings-table-vendor' />
          </div>
        </div>
      ),
    },
    {
      id: 'tokens',
      header: t('Token volume'),
      className: 'rankings-volume-column',
      cellClassName: 'text-right',
      cell: (row) => (
        <div className='rankings-table-volume'>
          <strong>{formatTokens(row.total_tokens)}</strong>
          <span className='rankings-table-share'>{formatShare(row.share)}</span>
          <GrowthText
            value={row.growth_pct}
            className='rankings-mobile-growth'
          />
        </div>
      ),
    },
    {
      id: 'growth',
      header: t('Growth'),
      className: 'rankings-growth-column',
      cellClassName: 'rankings-growth-column',
      cell: (row) => <GrowthText value={row.growth_pct} />,
    },
  ]

  return (
    <StaticDataTable
      columns={columns}
      data={props.rows}
      getRowKey={(row) => row.model_name}
      className='rounded-none border-0'
      tableClassName='rankings-table'
      tableProps={{ typography: 'content', 'aria-label': t('LLM Leaderboard') }}
    />
  )
}
