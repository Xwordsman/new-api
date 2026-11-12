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
import {
  ChevronDown,
  ChevronUp,
  Crown,
  Gift,
  ShieldAlert,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { toIntlLocale } from '@/i18n/languages'
import { formatBillingCurrencyFromUSD } from '@/lib/currency'
import { formatCompactNumber, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useSystemConfigStore } from '@/stores/system-config-store'

import type { BoardId, Period, RankEntry } from '../types'
import { PeriodTabs } from './period-tabs'

const icons = {
  invitations: Users,
  income: Gift,
  tokens: Zap,
  savings: Sparkles,
  cyber: ShieldAlert,
}
const tones = {
  invitations: 'bg-primary/10 text-primary',
  income:
    'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300',
  tokens: 'bg-primary/10 text-primary',
  savings: 'bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-300',
  cyber: 'bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-300',
}
const cardTones: Record<BoardId, IconBadgeTone> = {
  invitations: 'primary',
  income: 'success',
  tokens: 'info',
  savings: 'warning',
  cyber: 'destructive',
}

export function RankingCard(props: {
  board: BoardId
  title: string
  description: string
  periods: Record<Period, RankEntry[]>
  period: Period
  onPeriodChange: (period: Period) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const currency = useSystemConfigStore((state) => state.config.currency)
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  const Icon = icons[props.board]
  const rows = props.periods[props.period]
  const visible = expanded ? rows : rows.slice(0, 4)
  return (
    <Card
      role='region'
      aria-labelledby={`${id}-title`}
      className='gap-0 py-0'
      data-console-tone={cardTones[props.board]}
    >
      <CardHeader className='flex flex-row items-center gap-3 px-5 py-5'>
        <IconBadge size='lg' tone={cardTones[props.board]}>
          <Icon className='size-5' aria-hidden />
        </IconBadge>
        <CardTitle>
          <h3 id={`${id}-title`} className='font-semibold'>
            {props.title}
          </h3>
        </CardTitle>
      </CardHeader>
      <Tabs
        value={props.period}
        onValueChange={(value) => props.onPeriodChange(value as Period)}
        className='gap-4'
      >
        <div className='px-5'>
          <PeriodTabs label={props.title} />
        </div>
        {(['today', 'yesterday', 'all'] as const).map((period) => (
          <TabsContent key={period} value={period} className='mt-0'>
            <CardContent className='px-3 pb-3'>
              {rows.length === 0 ? (
                <EmptyState
                  className='min-h-52'
                  icon={Icon}
                  title={t('No rankings yet')}
                  description={t(
                    'Qualifying activity will appear after the next update.'
                  )}
                />
              ) : (
                <ol id={`${id}-rows`} className='space-y-1'>
                  {visible.map((entry) => {
                    let value = formatNumber(entry.value, locale)
                    let precise = value
                    if (props.board === 'tokens') {
                      value = formatCompactNumber(entry.value, locale)
                    }
                    if (props.board === 'income' || props.board === 'savings') {
                      value = formatBillingCurrencyFromUSD(
                        entry.value / currency.quotaPerUnit,
                        { locale, abbreviate: false }
                      )
                      precise = formatBillingCurrencyFromUSD(
                        entry.value / currency.quotaPerUnit,
                        {
                          locale,
                          digitsLarge: 6,
                          digitsSmall: 6,
                          abbreviate: false,
                        }
                      )
                    }
                    return (
                      <li
                        key={entry.rank}
                        className={cn(
                          'flex min-h-16 items-center gap-3 rounded-lg px-3 py-3',
                          entry.rank === 1 &&
                            'bg-amber-50/70 dark:bg-amber-950/20',
                          entry.is_me &&
                            'bg-sky-50 ring-1 ring-inset ring-sky-200 dark:bg-sky-950/40 dark:ring-sky-800'
                        )}
                      >
                        <span
                          className={cn(
                            'w-5 shrink-0 text-center text-sm font-semibold tabular-nums',
                            entry.rank <= 3
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-muted-foreground'
                          )}
                        >
                          {entry.rank === 1 ? (
                            <Crown
                              className='size-5'
                              aria-label={t('Rank {{rank}}', { rank: 1 })}
                            />
                          ) : (
                            entry.rank
                          )}
                        </span>
                        <Avatar>
                          <AvatarFallback
                            className={cn(
                              'text-xs font-semibold',
                              tones[props.board]
                            )}
                          >
                            {[...entry.name][0]}
                          </AvatarFallback>
                        </Avatar>
                        <span className='flex min-w-0 flex-1 items-center gap-2'>
                          <span
                            className='truncate font-medium'
                            title={entry.name}
                          >
                            {entry.name}
                          </span>
                          {entry.is_me && (
                            <Badge
                              variant='secondary'
                              className='bg-primary/10 text-primary shrink-0'
                            >
                              {t('Me')}
                            </Badge>
                          )}
                        </span>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span
                                tabIndex={0}
                                className='shrink-0 text-right font-semibold tabular-nums'
                              />
                            }
                          >
                            {value}
                            {props.board === 'cyber' && (
                              <span className='text-muted-foreground ml-1 text-xs font-normal'>
                                {t('warnings')}
                              </span>
                            )}
                          </TooltipTrigger>
                          <TooltipContent>{precise}</TooltipContent>
                        </Tooltip>
                      </li>
                    )
                  })}
                </ol>
              )}
              {rows.length > 4 && (
                <Button
                  variant='ghost'
                  className='text-muted-foreground mt-2 w-full'
                  aria-expanded={expanded}
                  aria-controls={`${id}-rows`}
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded ? (
                    <ChevronUp aria-hidden />
                  ) : (
                    <ChevronDown aria-hidden />
                  )}
                  {expanded
                    ? t('Collapse rankings')
                    : t('View top {{count}}', { count: rows.length })}
                </Button>
              )}
            </CardContent>
          </TabsContent>
        ))}
      </Tabs>
      <CardFooter className='text-muted-foreground mt-auto px-5 py-3 text-xs leading-relaxed'>
        {props.description}
      </CardFooter>
    </Card>
  )
}
