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
import { ArrowUpRight, BarChart3, Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

import type { RankingPeriod, RankingsSnapshot } from '../types'
import { MarketShareSection } from './market-share-section'
import { ModelLeaderboard } from './model-leaderboard'
import { ModelsSection } from './models-section'
import { PulseSection } from './pulse-section'
import { TopModels } from './top-models'

type RankingsContentProps = {
  snapshot?: RankingsSnapshot
  pending: boolean
  period: RankingPeriod
  onRetry: () => void
}

export function RankingsContent(props: RankingsContentProps) {
  const { t } = useTranslation()

  if (props.pending) {
    return (
      <div
        role='status'
        aria-label={t('Loading...')}
        className='rankings-loading'
      >
        <span className='sr-only'>{t('Loading...')}</span>
        <div className='grid gap-4 sm:grid-cols-3' aria-hidden>
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className='h-48' />
          ))}
        </div>
        <Skeleton className='h-96' aria-hidden />
      </div>
    )
  }

  if (!props.snapshot) {
    return (
      <ErrorState
        title={t('Unable to load rankings')}
        description={t('Please try again to load the rankings.')}
        onRetry={props.onRetry}
        className='rankings-result-state'
      />
    )
  }

  const snapshot = props.snapshot
  const hasActivity =
    snapshot.models.length > 0 ||
    snapshot.vendors.length > 0 ||
    snapshot.models_history.points.length > 0 ||
    snapshot.vendor_share_history.points.length > 0 ||
    snapshot.top_movers.length > 0 ||
    snapshot.top_droppers.length > 0

  if (!hasActivity) {
    return (
      <EmptyState
        icon={BarChart3}
        title={t('No ranking data for this period')}
        description={t(
          'Try another period, or explore the model catalog while usage data builds up.'
        )}
        className='rankings-result-state'
        action={
          <Button variant='outline' role='link' render={<Link to='/pricing' />}>
            {t('Explore models')}
            <ArrowUpRight data-icon='inline-end' aria-hidden />
          </Button>
        }
      />
    )
  }

  return (
    <div className='rankings-results'>
      <TopModels rows={snapshot.models} />
      <div className='rankings-main-grid'>
        <Card className='rankings-panel rankings-leaderboard'>
          <CardHeader className='rankings-panel-header'>
            <div className='rankings-panel-title'>
              <span className='rankings-panel-icon'>
                <Trophy className='size-4' aria-hidden />
              </span>
              <h3>{t('LLM Leaderboard')}</h3>
            </div>
            <CardDescription>
              {t('Compare the most popular models on the platform')}
            </CardDescription>
          </CardHeader>
          <CardContent className='rankings-leaderboard-content'>
            {snapshot.models.length > 0 ? (
              <ModelLeaderboard rows={snapshot.models} />
            ) : (
              <EmptyState title={t('No models match the selected filters')} />
            )}
          </CardContent>
        </Card>
        <div className='rankings-analytics'>
          <ModelsSection
            history={snapshot.models_history}
            rows={snapshot.models}
            period={props.period}
          />
          <MarketShareSection
            history={snapshot.vendor_share_history}
            rows={snapshot.vendors}
            period={props.period}
          />
        </div>
      </div>
      <PulseSection
        movers={snapshot.top_movers}
        droppers={snapshot.top_droppers}
      />
    </div>
  )
}
