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
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

import { reconcileOrder, refundOrder, reviewInvitee } from '../api'
import {
  referralActionSchema,
  referralReviewSchema,
  type ReferralActionValues,
} from '../lib/schema'
import type { Invitee } from '../types'

export function OrderActionDialog(props: {
  mode: 'reconcile' | 'refund'
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<ReferralActionValues>({
    resolver: zodResolver(referralActionSchema),
    defaultValues: {
      trade_no: '',
      amount: '',
      currency: 'USD',
      usd_per_unit: '',
      reason: '',
    },
  })
  const mutation = useMutation({
    mutationFn: (values: ReferralActionValues) =>
      props.mode === 'reconcile' ? reconcileOrder(values) : refundOrder(values),
    onSuccess: async () => {
      props.onOpenChange(false)
      form.reset()
      await queryClient.invalidateQueries({ queryKey: ['referral-extension'] })
      toast.success(t('Referral operation completed'))
    },
  })
  const fields = [
    { name: 'trade_no', label: t('Payment order'), inputMode: 'text' },
    {
      name: 'amount',
      label:
        props.mode === 'refund'
          ? t('Cumulative refunded amount')
          : t('Actual paid amount'),
      inputMode: 'decimal',
    },
    { name: 'currency', label: t('Payment currency'), inputMode: 'text' },
    {
      name: 'usd_per_unit',
      label: t('USD per currency unit (optional)'),
      inputMode: 'decimal',
    },
  ] as const
  return (
    <ConfirmDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={
        props.mode === 'reconcile'
          ? t('Reconcile referral order')
          : t('Reverse referral reward')
      }
      desc={
        props.mode === 'reconcile'
          ? t(
              'Verify the successful payment first. This creates referral rewards only; it does not credit the wallet again. Historical invitations need approval before reconciliation.'
            )
          : t(
              'Enter the total refunded amount for this order, not an incremental refund. Rewards already transferred become debt against future referral income.'
            )
      }
      destructive={props.mode === 'refund'}
      confirmText={t('Confirm')}
      isLoading={mutation.isPending}
      handleConfirm={form.handleSubmit((values) => mutation.mutate(values))}
    >
      <Form {...form}>
        <form
          className='space-y-3'
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          {fields
            .filter(
              (field) =>
                props.mode === 'reconcile' ||
                field.name === 'trade_no' ||
                field.name === 'amount'
            )
            .map((item) => (
              <FormField
                control={form.control}
                name={item.name}
                key={item.name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{item.label}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        inputMode={item.inputMode}
                        disabled={mutation.isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
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

export function ReviewDialog(props: {
  value: { invitee: Invitee; approve: boolean }
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(referralReviewSchema),
    defaultValues: { reason: '' },
  })
  const mutation = useMutation({
    mutationFn: (values: { reason: string }) =>
      reviewInvitee({
        id: props.value.invitee.id,
        approve: props.value.approve,
        reason: values.reason,
      }),
    onSuccess: async () => {
      props.onClose()
      await queryClient.invalidateQueries({ queryKey: ['referral-extension'] })
      toast.success(t('Referral operation completed'))
    },
  })
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={
        props.value.approve
          ? t('Approve referral qualification')
          : t('Reject referral qualification')
      }
      desc={t('Review invitation notice', {
        id: props.value.invitee.user_id,
        inviter: props.value.invitee.inviter_id,
      })}
      confirmText={t('Confirm')}
      destructive={!props.value.approve}
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
                    maxLength={500}
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
