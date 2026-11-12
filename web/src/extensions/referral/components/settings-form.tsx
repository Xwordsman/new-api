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
import { Save } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
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
import { Switch } from '@/components/ui/switch'
import { useSystemConfig } from '@/hooks/use-system-config'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { saveReferralSettings } from '../api'
import {
  referralSettingsSchema,
  type ReferralSettingsValues,
} from '../lib/schema'
import type { ReferralSettings } from '../types'

export function SettingsForm(props: { settings: ReferralSettings }) {
  const { t } = useTranslation()
  const { currency } = useSystemConfig()
  const queryClient = useQueryClient()
  const form = useForm<ReferralSettingsValues>({
    resolver: zodResolver(referralSettingsSchema),
    defaultValues: {
      enabled: true,
      rate: 5,
      window_days: 30,
      cooling_hours: 24,
      cap_usd: 100,
      cny_per_usd: '7.2',
    },
  })
  useEffect(() => {
    form.reset({
      ...props.settings,
      rate: props.settings.rate_bps / 100,
      cap_usd: props.settings.cap_quota / currency.quotaPerUnit,
    })
  }, [props.settings, form, currency.quotaPerUnit])
  const save = useMutation({
    mutationFn: (values: ReferralSettingsValues) =>
      saveReferralSettings({
        ...props.settings,
        enabled: values.enabled,
        rate_bps: Math.round(values.rate * 100),
        window_days: values.window_days,
        cooling_hours: values.cooling_hours,
        cap_quota: Math.round(values.cap_usd * currency.quotaPerUnit),
        cny_per_usd: values.cny_per_usd,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['referral-extension'] }),
        queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY }),
      ])
      toast.success(t('Referral settings saved'))
    },
  })
  const fields = [
    {
      name: 'rate',
      label: t('Reward rate (%)'),
      description: t('Percentage of verified net payment, from 0 to 100.'),
      min: 0,
      max: 100,
      step: 0.01,
    },
    {
      name: 'window_days',
      label: t('Reward window (days)'),
      description: t('Starts at registration for each new invitee.'),
      min: 1,
      max: 3650,
      step: 1,
    },
    {
      name: 'cooling_hours',
      label: t('Cooling period (hours)'),
      description: t('Minimum wait after payment before claiming.'),
      min: 0,
      max: 8760,
      step: 1,
    },
    {
      name: 'cap_usd',
      label: t('Per-invitee cap (USD)'),
      description: t(
        'Lifetime reward cap per invitee across all eligible orders.'
      ),
      min: 0.01,
      max: 1_000_000,
      step: 0.01,
    },
  ] as const
  return (
    <Form {...form}>
      <form
        className='console-surface bg-card space-y-6 rounded-xl border p-5 sm:p-6'
        onSubmit={form.handleSubmit((values) => save.mutate(values))}
      >
        <div className='flex items-start justify-between gap-4'>
          <div>
            <h3 className='font-semibold'>{t('Referral program settings')}</h3>
            <p className='text-muted-foreground mt-2 max-w-2xl text-xs leading-6'>
              {t(
                'Changes apply to new invitations. Existing invitees keep their saved rate, window, cooling period and cap. Pausing stops new rewards and claims, but preserves balances.'
              )}
            </p>
          </div>
          <Button
            type='submit'
            disabled={save.isPending || !form.formState.isDirty}
          >
            <Save />
            {t('Save')}
          </Button>
        </div>
        <FormField
          control={form.control}
          name='enabled'
          render={({ field }) => (
            <FormItem className='flex items-center justify-between rounded-lg border p-4'>
              <FormLabel>{t('Enable referral program')}</FormLabel>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={save.isPending}
                />
              </FormControl>
            </FormItem>
          )}
        />
        <div className='grid gap-5 sm:grid-cols-2'>
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
                      type='number'
                      min={item.min}
                      max={item.max}
                      step={item.step}
                      disabled={save.isPending}
                      onChange={(event) =>
                        field.onChange(event.target.valueAsNumber)
                      }
                    />
                  </FormControl>
                  <FormDescription>{item.description}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
        </div>
        <FormField
          control={form.control}
          name='cny_per_usd'
          render={({ field }) => (
            <FormItem className='max-w-sm'>
              <FormLabel>{t('CNY per USD for referral payments')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  inputMode='decimal'
                  disabled={save.isPending}
                />
              </FormControl>
              <FormDescription>
                {t(
                  'Used only to normalize actual CNY payments. Promotional wallet credits never affect the reward base. Other currencies require reconciliation.'
                )}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  )
}
