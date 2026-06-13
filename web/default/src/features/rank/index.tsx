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
import { BarChart3, Hash, ListChecks, Trophy } from 'lucide-react'
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

const maskUsername = (username: string) => {
  if (!username) return '—'
  if (username.length <= 2) return username
  return `${username[0]}${'＊'.repeat(Math.min(username.length - 2, 6))}${
    username[username.length - 1]
  }`
}

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
            <RankSummaryCards summary={data.summary} currentUser={data.current_user} />
            <RankTable rows={data.items ?? []} currentUsername={data.current_user?.username} />
          </>
        )}
      </PageTransition>
    </PublicLayout>
  )
}

function RankSummaryCards(props: { summary: RankSummary; currentUser?: RankRow }) {
  const { t } = useTranslation()

  const baseCards = [
    {
      title: t('Prompt tokens'),
      value: props.summary.prompt_tokens,
      icon: Hash,
      isRank: false,
    },
    {
      title: t('Completion tokens'),
      value: props.summary.completion_tokens,
      icon: ListChecks,
      isRank: false,
    },
    {
      title: t('Total tokens'),
      value: props.summary.total_tokens,
      icon: BarChart3,
      isRank: false,
    },
  ]

  const rankCard = props.currentUser
    ? {
        title: t('Your rank'),
        value: props.currentUser.rank,
        icon: Trophy,
        isRank: true,
      }
    : null

  const cards = rankCard ? [rankCard, ...baseCards] : baseCards

  return (
    <div className='grid gap-3 md:grid-cols-3 lg:grid-cols-4'>
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <Card key={card.title}>
            <CardHeader className='space-y-0 pb-2'>
              <div className='flex items-center gap-2'>
                <Icon className='text-muted-foreground size-4' />
                <CardTitle className='text-sm font-medium'>{card.title}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className='text-2xl font-semibold tracking-tight'>
                {card.isRank ? `#${card.value}` : formatNumber(card.value)}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function RankTable(props: { rows: RankRow[]; currentUsername?: string }) {
  const { t } = useTranslation()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(‘Rankings’)}</CardTitle>
        <CardDescription>{t(‘Today’s usage grouped by user and API key.’)}</CardDescription>
      </CardHeader>
      <CardContent>
        {props.rows.length === 0 ? (
          <div className=’text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm’>
            {t(‘No ranking data for today’)}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t(‘Rank’)}</TableHead>
                <TableHead>{t(‘Username’)}</TableHead>
                <TableHead className=’text-right’>{t(‘Requests’)}</TableHead>
                <TableHead className=’text-right’>{t(‘Prompt tokens’)}</TableHead>
                <TableHead className=’text-right’>
                  {t(‘Completion tokens’)}
                </TableHead>
                <TableHead className=’text-right’>{t(‘Total tokens’)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.rows.map((row) => {
                const isCurrentUser = props.currentUsername && row.username === props.currentUsername
                return (
                  <TableRow
                    key={`${row.rank}-${row.username}`}
                    className={isCurrentUser ? ‘bg-primary/5’ : ‘’}
                  >
                    <TableCell className=’font-medium’>#{row.rank}</TableCell>
                    <TableCell className={isCurrentUser ? ‘text-primary font-bold’ : ‘text-primary font-semibold’}>
                      {maskUsername(row.username)}
                    </TableCell>
                    <TableCell className=’text-right’>
                      {formatNumber(row.request_count)}
                    </TableCell>
                    <TableCell className=’text-right’>
                      {formatNumber(row.prompt_tokens)}
                    </TableCell>
                    <TableCell className=’text-right’>
                      {formatNumber(row.completion_tokens)}
                    </TableCell>
                    <TableCell className=’text-right font-medium’>
                      {formatNumber(row.total_tokens)}
                    </TableCell>
                  </TableRow>
                )
              })}
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
      <div className='grid gap-3 md:grid-cols-3 lg:grid-cols-4'>
        <Skeleton className='h-32 rounded-xl' />
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
