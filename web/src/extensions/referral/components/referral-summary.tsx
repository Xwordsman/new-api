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
  ArrowUpRight,
  BadgeCheck,
  Clock3,
  Gift,
  Link2,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { StatCardValue } from '@/components/stat-card-value'
import { Button } from '@/components/ui/button'
import { IconBadge } from '@/components/ui/icon-badge'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency, getCurrencyDisplay } from '@/lib/currency'
import { formatNumber } from '@/lib/format'

import type { ReferralDashboard } from '../types'

export function ReferralSummary(props: {
  data: ReferralDashboard
  onTransfer: () => void
  pendingTransfer?: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { meta } = getCurrencyDisplay()
  const currencySymbol = meta.kind === 'tokens' ? undefined : meta.symbol
  const money = (quota: number) =>
    formatQuotaWithCurrency(quota, { locale, abbreviate: false })
  const data = props.data
  const rules = data.settings
  const link = `${window.location.origin}/sign-up?aff=${encodeURIComponent(data.code)}`
  const ruleItems = [
    {
      icon: Users,
      label: t('Reward window'),
      value: t('{{count}} days', { count: rules.window_days }),
    },
    {
      icon: Clock3,
      label: t('Cooling period'),
      value: t('{{count}} hours', { count: rules.cooling_hours }),
    },
    { icon: Gift, label: t('Per-invitee cap'), value: money(rules.cap_quota) },
    {
      icon: ShieldCheck,
      label: t('Qualification'),
      value: t('Verified payment'),
    },
  ]
  return (
    <>
      <section
        className='console-surface bg-card relative overflow-hidden rounded-xl border'
        aria-label={t('Invite and earn')}
      >
        <div className='grid grid-cols-1 lg:grid-cols-[1.35fr_1fr]'>
          <div className='relative z-10 min-w-0 space-y-6 p-6 sm:p-8'>
            <div className='text-muted-foreground flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] uppercase'>
              <span className='bg-primary size-1.5 rounded-full' />
              {t('Referral program')}
            </div>
            <div className='flex flex-wrap items-end gap-x-5 gap-y-2'>
              <p className='text-6xl leading-none font-medium tracking-tighter sm:text-7xl'>
                {formatNumber(rules.rate_bps / 100, locale)}
                <span className='text-primary ml-1 text-3xl'>%</span>
              </p>
              <div className='pb-1'>
                <h3 className='text-lg font-semibold'>
                  {t('Invite friends. Share the rewards.')}
                </h3>
                <p className='text-muted-foreground mt-1 text-sm'>
                  {t('Earn from every eligible paid top-up.')}
                </p>
              </div>
            </div>
            <div className='max-w-xl space-y-2'>
              <div className='flex flex-wrap items-center justify-between gap-3 text-xs'>
                <span className='text-muted-foreground'>
                  {t('Your referral link')}
                </span>
                <span className='flex items-center gap-1.5'>
                  {t('Referral code')}
                  <code className='font-semibold'>{data.code}</code>
                  <CopyButton
                    value={data.code}
                    size='sm'
                    className='size-6'
                    aria-label={t('Copy referral code')}
                  />
                </span>
              </div>
              <div className='bg-muted/35 flex min-w-0 items-center gap-2 rounded-lg border p-2 pl-3'>
                <Link2
                  className='text-muted-foreground size-4 shrink-0'
                  aria-hidden='true'
                />
                <span className='min-w-0 flex-1 truncate font-mono text-xs'>
                  {link}
                </span>
                <CopyButton
                  value={link}
                  variant='default'
                  size='sm'
                  aria-label={t('Copy referral link')}
                >
                  {t('Copy link')}
                </CopyButton>
              </div>
              <p className='text-muted-foreground text-[11px]'>
                {t(
                  'Your link stays valid. Each invitee has their own reward window.'
                )}
              </p>
            </div>
          </div>
          <div
            className='from-primary/3 to-info/7 relative hidden min-h-60 items-center justify-center overflow-hidden border-l bg-linear-to-br via-transparent lg:flex'
            aria-hidden='true'
          >
            <div className='border-primary/10 absolute size-72 rounded-full border' />
            <div className='border-primary/15 absolute size-48 rounded-full border' />
            <div className='bg-card border-primary/20 shadow-primary/5 absolute z-10 flex size-16 items-center justify-center rounded-2xl border shadow-lg'>
              <Gift className='text-primary size-7' />
            </div>
            <div className='bg-card absolute top-10 left-8 flex items-center gap-2 rounded-lg border px-3 py-2 shadow-sm'>
              <span className='bg-primary/10 text-primary size-6 rounded-full p-1'>
                <Users className='size-4' />
              </span>
              <span className='text-muted-foreground font-mono text-xs'>
                de***
              </span>
              <BadgeCheck className='text-primary size-3.5' />
            </div>
            <div className='bg-card absolute right-7 bottom-9 flex items-center gap-2 rounded-lg border px-3 py-2 shadow-sm'>
              <span className='bg-info/10 text-info size-6 rounded-full p-1'>
                <Users className='size-4' />
              </span>
              <span className='text-muted-foreground font-mono text-xs'>
                ai***
              </span>
              <BadgeCheck className='text-primary size-3.5' />
            </div>
            <span className='bg-primary/50 absolute top-11 right-10 size-2 rounded-full' />
            <span className='bg-info/50 absolute bottom-14 left-16 size-2 rounded-full' />
          </div>
        </div>
        <dl className='bg-muted/15 grid grid-cols-2 border-t sm:grid-cols-4'>
          {ruleItems.map((item) => (
            <div
              className='flex items-center gap-3 border-r px-5 py-4 last:border-r-0 sm:px-8'
              key={item.label}
            >
              <item.icon
                className='text-muted-foreground hidden size-4 shrink-0 sm:block'
                aria-hidden='true'
              />
              <div>
                <dt className='text-muted-foreground text-[11px]'>
                  {item.label}
                </dt>
                <dd className='mt-1 text-sm font-medium'>{item.value}</dd>
              </div>
            </div>
          ))}
        </dl>
      </section>
      <section
        className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'
        aria-label={t('Referral statistics')}
      >
        <div
          className='console-surface console-metric bg-card rounded-xl border p-5'
          data-console-tone='success'
        >
          <div className='text-muted-foreground flex items-center justify-between text-xs'>
            <span>{t('Available rewards')}</span>
            <IconBadge tone='success'>
              <Wallet />
            </IconBadge>
          </div>
          <StatCardValue
            value={money(data.account.balance)}
            currencySymbol={currencySymbol}
            className='mt-4'
          />
          <Button
            variant='ghost'
            className='text-success mt-3 h-auto p-0 text-xs'
            disabled={
              !props.pendingTransfer &&
              (data.account.balance <= 0 || data.account.debt > 0)
            }
            onClick={props.onTransfer}
          >
            {t('Transfer to wallet')}
            <ArrowUpRight className='size-3.5' />
          </Button>
        </div>
        <div
          className='console-surface console-metric bg-card rounded-xl border p-5'
          data-console-tone='warning'
        >
          <div className='text-muted-foreground flex items-center justify-between text-xs'>
            <span>{t('Pending rewards')}</span>
            <IconBadge tone='warning'>
              <Clock3 />
            </IconBadge>
          </div>
          <StatCardValue
            value={money(data.pending)}
            currencySymbol={currencySymbol}
            className='mt-4'
          />
          <p className='text-muted-foreground mt-3 text-xs'>
            {t('Under review')}: {money(data.review)}
          </p>
        </div>
        <div
          className='console-surface console-metric bg-card rounded-xl border p-5'
          data-console-tone='chart-2'
        >
          <div className='text-muted-foreground flex items-center justify-between text-xs'>
            <span>{t('Total rewards earned')}</span>
            <IconBadge tone='chart-2'>
              <Gift />
            </IconBadge>
          </div>
          <StatCardValue
            value={money(data.account.earned)}
            currencySymbol={currencySymbol}
            className='mt-4'
          />
          <p className='text-muted-foreground mt-3 text-xs'>
            {t('Transferred')}: {money(data.account.transferred)}
          </p>
        </div>
        <div
          className='console-surface console-metric bg-card rounded-xl border p-5'
          data-console-tone='info'
        >
          <div className='text-muted-foreground flex items-center justify-between text-xs'>
            <span>{t('Invited friends')}</span>
            <IconBadge tone='info'>
              <Users />
            </IconBadge>
          </div>
          <div className='mt-4 flex flex-wrap items-baseline gap-2'>
            <StatCardValue value={formatNumber(data.invited, locale)} />
            <span className='text-muted-foreground text-sm font-normal'>
              {t('people')}
            </span>
          </div>
          <p className='text-muted-foreground mt-3 text-xs'>
            {t('Paying invitees')}: {formatNumber(data.paying, locale)}
            <span className='mx-2'>·</span>
            {formatNumber(
              data.invited ? (data.paying / data.invited) * 100 : 0,
              locale
            )}
            %
          </p>
        </div>
      </section>
      <ol
        className='console-surface bg-card grid gap-4 rounded-xl border p-5 sm:grid-cols-2 xl:grid-cols-4'
        data-console-tone='info'
        aria-label={t('How it works')}
      >
        {[
          [
            t('Share your link'),
            t('Friends register through your referral link.'),
          ],
          [
            t('Paid top-up'),
            t('Eligible wallet payments generate pending rewards.'),
          ],
          [
            t('Cool down & review'),
            t('Wait for cooling and qualification checks.'),
          ],
          [
            t('Claim & transfer'),
            t('Claim rewards, then move them to your wallet.'),
          ],
        ].map(([title, description], index) => (
          <li className='flex gap-3' key={title}>
            <span className='text-muted-foreground mt-0.5 font-mono text-[11px]'>
              0{index + 1}
            </span>
            <div>
              <p className='text-xs font-semibold'>{title}</p>
              <p className='text-muted-foreground mt-1 text-[11px] leading-relaxed'>
                {description}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </>
  )
}
