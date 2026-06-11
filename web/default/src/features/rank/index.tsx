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
import { BarChart3, Hash, ListChecks } from 'lucide-react'
import { PublicLayout } from '@/components/layout'
import { PageTransition } from '@/components/page-transition'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useRank } from './hooks/use-rank'
import type { RankRow, RankSummary } from './types'

const formatNumber = (value: number) => new Intl.NumberFormat().format(value)

const formatTokenSuffix = (suffix: string) => (suffix ? `••••${suffix}` : '—')

export function Rank() {
  const { t } = useTranslation()
  const rankQuery = useRank()
  const data = rankQuery.data?.data

  return (
    <PublicLayout showMainContainer={false}>
      <PageTransition className='mx-auto w-full max-w-[1280px] space-y-8 px-3 pt-16 pb-10 sm:px-6 sm:pt-20 sm:pb-12 xl:px-8'>
        <section className='space-y-3'>
          <h1 className='text-[clamp(1.75rem,4vw,2.5rem)] leading-[1.15] font-bold tracking-tight'>
            {t("Today's Usage Rankings")}
          </h1>
          <p className='text-muted-foreground/80 max-w-2xl text-sm'>
            {t(
              'See today’s token usage leaderboard across users and API keys.'
            )}
          </p>
        </section>

        {rankQuery.isLoading ? (
          <RankLoading />
        ) : !data ? (
          <RankError
            message={
              rankQuery.error instanceof Error
                ? rankQuery.error.message
                : t('Unable to load ranking data')
            }
          />
        ) : (
          <>
            <RankSummaryCards summary={data.summary} />
            <RankTable rows={data.items} />
          </>
        )}
      </PageTransition>
    </PublicLayout>
  )
}

function RankSummaryCards(props: { summary: RankSummary }) {
  const { t } = useTranslation()
  const cards = [
    {
      title: t('Prompt tokens'),
      value: props.summary.prompt_tokens,
      icon: Hash,
    },
    {
      title: t('Completion tokens'),
      value: props.summary.completion_tokens,
      icon: ListChecks,
    },
    {
      title: t('Total tokens'),
      value: props.summary.total_tokens,
      icon: BarChart3,
    },
  ]

  return (
    <div className='grid gap-3 md:grid-cols-3'>
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <Card key={card.title}>
            <CardHeader className='flex-row items-center justify-between space-y-0'>
              <CardTitle>{card.title}</CardTitle>
              <Icon className='text-muted-foreground size-5' />
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-semibold tracking-tight'>
                {formatNumber(card.value)}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function RankTable(props: { rows: RankRow[] }) {
  const { t } = useTranslation()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Rankings')}</CardTitle>
        <CardDescription>{t('Today’s usage grouped by user and API key.')}</CardDescription>
      </CardHeader>
      <CardContent>
        {props.rows.length === 0 ? (
          <div className='text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm'>
            {t('No ranking data for today')}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Rank')}</TableHead>
                <TableHead>{t('Name')}</TableHead>
                <TableHead>{t('Token suffix')}</TableHead>
                <TableHead>{t('Username')}</TableHead>
                <TableHead className='text-right'>{t('Requests')}</TableHead>
                <TableHead className='text-right'>{t('Prompt tokens')}</TableHead>
                <TableHead className='text-right'>
                  {t('Completion tokens')}
                </TableHead>
                <TableHead className='text-right'>{t('Total tokens')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.rows.map((row) => (
                <TableRow key={`${row.rank}-${row.username}-${row.name}`}>
                  <TableCell className='font-medium'>#{row.rank}</TableCell>
                  <TableCell>{row.name || '—'}</TableCell>
                  <TableCell className='font-mono'>
                    {formatTokenSuffix(row.token_suffix)}
                  </TableCell>
                  <TableCell>{row.username || '—'}</TableCell>
                  <TableCell className='text-right'>
                    {formatNumber(row.request_count)}
                  </TableCell>
                  <TableCell className='text-right'>
                    {formatNumber(row.prompt_tokens)}
                  </TableCell>
                  <TableCell className='text-right'>
                    {formatNumber(row.completion_tokens)}
                  </TableCell>
                  <TableCell className='text-right font-medium'>
                    {formatNumber(row.total_tokens)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function RankLoading() {
  return (
    <div className='space-y-6'>
      <div className='grid gap-3 md:grid-cols-3'>
        <Skeleton className='h-32 rounded-xl' />
        <Skeleton className='h-32 rounded-xl' />
        <Skeleton className='h-32 rounded-xl' />
      </div>
      <Skeleton className='h-[420px] rounded-xl' />
    </div>
  )
}

function RankError(props: { message: string }) {
  const { t } = useTranslation()
  return (
    <div className='bg-card rounded-xl border border-dashed px-6 py-12 text-center'>
      <h2 className='text-foreground text-base font-semibold'>
        {t('Unable to load rankings')}
      </h2>
      <p className='text-muted-foreground mx-auto mt-2 max-w-md text-sm'>
        {props.message}
      </p>
    </div>
  )
}
