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

import { CHECKIN_QUERY_KEY, updateCheckinAccount } from '../api'
import { checkinReviewSchema } from '../lib/schema'

export function CheckinAccountAction(props: {
  userId: number
  state: 'active' | 'paused'
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(checkinReviewSchema),
    defaultValues: { reason: '' },
  })
  const mutation = useMutation({
    mutationFn: (values: { reason: string }) =>
      updateCheckinAccount(props.userId, { ...values, state: props.state }),
    onSuccess: async () => {
      props.onClose()
      await queryClient.invalidateQueries({ queryKey: CHECKIN_QUERY_KEY })
      toast.success(t('Check-in account updated'))
    },
  })

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) props.onClose()
      }}
      title={
        props.state === 'paused'
          ? t('Pause check-in rewards')
          : t('Resume check-in rewards')
      }
      desc={t(
        'This changes check-in access for user {{id}}. Recharging and previously credited wallet rewards are unaffected. Resuming still requires all qualification rules.',
        { id: props.userId }
      )}
      destructive={props.state === 'paused'}
      confirmText={t('Confirm')}
      isLoading={mutation.isPending}
      handleConfirm={form.handleSubmit((values) => mutation.mutate(values))}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
          <FormField
            control={form.control}
            name='reason'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Review reason')}</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    maxLength={1000}
                    disabled={mutation.isPending}
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
