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
import { useNavigate, useSearch } from '@tanstack/react-router'

import { PublicLayout } from '@/components/layout'
import { Footer } from '@/components/layout/components/footer'
import { PageTransition } from '@/components/page-transition'

import { RankingsContent } from './components/rankings-content'
import { RankingsHero } from './components/rankings-hero'
import { useRankings } from './hooks/use-rankings'
import type { RankingPeriod } from './types'

const VALID_PERIODS = new Set<RankingPeriod>(['today', 'week', 'month', 'year'])

export function Rankings() {
  const search = useSearch({ from: '/rankings/' })
  const navigate = useNavigate()

  const period: RankingPeriod = VALID_PERIODS.has(
    search.period as RankingPeriod
  )
    ? (search.period as RankingPeriod)
    : 'week'

  const rankingsQuery = useRankings(period)
  const snapshot = rankingsQuery.data?.data

  const handlePeriodChange = (next: RankingPeriod) => {
    navigate({
      to: '/rankings',
      search: (prev) => ({ ...prev, period: next }),
    })
  }

  return (
    <PublicLayout showMainContainer={false}>
      <main className='rankings-page'>
        <RankingsHero
          snapshot={snapshot}
          pending={rankingsQuery.isLoading || !snapshot}
          period={period}
          onPeriodChange={handlePeriodChange}
        />
        <PageTransition className='rankings-container rankings-content'>
          <RankingsContent
            snapshot={snapshot}
            pending={rankingsQuery.isLoading}
            period={period}
            onRetry={() => void rankingsQuery.refetch()}
          />
        </PageTransition>
      </main>
      <Footer />
    </PublicLayout>
  )
}
