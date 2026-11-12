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
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Banknote, Wallet } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { buttonVariants } from '@/components/ui/button'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { getUserProfile } from '@/features/profile/api'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { createServerError } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

export function HeaderBalance() {
  const { t, i18n } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const currency = useSystemConfigStore((state) => state.config.currency)
  const [open, setOpen] = useState(false)
  const balance = useQuery({
    queryKey: ['account-balance', user?.id],
    queryFn: async () => {
      const response = await getUserProfile()
      if (
        !response.success ||
        !response.data ||
        response.data.id !== user?.id
      ) {
        throw createServerError(response, t('Failed to load profile'))
      }
      return {
        quota: response.data.quota,
        usedQuota: response.data.used_quota,
      }
    },
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    meta: { errorToast: false },
  })

  if (!user) return null

  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const formatOptions = {
    locale,
    abbreviate: currency.quotaDisplayType === 'TOKENS',
  }
  const availableBalance = formatQuotaWithCurrency(
    balance.data?.quota ?? user.quota,
    formatOptions
  )
  const totalUsage = formatQuotaWithCurrency(
    balance.data?.usedQuota ?? user.used_quota,
    formatOptions
  )

  return (
    <HoverCard
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen && balance.isStale) void balance.refetch()
      }}
    >
      <HoverCardTrigger
        delay={150}
        closeDelay={150}
        render={<Link to='/wallet' />}
        aria-label={`${t('Balance')}: ${availableBalance}`}
        className={cn(
          buttonVariants({ variant: 'ghost' }),
          'bg-primary/8 text-primary hover:bg-primary/12 hover:text-primary data-popup-open:bg-primary/12 dark:text-primary-foreground dark:hover:bg-primary/12 dark:hover:text-primary-foreground me-1 h-8 min-w-8 shrink gap-1.5 px-1 text-[13px] font-semibold tabular-nums min-[360px]:px-2 sm:me-0 sm:shrink-0 sm:gap-2 sm:px-2.5'
        )}
        onClick={() => setOpen(false)}
      >
        <Banknote
          className='size-4 min-[360px]:hidden sm:block'
          aria-hidden='true'
        />
        <span className='hidden max-w-24 min-w-0 truncate min-[360px]:block sm:max-w-40'>
          {availableBalance}
        </span>
      </HoverCardTrigger>
      <HoverCardContent
        align='end'
        alignOffset={0}
        sideOffset={10}
        className='w-64 max-w-[calc(100vw-2rem)] p-0'
        aria-label={t('Balance')}
      >
        <dl className='space-y-3 p-4'>
          <div className='flex items-baseline justify-between gap-4'>
            <dt className='text-muted-foreground text-xs'>
              {t('Available Balance')}
            </dt>
            <dd className='text-primary dark:text-primary-foreground text-end text-sm font-semibold break-all tabular-nums'>
              {availableBalance}
            </dd>
          </div>
          <div className='flex items-baseline justify-between gap-4'>
            <dt className='text-muted-foreground text-xs'>
              {t('Total Usage')}
            </dt>
            <dd className='text-end text-sm font-medium break-all tabular-nums'>
              {totalUsage}
            </dd>
          </div>
        </dl>
        {balance.isError && (
          <p role='status' className='text-muted-foreground px-4 pb-3 text-xs'>
            {t('Failed to load profile')}
          </p>
        )}
        <div className='border-t p-1.5'>
          <Link
            to='/wallet'
            className={cn(
              buttonVariants({ variant: 'ghost' }),
              'text-primary hover:bg-primary/8 hover:text-primary dark:text-primary-foreground dark:hover:bg-primary/8 dark:hover:text-primary-foreground w-full justify-between px-2.5'
            )}
            onClick={() => setOpen(false)}
          >
            <span className='flex items-center gap-2'>
              <Wallet className='size-4' aria-hidden='true' />
              {t('Wallet')}
            </span>
            <ArrowUpRight className='size-3.5' aria-hidden='true' />
          </Link>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
