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
import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { Switch } from '@/components/ui/switch'
import { useSystemConfig } from '@/hooks/use-system-config'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { CHECKIN_QUERY_KEY, saveCheckinSettings } from '../api'
import {
  checkinSettingsSchema,
  type CheckinSettingsValues,
} from '../lib/schema'
import type { CheckinSettings } from '../types'

function checkinSettingsValues(
  settings: CheckinSettings,
  quotaPerUnit: number
): CheckinSettingsValues {
  return {
    ...settings,
    reward_min_usd: settings.reward_min_quota / quotaPerUnit,
    reward_max_usd: settings.reward_max_quota / quotaPerUnit,
    monthly_cap_usd: settings.monthly_cap_quota / quotaPerUnit,
    lifetime_cap_usd: settings.lifetime_cap_quota / quotaPerUnit,
    daily_budget_usd: settings.daily_budget_quota / quotaPerUnit,
  }
}

export function CheckinSettingsForm(props: { settings: CheckinSettings }) {
  const { t } = useTranslation()
  const { currency } = useSystemConfig()
  const quotaPerUnit = currency.quotaPerUnit
  const queryClient = useQueryClient()
  const [version, setVersion] = useState(props.settings.version)
  const [discardOpen, setDiscardOpen] = useState(false)
  const form = useForm<CheckinSettingsValues>({
    resolver: zodResolver(checkinSettingsSchema),
    defaultValues: checkinSettingsValues(props.settings, quotaPerUnit),
  })
  const isDirty = form.formState.isDirty
  const rewardMode = useWatch({ control: form.control, name: 'reward_mode' })
  const rechargeMode = useWatch({
    control: form.control,
    name: 'recharge_mode',
  })
  const eligibilityDays = useWatch({
    control: form.control,
    name: 'eligibility_days',
  })
  const thresholdAmount = useWatch({
    control: form.control,
    name: 'threshold_amount',
  })
  const noRechargeRequired = Number(thresholdAmount) === 0
  useEffect(() => {
    if (!isDirty) {
      form.reset(checkinSettingsValues(props.settings, quotaPerUnit))
      setVersion(props.settings.version)
    }
  }, [props.settings, quotaPerUnit, form, isDirty])
  const save = useMutation({
    mutationFn: (values: CheckinSettingsValues) =>
      saveCheckinSettings({
        enabled: values.enabled,
        version,
        threshold_amount: values.threshold_amount,
        currency: values.currency,
        cny_per_usd: values.cny_per_usd,
        recharge_mode: values.recharge_mode,
        lookback_days: values.lookback_days,
        include_subscriptions: values.include_subscriptions,
        eligibility_days: values.eligibility_days,
        renew_on_recharge: values.renew_on_recharge,
        reward_mode: values.reward_mode,
        reward_min_quota: Math.round(values.reward_min_usd * quotaPerUnit),
        reward_max_quota: Math.round(
          (values.reward_mode === 'fixed'
            ? values.reward_min_usd
            : values.reward_max_usd) * quotaPerUnit
        ),
        monthly_cap_quota: Math.round(values.monthly_cap_usd * quotaPerUnit),
        lifetime_cap_quota: Math.round(values.lifetime_cap_usd * quotaPerUnit),
        daily_budget_quota: Math.round(values.daily_budget_usd * quotaPerUnit),
        timezone: values.timezone,
        follow_registration_risk: values.follow_registration_risk,
        require_turnstile: values.require_turnstile,
      }),
    onSuccess: async (settings) => {
      setVersion(settings.version)
      queryClient.setQueryData([...CHECKIN_QUERY_KEY, 'settings'], settings)
      form.reset(checkinSettingsValues(settings, quotaPerUnit))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CHECKIN_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY }),
      ])
      toast.success(t('Check-in settings saved'))
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: [...CHECKIN_QUERY_KEY, 'settings'],
      }),
  })
  const switches = [
    {
      name: 'include_subscriptions',
      label: t('Include subscription payments'),
      description: t(
        'Count verified external subscription payments; wallet-funded purchases are excluded.'
      ),
    },
    {
      name: 'renew_on_recharge',
      label: t('Renew qualification after recharge'),
      description: t(
        'When a qualification duration is set, a new qualifying recharge starts a new duration.'
      ),
    },
    {
      name: 'follow_registration_risk',
      label: t('Follow registration risk review'),
      description: t(
        'Pause claims for accounts blocked or awaiting review in registration protection.'
      ),
    },
    {
      name: 'require_turnstile',
      label: t('Require verification before check-in'),
      description: t(
        'Uses the site Turnstile configuration. Claims remain unavailable if verification is enabled without a site key.'
      ),
    },
  ] as const
  const numberFields = [
    {
      name: 'lookback_days',
      label: t('Recharge lookback (days)'),
      min: 1,
      max: 3650,
      step: 1,
      disabled: noRechargeRequired || rechargeMode !== 'rolling',
    },
    {
      name: 'eligibility_days',
      label: t('Qualification duration (days, 0 means no expiry)'),
      min: 0,
      max: 3650,
      step: 1,
      disabled: noRechargeRequired,
    },
    {
      name: 'reward_min_usd',
      label:
        rewardMode === 'fixed'
          ? t('Daily reward (USD)')
          : t('Minimum daily reward (USD)'),
      min: 1 / quotaPerUnit,
      max: 1_000_000,
      step: 1 / quotaPerUnit,
    },
    {
      name: 'reward_max_usd',
      label: t('Maximum daily reward (USD)'),
      min: 1 / quotaPerUnit,
      max: 1_000_000,
      step: 1 / quotaPerUnit,
      disabled: rewardMode === 'fixed',
    },
    {
      name: 'monthly_cap_usd',
      label: t('Per-user monthly cap (USD)'),
      min: 0,
      max: 1_000_000,
      step: 1 / quotaPerUnit,
    },
    {
      name: 'lifetime_cap_usd',
      label: t('Per-user lifetime cap (USD)'),
      min: 0,
      max: 1_000_000,
      step: 1 / quotaPerUnit,
    },
    {
      name: 'daily_budget_usd',
      label: t('Daily site budget (USD)'),
      min: 0,
      max: 1_000_000,
      step: 1 / quotaPerUnit,
    },
  ] as const
  const selections = [
    {
      name: 'currency',
      label: t('Recharge threshold currency'),
      options: [
        { value: 'CNY', label: 'CNY' },
        { value: 'USD', label: 'USD' },
      ],
    },
    {
      name: 'recharge_mode',
      label: t('Eligible recharge period'),
      options: [
        { value: 'lifetime', label: t('Lifetime net recharge') },
        { value: 'rolling', label: t('Rolling recharge window') },
      ],
    },
    {
      name: 'reward_mode',
      label: t('Reward mode'),
      options: [
        { value: 'fixed', label: t('Fixed reward') },
        { value: 'random', label: t('Random reward') },
      ],
    },
  ] as const
  const textFields = [
    {
      name: 'threshold_amount',
      label: t('Minimum verified recharge'),
      inputMode: 'decimal',
      description: noRechargeRequired
        ? t(
            'A zero recharge threshold removes recharge and qualification expiry requirements. Other checks still apply.'
          )
        : t('Only verified net payments count toward this threshold.'),
    },
    {
      name: 'cny_per_usd',
      label: t('CNY per USD for check-in payments'),
      inputMode: 'decimal',
      description: t(
        'Payment conversion rates are saved with each payment. Changing this rate does not rewrite previous payment records.'
      ),
    },
    {
      name: 'timezone',
      label: t('Check-in time zone'),
      inputMode: 'text',
      description: t(
        'Daily resets and monthly limits follow this IANA time zone, such as Asia/Shanghai.'
      ),
    },
  ] as const

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => save.mutate(values))}
        className='space-y-5'
      >
        <Card data-card-hover='false'>
          <CardHeader className='flex flex-row items-start justify-between gap-4'>
            <div className='space-y-2'>
              <CardTitle>{t('Check-in settings')}</CardTitle>
              <CardDescription>
                {t(
                  'Configure recharge qualification, daily rewards and anti-abuse controls. A cap of zero means unlimited.'
                )}
              </CardDescription>
            </div>
            <Button
              type='submit'
              disabled={
                save.isPending || !isDirty || props.settings.version !== version
              }
            >
              <Save aria-hidden='true' />
              {t('Save Changes')}
            </Button>
          </CardHeader>
          <CardContent className='space-y-6'>
            {props.settings.version !== version && isDirty && (
              <div
                className='border-warning/40 bg-warning/5 space-y-3 rounded-lg border p-4'
                role='alert'
              >
                <p className='text-sm'>
                  {t(
                    'Check-in settings changed elsewhere. Your edits are preserved; reload the latest settings before saving again.'
                  )}
                </p>
                <Button
                  variant='outline'
                  size='sm'
                  type='button'
                  onClick={() => setDiscardOpen(true)}
                >
                  {t('Reload latest settings')}
                </Button>
              </div>
            )}
            <FormField
              control={form.control}
              name='enabled'
              render={({ field }) => (
                <FormItem className='flex items-center justify-between gap-4 rounded-lg border p-4'>
                  <div className='space-y-1'>
                    <FormLabel>{t('Enable check-in plugin')}</FormLabel>
                    <FormDescription>
                      {t(
                        'When disabled, the check-in menu is hidden and all claim entry points are closed.'
                      )}
                    </FormDescription>
                  </div>
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
            <div className='grid gap-6 md:grid-cols-2 xl:grid-cols-3'>
              {selections.map((item) => (
                <FormField
                  key={item.name}
                  control={form.control}
                  name={item.name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{item.label}</FormLabel>
                      <Select
                        items={item.options}
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={save.isPending}
                      >
                        <FormControl>
                          <SelectTrigger className='w-full'>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {item.options.map((option) => (
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
              ))}
              {textFields.map((item) => (
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
                          disabled={save.isPending}
                        />
                      </FormControl>
                      <FormDescription>{item.description}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
              {numberFields.map((item) => (
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
                          value={Number.isNaN(field.value) ? '' : field.value}
                          type='number'
                          min={item.min}
                          max={item.max}
                          step={item.step}
                          disabled={
                            save.isPending ||
                            ('disabled' in item && item.disabled)
                          }
                          onChange={(event) =>
                            field.onChange(event.target.valueAsNumber)
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>
          </CardContent>
        </Card>
        <Card data-card-hover='false'>
          <CardHeader>
            <CardTitle>{t('Qualification and abuse protection')}</CardTitle>
          </CardHeader>
          <CardContent className='grid gap-4 md:grid-cols-2'>
            {switches.map((item) => (
              <FormField
                key={item.name}
                control={form.control}
                name={item.name}
                render={({ field }) => (
                  <FormItem className='flex items-start justify-between gap-4 rounded-lg border p-4'>
                    <div className='space-y-2'>
                      <FormLabel>{item.label}</FormLabel>
                      <FormDescription>{item.description}</FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={
                          save.isPending ||
                          (item.name === 'renew_on_recharge' &&
                            (noRechargeRequired || eligibilityDays === 0))
                        }
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            ))}
          </CardContent>
        </Card>
      </form>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={t('Reload latest settings')}
        desc={t(
          'Discard unsaved check-in edits and load the latest saved settings?'
        )}
        confirmText={t('Reload')}
        handleConfirm={() => {
          form.reset(checkinSettingsValues(props.settings, quotaPerUnit))
          setVersion(props.settings.version)
          setDiscardOpen(false)
        }}
      />
    </Form>
  )
}
