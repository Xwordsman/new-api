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
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { toIntlLocale } from '@/i18n/languages'
import { useAuthStore } from '@/stores/auth-store'

import { registrationQueryKey } from '../api'
import { memberReviewSchema } from '../lib/member-schema'
import type { MemberProfile, MemberReviewState } from '../member-types'
import { getMembers, reviewMember } from '../members-api'

export function MemberDialog(props: { userId: number; onClose: () => void }) {
  const { t } = useTranslation()
  const actor = useAuthStore((s) => s.auth.user?.id)
  const query = useQuery({
    queryKey: [...registrationQueryKey, actor, 'member', props.userId],
    queryFn: ({ signal }) =>
      getMembers(
        { page: 1, search: '', review_state: '', user_id: props.userId },
        signal
      ),
  })
  const member = query.data?.items.find((row) => row.id === props.userId)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t('Member profile')}
      description={`${t('User ID')}: ${props.userId}`}
    >
      {query.isPending && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {query.isSuccess && !member && <p>{t('No records found')}</p>}
      {member && (
        <MemberDetails
          key={member.id}
          member={member}
          onClose={props.onClose}
        />
      )}
    </Dialog>
  )
}

function MemberDetails(props: { member: MemberProfile; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const client = useQueryClient()
  const form = useForm<{
    state: MemberReviewState
    note: string
    version: number
  }>({
    resolver: zodResolver(memberReviewSchema),
    defaultValues: {
      state: props.member.review_state || 'unreviewed',
      note: props.member.note || '',
      version: props.member.version,
    },
  })
  const save = useMutation({
    mutationFn: (values: {
      state: MemberReviewState
      note: string
      version: number
    }) => reviewMember({ ...values, user_id: props.member.id }),
    onSuccess: async () => {
      props.onClose()
      await client.invalidateQueries({ queryKey: registrationQueryKey })
      toast.success(t('Member review saved'))
    },
  })
  const date = (value: number) =>
    value ? new Date(value * 1000).toLocaleString(locale) : t('Not recorded')
  let role = t('User')
  if (props.member.role >= 100) role = t('Root')
  else if (props.member.role >= 10) role = t('Administrator')
  const fields = [
    [t('Username'), props.member.username],
    [t('Display name'), props.member.display_name],
    [t('Email'), props.member.email],
    [t('Status'), props.member.status === 1 ? t('Active') : t('Disabled')],
    [t('Role'), role],
    [t('Registration time'), date(props.member.created_at)],
    [t('Registration source'), props.member.registration_source],
    [t('Registration IP'), props.member.registration_ip],
    [t('Registration browser (User-Agent)'), props.member.registration_agent],
    [t('Last login'), date(props.member.last_login_at)],
    [t('Last login IP'), props.member.last_login_ip],
    [t('Login metadata updated'), date(props.member.last_seen_at)],
    [t('Login method'), props.member.last_login_method],
    [t('Last login browser (User-Agent)'), props.member.last_login_agent],
    [t('Inviter ID'), props.member.inviter_id || '—'],
    [t('Account remark'), props.member.remark],
    [t('Last reviewed'), date(props.member.reviewed_at)],
    [t('Reviewer ID'), props.member.reviewer_id || '—'],
  ]
  return (
    <div className='space-y-5'>
      <dl className='grid gap-3 text-sm sm:grid-cols-2'>
        {fields.map(([label, value]) => (
          <div
            key={String(label)}
            className='bg-muted/40 min-w-0 rounded-lg p-3'
          >
            <dt className='text-muted-foreground'>{label}</dt>
            <dd className='mt-1 break-words whitespace-pre-wrap'>
              {value || t('Not recorded')}
            </dd>
          </div>
        ))}
      </dl>
      <p className='text-muted-foreground text-sm'>
        {t(
          'IP and browser data are self-reported connection clues, not proof of identity. Missing history is not backfilled.'
        )}
      </p>
      <Form {...form}>
        <form
          noValidate
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
          className='space-y-4'
        >
          <fieldset disabled={save.isPending} className='space-y-4'>
            <FormField
              control={form.control}
              name='state'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Member review status')}</FormLabel>
                  <FormControl>
                    <NativeSelect {...field}>
                      <NativeSelectOption value='unreviewed'>
                        {t('Not reviewed')}
                      </NativeSelectOption>
                      <NativeSelectOption value='watch'>
                        {t('Needs attention')}
                      </NativeSelectOption>
                      <NativeSelectOption value='cleared'>
                        {t('Reviewed')}
                      </NativeSelectOption>
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='note'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Member review note')}</FormLabel>
                  <FormControl>
                    <Textarea {...field} maxLength={500} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <p className='text-muted-foreground text-sm'>
              {t(
                'Member review only records your assessment. It does not ban accounts or approve promotional credits.'
              )}
            </p>
            <div className='flex justify-end'>
              <Button type='submit' disabled={save.isPending}>
                {t('Save review')}
              </Button>
            </div>
          </fieldset>
        </form>
      </Form>
    </div>
  )
}
