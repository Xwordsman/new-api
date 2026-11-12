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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Send, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { FieldGroup } from '@/components/ui/field'
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
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { useAuthStore } from '@/stores/auth-store'

import { createTicket } from '../api'
import { ticketCategories } from '../constants'
import { ticketQueryKey } from '../hooks'
import { ticketSchema } from '../lib/schema'
import type { TicketDraft } from '../types'
import { AttachmentPicker } from './attachment-picker'

export function TicketCompose(props: {
  onBack: () => void
  onCreated: (id: number) => void
}) {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const client = useQueryClient()
  const [images, setImages] = useState<File[]>([])
  const form = useForm<TicketDraft>({
    resolver: zodResolver(ticketSchema),
    defaultValues: { subject: '', category: 'other', body: '' },
  })
  const submit = useMutation({
    mutationFn: (values: TicketDraft) => createTicket(values, images),
    onSuccess: (ticket) => {
      void client.invalidateQueries({ queryKey: ticketQueryKey })
      props.onCreated(ticket.id)
    },
  })

  return (
    <section
      aria-label={t('New ticket')}
      className='h-full overflow-y-auto overscroll-contain p-5 sm:p-6'
    >
      <Button
        variant='ghost'
        size='sm'
        className='text-muted-foreground -ms-2 mb-5'
        onClick={props.onBack}
      >
        <ArrowLeft className='size-3.5' />
        {t('Back to tickets')}
      </Button>
      <h2 className='mb-6 text-lg font-semibold tracking-tight'>
        {t('Tell us what happened. We’ll solve it together.')}
      </h2>
      <Form {...form}>
        <form onSubmit={form.handleSubmit((values) => submit.mutate(values))}>
          <FieldGroup className='gap-5'>
            <FormField
              control={form.control}
              name='subject'
              render={({ field }) => (
                <FormItem>
                  <FormLabel className='text-xs'>
                    {t('Ticket subject')}
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={160}
                      placeholder={t('Describe your issue in one sentence')}
                      disabled={submit.isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='category'
              render={({ field }) => (
                <FormItem>
                  <FormLabel className='text-xs'>
                    {t('Issue category')}
                  </FormLabel>
                  <FormControl>
                    <NativeSelect
                      {...field}
                      className='w-full'
                      disabled={submit.isPending}
                    >
                      {Object.entries(ticketCategories).map(
                        ([value, labelKey]) => (
                          <NativeSelectOption key={value} value={value}>
                            {t(labelKey)}
                          </NativeSelectOption>
                        )
                      )}
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='body'
              render={({ field }) => (
                <FormItem>
                  <FormLabel className='text-xs'>
                    {t('Issue details')}
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      className='min-h-44 resize-y text-sm'
                      maxLength={10000}
                      placeholder={t(
                        'Include the time, model, request ID, expected result and actual error. Redact sensitive information before submitting.'
                      )}
                      disabled={submit.isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <p className='text-muted-foreground -mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed'>
              <ShieldCheck className='mt-0.5 size-3 shrink-0' />
              {t(
                'Do not upload passwords, API keys, bank card information or private keys.'
              )}
            </p>
            <AttachmentPicker
              files={images}
              onChange={setImages}
              disabled={submit.isPending}
            />
          </FieldGroup>
          {submit.isError && (
            <p role='alert' className='text-destructive mt-3 text-xs'>
              {t(
                'Submission failed. Your draft is still here; please try again.'
              )}
            </p>
          )}
          <div className='mt-5 flex flex-wrap items-center justify-between gap-3'>
            <p className='text-muted-foreground text-[11px]'>
              {t('Replies appear under Tickets in the notification center.')}
            </p>
            <Button type='submit' disabled={submit.isPending}>
              {submit.isPending ? (
                <Loader2 className='size-3.5 animate-spin' />
              ) : (
                <Send className='size-3.5' />
              )}
              {t('Submit ticket')}
            </Button>
          </div>
        </form>
      </Form>
      <Separator className='my-6' />
      <aside className='text-muted-foreground space-y-3 text-xs leading-relaxed'>
        <h3 className='text-foreground font-medium'>
          {t('Help us resolve your issue faster')}
        </h3>
        <p>
          {t(
            'Include a request ID and error screenshot where possible. Refund requests are reviewed manually; submitting a ticket does not change your balance.'
          )}
        </p>
        <div className='bg-muted/40 flex flex-wrap justify-between gap-2 rounded-lg border px-3 py-2.5'>
          <span>{t('Account email')}</span>
          <span className='text-foreground break-all'>
            {user?.email || t('Not bound')}
          </span>
        </div>
        <p>
          {t(
            'Used to identify your account. We follow up through in-app notifications; ticket email delivery is not enabled.'
          )}
        </p>
      </aside>
    </section>
  )
}
