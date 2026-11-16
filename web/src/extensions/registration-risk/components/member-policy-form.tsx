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

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useAuthStore } from '@/stores/auth-store'

import { registrationQueryKey } from '../api'
import { memberPolicySchema } from '../lib/member-schema'
import type { MemberPolicy } from '../member-types'
import { getMemberPolicy, saveMemberPolicy } from '../members-api'

export function MemberPolicySection() {
  const { t } = useTranslation()
  const actor = useAuthStore((s) => s.auth.user?.id)
  const query = useQuery({
    queryKey: [...registrationQueryKey, actor, 'member-policy'],
    queryFn: ({ signal }) => getMemberPolicy(signal),
    refetchOnWindowFocus: false,
  })
  return (
    <Accordion className='console-surface bg-card rounded-xl border px-5'>
      <AccordionItem value='policy'>
        <AccordionTrigger className='py-4'>
          {t('Member data and analysis settings')}
        </AccordionTrigger>
        <AccordionContent className='pb-5'>
          {query.isPending && <LoadingState />}
          {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
          {query.data && <MemberPolicyForm policy={query.data} />}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

function MemberPolicyForm(props: { policy: MemberPolicy }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const form = useForm<MemberPolicy>({
    resolver: zodResolver(memberPolicySchema, {
      error: () => 'Check this value and the permitted limits',
    }),
    defaultValues: props.policy,
  })
  const save = useMutation({
    mutationFn: saveMemberPolicy,
    onSuccess: async (data) => {
      form.reset(data)
      await client.invalidateQueries({ queryKey: registrationQueryKey })
      toast.success(t('Member analysis settings saved'))
    },
  })
  const fields = [
    ['retention_days', t('IP and browser retention (days)')],
    ['lookback_days', t('Association lookback (days)')],
    ['device_limit', t('Same device account threshold')],
    ['signup_ip_limit', t('Same registration IP threshold')],
    ['login_ip_limit', t('Same last login IP threshold')],
    ['network_limit', t('Same network account threshold')],
    ['inviter_limit', t('Same inviter account threshold')],
    ['payer_limit', t('Same verified payer threshold')],
  ] as const
  return (
    <Form {...form}>
      <form noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))}>
        <fieldset disabled={save.isPending} className='space-y-4'>
          <FormField
            control={form.control}
            name='capture_enabled'
            render={({ field }) => (
              <FormItem className='flex items-center justify-between gap-3'>
                <FormLabel>
                  {t('Record successful signup and login metadata')}
                </FormLabel>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    ref={field.ref}
                    onBlur={field.onBlur}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <p className='text-muted-foreground text-sm'>
            {t(
              'Retention and lookback accept 1–3650 days. Association thresholds accept 0 to disable or 2–100000 accounts. Verified payer associations use lifetime records; other associations use the lookback window. Email-domain checks follow the registration policy.'
            )}
          </p>
          <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
            {fields.map(([name, label]) => (
              <FormField
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{label}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type='number'
                        step={1}
                        min={name.endsWith('days') ? 1 : 0}
                        max={name.endsWith('days') ? 3650 : 100000}
                        value={Number.isNaN(field.value) ? '' : field.value}
                        onChange={(e) => field.onChange(e.target.valueAsNumber)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
          </div>
          <p className='text-muted-foreground text-sm'>
            {t(
              'These settings do not change signup blocking rules. Expired IP and browser details are cleared by maintenance; review notes are retained.'
            )}
          </p>
          <div className='flex flex-wrap items-center justify-end gap-3'>
            <Button
              type='button'
              variant='outline'
              onClick={() => form.reset(props.policy)}
            >
              {t('Reload saved settings')}
            </Button>
            <Button
              type='submit'
              disabled={save.isPending || !form.formState.isDirty}
            >
              {t('Save analysis settings')}
            </Button>
          </div>
        </fieldset>
      </form>
    </Form>
  )
}
