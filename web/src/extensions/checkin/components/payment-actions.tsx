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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

import {
  CHECKIN_QUERY_KEY,
  reconcileCheckinPayment,
  refundCheckinPayment,
} from '../api'
import {
  checkinReconcileSchema,
  checkinRefundSchema,
  type CheckinReconcileValues,
  type CheckinRefundValues,
} from '../lib/schema'
import type { CheckinPayment } from '../types'

export function CheckinReconcileDialog(props: {
  payment?: CheckinPayment
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<CheckinReconcileValues>({
    resolver: zodResolver(checkinReconcileSchema),
    defaultValues: {
      user_id: props.payment?.user_id ?? 0,
      source:
        props.payment?.source === 'subscription' ? 'subscription' : 'topup',
      trade_no: props.payment?.trade_no ?? '',
      reference: props.payment?.reference ?? '',
      amount: props.payment?.amount ?? '',
      currency: props.payment?.currency ?? 'CNY',
      usd_per_unit: props.payment?.usd_per_unit ?? '',
      reason: '',
    },
  })
  const mutation = useMutation({
    mutationFn: (values: CheckinReconcileValues) =>
      reconcileCheckinPayment({
        ...values,
        reference: values.reference || undefined,
        usd_per_unit: values.usd_per_unit || undefined,
      }),
    onSuccess: async () => {
      props.onClose()
      await queryClient.invalidateQueries({ queryKey: CHECKIN_QUERY_KEY })
      toast.success(t('Check-in payment reconciled'))
    },
  })
  const sourceOptions = [
    { value: 'topup', label: t('Wallet recharge') },
    { value: 'subscription', label: t('Subscription payment') },
  ]
  const fields = [
    { name: 'trade_no', label: t('Payment order'), inputMode: 'text' },
    {
      name: 'reference',
      label: t('Payment reference (optional)'),
      inputMode: 'text',
    },
    { name: 'amount', label: t('Actual paid amount'), inputMode: 'decimal' },
    { name: 'currency', label: t('Payment currency'), inputMode: 'text' },
    {
      name: 'usd_per_unit',
      label: t('USD per currency unit (optional)'),
      inputMode: 'decimal',
    },
  ] as const

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) props.onClose()
      }}
      title={t('Reconcile check-in payment')}
      desc={t(
        'Verify the successful external payment and its owner before recording the actual amount. This updates check-in qualification only and never credits the wallet again.'
      )}
      confirmText={t('Confirm reconciliation')}
      isLoading={mutation.isPending}
      className='max-h-[90svh] overflow-y-auto sm:max-w-lg'
      handleConfirm={form.handleSubmit((values) => mutation.mutate(values))}
    >
      <Form {...form}>
        <form
          className='space-y-4'
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <div className='grid gap-4 sm:grid-cols-2'>
            <FormField
              control={form.control}
              name='user_id'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('User ID')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value || ''}
                      type='number'
                      min={1}
                      step={1}
                      disabled={mutation.isPending || !!props.payment}
                      onChange={(event) =>
                        field.onChange(event.target.valueAsNumber)
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='source'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Payment source')}</FormLabel>
                  <Select
                    items={sourceOptions}
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={mutation.isPending || !!props.payment}
                  >
                    <FormControl>
                      <SelectTrigger className='w-full'>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {sourceOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          {fields.map((item) => (
            <FormField
              key={item.name}
              control={form.control}
              name={item.name}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{item.label}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      inputMode={item.inputMode}
                      disabled={
                        mutation.isPending ||
                        ((item.name === 'trade_no' ||
                          item.name === 'reference') &&
                          !!props.payment)
                      }
                    />
                  </FormControl>
                  {item.name === 'reference' && (
                    <FormDescription>
                      {props.payment
                        ? t('The recorded payment reference cannot be changed.')
                        : t(
                            "Enter the payment provider's actual payment reference. For Stripe, use the PaymentIntent (pi_) or invoice (in_) ID to match automatic refunds. Do not reuse a reference for another order."
                          )}
                    </FormDescription>
                  )}
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

export function CheckinRefundDialog(props: {
  payment?: CheckinPayment
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<CheckinRefundValues>({
    resolver: zodResolver(checkinRefundSchema),
    defaultValues: {
      trade_no: props.payment?.trade_no ?? '',
      amount: props.payment?.refunded_amount ?? '',
      reason: '',
    },
  })
  const mutation = useMutation({
    mutationFn: refundCheckinPayment,
    onSuccess: async () => {
      props.onClose()
      await queryClient.invalidateQueries({ queryKey: CHECKIN_QUERY_KEY })
      toast.success(t('Check-in refund recorded'))
    },
  })
  const fields = [
    { name: 'trade_no', label: t('Payment order'), inputMode: 'text' },
    {
      name: 'amount',
      label: t('Cumulative refunded amount'),
      inputMode: 'decimal',
    },
  ] as const

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) props.onClose()
      }}
      title={t('Record check-in payment refund')}
      desc={t(
        'Enter the total refunded amount for this order in its original currency, not this refund alone. This can suspend future check-ins when the remaining net payment falls below the threshold.'
      )}
      confirmText={t('Record refund')}
      destructive
      isLoading={mutation.isPending}
      handleConfirm={form.handleSubmit((values) => mutation.mutate(values))}
    >
      <Form {...form}>
        <form
          className='space-y-4'
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          {fields.map((item) => (
            <FormField
              key={item.name}
              control={form.control}
              name={item.name}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{item.label}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      inputMode={item.inputMode}
                      disabled={
                        mutation.isPending ||
                        (item.name === 'trade_no' && !!props.payment)
                      }
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
