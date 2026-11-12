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
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'

import { registrationQueryKey, reviewCredit } from '../api'
import { reviewSchema } from '../lib/schema'

export function CreditReviewDialog(props: {
  userId: number
  approve: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(reviewSchema),
    defaultValues: { reason: '' },
  })
  const review = useMutation({
    mutationFn: (values: { reason: string }) =>
      reviewCredit({
        user_id: props.userId,
        approve: props.approve,
        reason: values.reason,
      }),
    onSuccess: async () => {
      props.onClose()
      await client.invalidateQueries({ queryKey: registrationQueryKey })
      toast.success(t('Promotional credit review saved'))
    },
  })
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open && !review.isPending) props.onClose()
      }}
      title={
        props.approve
          ? t('Approve promotional credits')
          : t('Reject promotional credits')
      }
      desc={t(
        'Review promotional qualification for user {{id}}. Paid balance and account access are unaffected. Referral holds require separate approval.',
        { id: props.userId }
      )}
      confirmText={t('Confirm')}
      destructive={!props.approve}
      isLoading={review.isPending}
      handleConfirm={form.handleSubmit((values) => review.mutate(values))}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit((values) => review.mutate(values))}>
          <FormField
            control={form.control}
            name='reason'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Review reason')}</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    maxLength={500}
                    disabled={review.isPending}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </ConfirmDialog>
  )
}
