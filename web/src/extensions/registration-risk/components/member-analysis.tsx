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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTablePagination,
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { ReviewDialog } from '@/extensions/referral/components/admin-actions'
import { ReferralState } from '@/extensions/referral/components/referral-state'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { registrationQueryKey } from '../api'
import type { MemberGroup, MemberGroupBinding } from '../member-types'
import { getMemberAnalysis, startMemberAnalysis } from '../members-api'
import { MemberDialog } from './member-dialog'
import { MemberPolicySection } from './member-policy-form'

export function MemberAnalysis() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const actor = useAuthStore((s) => s.auth.user?.id)
  const client = useQueryClient()
  const [filter, setFilter] = useState({ page: 1, kind: 'review' })
  const [selected, setSelected] = useState<number | null>(null)
  const [review, setReview] = useState<{
    invitee: MemberGroupBinding
    approve: boolean
  } | null>(null)
  const query = useQuery({
    queryKey: [...registrationQueryKey, actor, 'member-analysis', filter],
    queryFn: ({ signal }) => getMemberAnalysis(filter, signal),
    refetchInterval: (q) =>
      ['pending', 'running'].includes(q.state.data?.status ?? '')
        ? 2000
        : false,
  })
  const start = useMutation({
    mutationFn: startMemberAnalysis,
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: [...registrationQueryKey, actor, 'member-analysis'],
      })
    },
  })
  const running =
    start.isPending || ['pending', 'running'].includes(query.data?.status ?? '')
  const table = useReactTable({
    data: query.data?.groups ?? [],
    columns: [],
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    rowCount: query.data?.total ?? 0,
    state: { pagination: { pageIndex: filter.page - 1, pageSize: 20 } },
    onPaginationChange: (update) => {
      const next =
        typeof update === 'function'
          ? update({ pageIndex: filter.page - 1, pageSize: 20 })
          : update
      setFilter((f) => ({ ...f, page: next.pageIndex + 1 }))
    },
  })
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
  const columns: StaticDataTableColumn<MemberGroup>[] = [
    {
      id: 'members',
      header: t('Associated accounts'),
      cellClassName: 'align-top',
      cell: (group) => (
        <div className='min-w-48 space-y-3 whitespace-normal'>
          {group.members.map((member) => (
            <div key={member.id}>
              <Button
                variant='link'
                size='sm'
                className='h-auto max-w-72 justify-start p-0 text-left break-words whitespace-normal'
                onClick={() => setSelected(member.id)}
              >
                #{member.id} {member.username}
              </Button>
              {member.display_name && (
                <p className='text-sm break-words'>{member.display_name}</p>
              )}
              {member.email && (
                <p className='text-muted-foreground max-w-72 text-xs break-all'>
                  {member.email}
                </p>
              )}
              {member.status !== 1 && (
                <Badge variant='secondary'>{t('Disabled')}</Badge>
              )}
              {member.note && (
                <p className='text-muted-foreground max-w-72 text-xs break-words'>
                  {member.note}
                </p>
              )}
            </div>
          ))}
        </div>
      ),
    },
    {
      id: 'evidence',
      header: t('Association signals'),
      cellClassName: 'align-top',
      cell: (group) => {
        const evidence = new Map<
          string,
          { ids: number[]; signup: string; login: string; agent: string }
        >()
        for (const member of group.members) {
          const signup = member.registration_ip || t('Not recorded')
          const login = member.last_login_ip || t('Not recorded')
          const agent =
            member.registration_agent ||
            member.last_login_agent ||
            t('Not recorded')
          const key = JSON.stringify([signup, login, agent])
          const existing = evidence.get(key)
          if (existing) {
            existing.ids.push(member.id)
          } else {
            evidence.set(key, { ids: [member.id], signup, login, agent })
          }
        }
        return (
          <div className='max-w-96 min-w-56 space-y-3 whitespace-normal'>
            <div className='flex flex-wrap gap-1'>
              {group.signals.map((code) => (
                <Badge
                  key={code}
                  variant={
                    ['device', 'payer', 'invite-burst'].includes(code)
                      ? 'warning'
                      : 'secondary'
                  }
                >
                  {signals[code] ?? code}
                </Badge>
              ))}
              {group.signals.length === 0 && (
                <span className='text-muted-foreground text-xs'>
                  {t('No signals in available data')}
                </span>
              )}
            </div>
            {group.priority === 1 && (
              <p className='text-muted-foreground text-xs'>
                {t('Network clue only')}
              </p>
            )}
            {[...evidence.entries()].map(([key, item]) => (
              <div key={key} className='space-y-1 text-xs'>
                <p className='font-medium'>
                  {item.ids.map((id) => `#${id}`).join(', ')}
                </p>
                <p>
                  {t('Registration IP')}: {item.signup}
                </p>
                <p>
                  {t('Last login IP')}: {item.login}
                </p>
                <p className='text-muted-foreground break-all'>
                  UA: {item.agent}
                </p>
              </div>
            ))}
          </div>
        )
      },
    },
    {
      id: 'rewards',
      header: t('Invitation rewards and review'),
      cellClassName: 'align-top',
      cell: (group) => (
        <div className='min-w-64 space-y-4 whitespace-normal'>
          {group.bindings.some((binding) => binding.state === 'review') && (
            <p className='text-warning text-xs font-medium'>
              {t('Held until administrator approval')}
            </p>
          )}
          {[
            ...new Set(
              group.bindings.map((binding) => binding.reason).filter(Boolean)
            ),
          ].map((reason) => (
            <p key={reason} className='text-muted-foreground max-w-96 text-xs'>
              {t(reason)}
            </p>
          ))}
          {group.bindings.length === 0 && (
            <span className='text-muted-foreground text-sm'>
              {t('No reward')}
            </span>
          )}
          {group.bindings.map((binding) => (
            <div
              key={binding.id}
              className='space-y-2 border-b pb-3 last:border-0 last:pb-0'
            >
              <p className='max-w-96 text-xs break-words'>
                #{binding.inviter_id} {binding.inviter_name} → #
                {binding.user_id} {binding.username}
              </p>
              <div className='flex flex-wrap items-center gap-2 text-xs'>
                <span title={binding.reason ? t(binding.reason) : undefined}>
                  <ReferralState state={binding.state} />
                </span>
                <span>
                  {t('Signup bonus')}:{' '}
                  {formatQuotaWithCurrency(binding.signup_bonus_quota, {
                    locale,
                    abbreviate: false,
                  })}{' '}
                  ·{' '}
                  {binding.signup_bonus_paid_at > 0 ? t('Paid') : t('Pending')}
                </span>
              </div>
              {binding.pending > 0 && (
                <p className='text-xs'>
                  {t('Pending payment rewards')}:{' '}
                  {formatQuotaWithCurrency(binding.pending, {
                    locale,
                    abbreviate: false,
                  })}
                </p>
              )}
              {['review', 'historical'].includes(binding.state) && (
                <div className='flex flex-wrap gap-2'>
                  <Button
                    size='sm'
                    variant='outline'
                    aria-label={t('Approve referral qualification')}
                    onClick={() =>
                      setReview({ invitee: binding, approve: true })
                    }
                  >
                    {t('Approve')}
                  </Button>
                  <Button
                    size='sm'
                    variant='destructive'
                    aria-label={t('Reject referral qualification')}
                    onClick={() =>
                      setReview({ invitee: binding, approve: false })
                    }
                  >
                    {t('Reject')}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      ),
    },
  ]
  const summary = query.data?.summary
  return (
    <div className='space-y-4'>
      <div className='console-surface bg-card space-y-4 rounded-xl border p-5'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <h2 className='font-semibold'>{t('Existing-member analysis')}</h2>
          <Button
            disabled={running || query.isPending || query.isError}
            onClick={() => start.mutate()}
          >
            {running ? t('Analysis in progress') : t('Analyze all members')}
          </Button>
        </div>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Associated accounts are grouped for review. Suspicious invitation rewards stay held until administrator approval. Shared IP or UA alone does not prove the same person.'
          )}
        </p>
        {running && (
          <p role='status'>
            {t(
              'Analysis in progress. Previous completed results remain visible.'
            )}
          </p>
        )}
        {query.data?.status === 'failed' && (
          <Alert variant='destructive'>
            <AlertDescription>
              {t('Member analysis failed. Previous results are retained.')}
            </AlertDescription>
          </Alert>
        )}
        {query.isPending && <LoadingState />}
        {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
        {summary && (
          <>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <p className='text-muted-foreground text-xs'>
                {t('Members analyzed')}: {formatNumber(summary.total, locale)} ·{' '}
                {t('Last analysis')}:{' '}
                {new Date(summary.completed_at * 1000).toLocaleString(locale)}
              </p>
              <NativeSelect
                aria-label={t('Analysis results')}
                value={filter.kind}
                onChange={(e) => setFilter({ page: 1, kind: e.target.value })}
              >
                <NativeSelectOption value='review'>
                  {t('Evidence requires review')}
                </NativeSelectOption>
                <NativeSelectOption value='flagged'>
                  {t('Members with signals')}
                </NativeSelectOption>
                <NativeSelectOption value='insufficient'>
                  {t('Insufficient historical data')}
                </NativeSelectOption>
                <NativeSelectOption value='all'>
                  {t('All members')}
                </NativeSelectOption>
              </NativeSelect>
            </div>
            <StaticDataTable
              data={query.data?.groups ?? []}
              columns={columns}
              getRowKey={(group) => group.id}
              emptyContent={t('No records found')}
            />
            <DataTablePagination table={table} compact />
          </>
        )}
        {query.data && !summary && !running && (
          <p>
            {t(
              'No completed analysis yet. Save your settings, then analyze all members.'
            )}
          </p>
        )}
      </div>
      <MemberPolicySection />
      {selected !== null && (
        <MemberDialog userId={selected} onClose={() => setSelected(null)} />
      )}
      {review && (
        <ReviewDialog
          value={review}
          onClose={() => setReview(null)}
          onReviewed={async () => {
            await client.invalidateQueries({
              queryKey: [...registrationQueryKey, actor, 'member-analysis'],
            })
          }}
        />
      )}
    </div>
  )
}
