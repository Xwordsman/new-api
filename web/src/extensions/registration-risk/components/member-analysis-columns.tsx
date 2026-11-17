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
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { TruncatedCell } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ReferralState } from '@/extensions/referral/components/referral-state'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'

import type { MemberAnalysisAccount, MemberGroupBinding } from '../member-types'

export function useMemberAnalysisColumns(props: {
  onSelect: (id: number) => void
  onReview: (value: { invitee: MemberGroupBinding; approve: boolean }) => void
}): ColumnDef<MemberAnalysisAccount>[] {
  const { t, i18n } = useTranslation()
  const { onSelect, onReview } = props
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return useMemo(() => {
    const signals: Record<string, string> = {
      device: t('Shared browser marker'),
      'signup-ip': t('Same registration IP'),
      'login-ip': t('Same last login IP'),
      network: t('Same network'),
      inviter: t('Same inviter'),
      payer: t('Shared verified payment account'),
      domain: t('Restricted email domain'),
      'invite-burst': t('Concentrated invitation registrations'),
    }
    return [
      {
        id: 'id',
        accessorFn: (row) => row.member.id,
        header: 'ID',
        size: 72,
        minSize: 64,
        enableHiding: false,
        cell: ({ row }) => (
          <span className='font-mono tabular-nums'>
            {row.original.member.id}
          </span>
        ),
      },
      {
        id: 'account',
        accessorFn: (row) => row.member.username,
        header: t('Username'),
        size: 220,
        minSize: 160,
        enableHiding: false,
        cell: ({ row }) => {
          const member = row.original.member
          return (
            <div className='w-48 min-w-0 space-y-1'>
              <Button
                variant='link'
                size='sm'
                className='block h-auto w-full truncate p-0 text-left'
                onClick={() => onSelect(member.id)}
              >
                #{member.id} {member.username}
              </Button>
              <TruncatedCell
                tabIndex={0}
                className='text-muted-foreground text-xs'
              >
                {member.display_name || member.email || '—'}
              </TruncatedCell>
            </div>
          )
        },
      },
      {
        id: 'status',
        accessorFn: (row) => row.member.status,
        header: t('Status'),
        size: 100,
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.member.status === 1 ? 'secondary' : 'destructive'
            }
          >
            {row.original.member.status === 1 ? t('Enabled') : t('Disabled')}
          </Badge>
        ),
      },
      {
        id: 'related',
        accessorFn: (row) => row.related_accounts,
        header: t('Associated accounts'),
        size: 180,
        minSize: 140,
        cell: ({ row }) => {
          const related = row.original.related_accounts
          if (related.length === 0) {
            return <span className='text-muted-foreground'>—</span>
          }
          return (
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    variant='link'
                    size='sm'
                    className='h-auto max-w-40 p-0 text-left'
                  />
                }
              >
                <span className='truncate'>
                  {related
                    .slice(0, 3)
                    .map((peer) => `#${peer.id}`)
                    .join(', ')}
                  {related.length > 3 ? ` +${related.length - 3}` : ''}
                </span>
              </PopoverTrigger>
              <PopoverContent className='w-80' align='start'>
                <PopoverTitle>{t('Associated accounts')}</PopoverTitle>
                <div className='max-h-64 space-y-1 overflow-y-auto'>
                  {related.map((peer) => (
                    <Button
                      key={peer.id}
                      variant='link'
                      size='sm'
                      className='block h-8 w-full truncate text-left'
                      onClick={() => onSelect(peer.id)}
                    >
                      #{peer.id} {peer.username}
                    </Button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )
        },
      },
      {
        id: 'registration_ip',
        accessorFn: (row) => row.member.registration_ip,
        header: t('Registration IP'),
        size: 180,
        cell: ({ row }) => (
          <TruncatedCell tabIndex={0} className='w-40 font-mono text-xs'>
            {row.original.member.registration_ip || t('Not recorded')}
          </TruncatedCell>
        ),
      },
      {
        id: 'login_ip',
        accessorFn: (row) => row.member.last_login_ip,
        header: t('Last login IP'),
        size: 180,
        cell: ({ row }) => (
          <TruncatedCell tabIndex={0} className='w-40 font-mono text-xs'>
            {row.original.member.last_login_ip || t('Not recorded')}
          </TruncatedCell>
        ),
      },
      {
        id: 'agent',
        accessorFn: (row) => row.member.registration_agent,
        header: t('Browser / UA'),
        size: 260,
        minSize: 180,
        cell: ({ row }) => (
          <div className='w-60 space-y-1 text-xs'>
            <TruncatedCell
              tabIndex={0}
              tooltipContent={`${t('Registration UA')}: ${row.original.member.registration_agent || t('Not recorded')}`}
            >
              {row.original.member.registration_agent || t('Not recorded')}
            </TruncatedCell>
            <TruncatedCell
              tabIndex={0}
              className='text-muted-foreground'
              tooltipContent={`${t('Last login UA')}: ${row.original.member.last_login_agent || t('Not recorded')}`}
            >
              {row.original.member.last_login_agent || t('Not recorded')}
            </TruncatedCell>
          </div>
        ),
      },
      {
        id: 'signals',
        accessorFn: (row) => row.signals,
        header: t('Risk signals'),
        size: 240,
        cell: ({ row }) => (
          <div className='w-52 space-y-1 text-xs'>
            <TruncatedCell tabIndex={0}>
              {row.original.signals
                .map((code) => signals[code] ?? code)
                .join(' · ') || t('No signals in available data')}
            </TruncatedCell>
            {row.original.priority === 1 && (
              <span className='text-muted-foreground'>
                {t('Network clue only')}
              </span>
            )}
          </div>
        ),
      },
      {
        id: 'inviter',
        accessorFn: (row) => row.binding?.inviter_id,
        header: t('Inviter'),
        size: 190,
        cell: ({ row }) => {
          const binding = row.original.binding
          if (!binding) return <span className='text-muted-foreground'>—</span>
          return (
            <Button
              variant='link'
              size='sm'
              className='block h-auto w-40 truncate p-0 text-left'
              onClick={() => onSelect(binding.inviter_id)}
            >
              #{binding.inviter_id} {binding.inviter_name}
            </Button>
          )
        },
      },
      {
        id: 'signup_bonus',
        accessorFn: (row) => row.binding?.signup_bonus_quota,
        header: t('Signup bonus'),
        size: 140,
        cell: ({ row }) => {
          const binding = row.original.binding
          if (!binding) return <span className='text-muted-foreground'>—</span>
          return (
            <div className='space-y-1 text-xs tabular-nums'>
              <p>
                {formatQuotaWithCurrency(binding.signup_bonus_quota, {
                  locale,
                  abbreviate: false,
                })}
              </p>
              <p className='text-muted-foreground'>
                {binding.signup_bonus_paid_at > 0 ? t('Paid') : t('Pending')}
              </p>
            </div>
          )
        },
      },
      {
        id: 'pending',
        accessorFn: (row) => row.binding?.pending,
        header: t('Pending payment rewards'),
        size: 180,
        cell: ({ row }) =>
          row.original.binding ? (
            <span className='text-xs tabular-nums'>
              {formatQuotaWithCurrency(row.original.binding.pending, {
                locale,
                abbreviate: false,
              })}
            </span>
          ) : (
            <span className='text-muted-foreground'>—</span>
          ),
      },
      {
        id: 'referral_status',
        accessorFn: (row) => row.binding?.state,
        header: t('Referral status'),
        size: 260,
        cell: ({ row }) => {
          const binding = row.original.binding
          if (!binding) {
            return (
              <span className='text-muted-foreground text-xs'>
                {t('No reward')}
              </span>
            )
          }
          return (
            <div className='w-60 space-y-1 text-xs'>
              <ReferralState state={binding.state} />
              <TruncatedCell
                tabIndex={0}
                className={
                  binding.state === 'review'
                    ? 'text-warning'
                    : 'text-muted-foreground'
                }
              >
                {binding.state === 'review'
                  ? t('Held until administrator approval')
                  : '—'}
              </TruncatedCell>
            </div>
          )
        },
      },
      {
        id: 'reason',
        accessorFn: (row) => row.binding?.reason,
        header: t('Review reason'),
        size: 240,
        cell: ({ row }) => (
          <TruncatedCell tabIndex={0} className='w-52 text-xs'>
            {row.original.binding?.reason
              ? t(row.original.binding.reason)
              : '—'}
          </TruncatedCell>
        ),
      },
      {
        id: 'actions',
        header: t('Actions'),
        size: 230,
        minSize: 230,
        enableHiding: false,
        cell: ({ row }) => {
          const binding = row.original.binding
          return (
            <div className='flex items-center gap-2 whitespace-nowrap'>
              <Button
                size='sm'
                variant='ghost'
                onClick={() => onSelect(row.original.member.id)}
              >
                {t('Details and review')}
              </Button>
              {binding && ['review', 'historical'].includes(binding.state) && (
                <>
                  <Button
                    size='sm'
                    variant='outline'
                    aria-label={t('Approve referral qualification')}
                    onClick={() =>
                      onReview({ invitee: binding, approve: true })
                    }
                  >
                    {t('Approve')}
                  </Button>
                  <Button
                    size='sm'
                    variant='destructive'
                    aria-label={t('Reject referral qualification')}
                    onClick={() =>
                      onReview({ invitee: binding, approve: false })
                    }
                  >
                    {t('Reject')}
                  </Button>
                </>
              )}
            </div>
          )
        },
      },
    ]
  }, [t, locale, onSelect, onReview])
}
