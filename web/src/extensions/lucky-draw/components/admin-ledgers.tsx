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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { z } from 'zod'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'

import { DRAW_QUERY_KEY, getDrawData, reviewDrawAccount } from '../api'
import { reviewSchema } from '../lib/schema'
import type { DrawAccount, DrawAudit, DrawRecord, DrawSettings } from '../types'
import { DrawTable } from './draw-table'

export function DrawAdminLedgers() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [filter, setFilter] = useState('')
  const [userId, setUserId] = useState<number>()
  const [recordId, setRecordId] = useState<number>()
  const [audit, setAudit] = useState<DrawAudit>()
  const [review, setReview] = useState(false)
  const client = useQueryClient()
  const snapshot = useQuery({
    queryKey: [...DRAW_QUERY_KEY, 'snapshot', recordId],
    queryFn: () =>
      getDrawData<{ record: DrawRecord; settings: DrawSettings }>(
        `records/${recordId}`
      ),
    enabled: !!recordId,
  })
  const form = useForm<z.infer<typeof reviewSchema>>({
    resolver: zodResolver(reviewSchema),
    defaultValues: { user_id: 0, state: 'paused', reason: '' },
  })
  const update = useMutation({
    mutationFn: reviewDrawAccount,
    onSuccess: () => {
      setReview(false)
      form.reset()
      void client.invalidateQueries({ queryKey: DRAW_QUERY_KEY })
      toast.success(t('Account updated'))
    },
  })
  const date = (v: number) =>
    v ? new Date(v * 1000).toLocaleString(locale) : '—'
  const money = (v: number) =>
    formatQuotaWithCurrency(v, { locale, abbreviate: false })
  return (
    <div className='space-y-5'>
      <Card data-card-hover='false'>
        <CardContent className='flex flex-wrap items-end gap-3'>
          <div className='space-y-2'>
            <label htmlFor='draw-user-filter' className='text-sm font-medium'>
              {t('User ID')}
            </label>
            <Input
              id='draw-user-filter'
              type='number'
              min='1'
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <Button
            variant='outline'
            disabled={
              filter !== '' &&
              (!Number.isSafeInteger(Number(filter)) || Number(filter) < 1)
            }
            onClick={() => setUserId(filter ? Number(filter) : undefined)}
          >
            {t('Filter')}
          </Button>
          <Button
            variant='outline'
            onClick={() => {
              setFilter('')
              setUserId(undefined)
            }}
          >
            {t('Clear')}
          </Button>
          <Button
            onClick={() => {
              form.reset({ user_id: userId ?? 0, state: 'paused', reason: '' })
              setReview(true)
            }}
          >
            {t('Review draw access')}
          </Button>
        </CardContent>
      </Card>
      <Card data-card-hover='false'>
        <CardHeader>
          <CardTitle>{t('Draw records')}</CardTitle>
        </CardHeader>
        <CardContent>
          <DrawTable<DrawRecord>
            key={`records-${userId}`}
            resource='records'
            userId={userId}
            getRowKey={(r) => r.id}
            columns={[
              {
                id: 'id',
                header: t('Draw ID'),
                cell: (r) => (
                  <Button variant='link' onClick={() => setRecordId(r.id)}>
                    #{r.id}
                  </Button>
                ),
              },
              { id: 'user', header: t('User ID'), cell: (r) => r.user_id },
              { id: 'prize', header: t('Prize'), cell: (r) => t(r.prize_name) },
              {
                id: 'amount',
                header: t('Reward'),
                cell: (r) => money(r.quota_awarded),
              },
              {
                id: 'time',
                header: t('Time'),
                cell: (r) => date(r.created_at),
              },
            ]}
          />
        </CardContent>
      </Card>
      <Card data-card-hover='false'>
        <CardHeader>
          <CardTitle>{t('Draw accounts')}</CardTitle>
        </CardHeader>
        <CardContent>
          <DrawTable<DrawAccount>
            key={`accounts-${userId}`}
            resource='accounts'
            userId={userId}
            getRowKey={(r) => r.user_id}
            columns={[
              { id: 'user', header: t('User ID'), cell: (r) => r.user_id },
              {
                id: 'state',
                header: t('Status'),
                cell: (r) => t(r.state === 'active' ? 'Active' : 'Paused'),
              },
              {
                id: 'draws',
                header: t('Total draws'),
                cell: (r) => formatNumber(r.total_draws, locale),
              },
              {
                id: 'reward',
                header: t('Total earned'),
                cell: (r) => money(r.total_quota),
              },
              {
                id: 'reason',
                header: t('Reason'),
                cell: (r) => r.reason || '—',
              },
              {
                id: 'actions',
                header: t('Actions'),
                cell: (r) => (
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => {
                      form.reset({
                        user_id: r.user_id,
                        state: r.state === 'active' ? 'paused' : 'active',
                        reason: '',
                      })
                      setReview(true)
                    }}
                  >
                    {t('Review')}
                  </Button>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>
      <Card data-card-hover='false'>
        <CardHeader>
          <CardTitle>{t('Audit trail')}</CardTitle>
        </CardHeader>
        <CardContent>
          <DrawTable<DrawAudit>
            key={`audit-${userId}`}
            resource='audit'
            userId={userId}
            getRowKey={(r) => r.id}
            columns={[
              {
                id: 'time',
                header: t('Time'),
                cell: (r) => date(r.created_at),
              },
              { id: 'actor', header: t('Operator'), cell: (r) => r.actor_id },
              {
                id: 'user',
                header: t('User ID'),
                cell: (r) => r.user_id || '—',
              },
              {
                id: 'action',
                header: t('Action'),
                cell: (r) =>
                  t(
                    (
                      {
                        settings: 'Settings',
                        account_paused: 'Pause account',
                        account_active: 'Resume account',
                      } as Record<string, string>
                    )[r.action] ?? r.action
                  ),
              },
              {
                id: 'detail',
                header: t('Details'),
                cell: (r) => (
                  <Button variant='link' onClick={() => setAudit(r)}>
                    {t('View')}
                  </Button>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>
      <Dialog
        open={!!recordId}
        onOpenChange={(open) => {
          if (!open) setRecordId(undefined)
        }}
        title={t('Draw snapshot')}
        description={t(
          'The exact rules and prize probabilities saved when this draw was accepted.'
        )}
        contentClassName='sm:max-w-3xl'
      >
        {snapshot.isError ? (
          <ErrorState onRetry={() => void snapshot.refetch()} />
        ) : (
          <pre className='bg-muted max-h-[60vh] overflow-auto rounded-md p-4 text-xs break-all whitespace-pre-wrap'>
            {snapshot.data
              ? JSON.stringify(snapshot.data, null, 2)
              : t('Loading...')}
          </pre>
        )}
      </Dialog>
      <Dialog
        open={!!audit}
        onOpenChange={(open) => {
          if (!open) setAudit(undefined)
        }}
        title={t('Audit details')}
      >
        <pre className='max-h-[60vh] overflow-auto text-xs break-all whitespace-pre-wrap'>
          {audit?.detail}
        </pre>
      </Dialog>
      <Dialog
        open={review}
        onOpenChange={(open) => {
          if (!update.isPending) setReview(open)
        }}
        title={t('Review draw access')}
        description={t(
          'Pause or restore access without changing wallet rewards or resetting limits. A reason is required.'
        )}
      >
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((input) => update.mutate(input))}
            className='space-y-4'
          >
            <FormField
              control={form.control}
              name='user_id'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('User ID')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type='number'
                      min={1}
                      onChange={(e) => field.onChange(e.target.valueAsNumber)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='state'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Status')}</FormLabel>
                  <FormControl>
                    <NativeSelect {...field}>
                      <NativeSelectOption value='paused'>
                        {t('Paused')}
                      </NativeSelectOption>
                      <NativeSelectOption value='active'>
                        {t('Active')}
                      </NativeSelectOption>
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='reason'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Reason')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type='submit' disabled={update.isPending}>
              {t('Confirm')}
            </Button>
          </form>
        </Form>
      </Dialog>
    </div>
  )
}
