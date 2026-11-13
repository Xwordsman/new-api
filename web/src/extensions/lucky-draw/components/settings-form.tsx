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
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
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
import { Switch } from '@/components/ui/switch'
import { useSystemConfig } from '@/hooks/use-system-config'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { DRAW_QUERY_KEY, saveDrawSettings } from '../api'
import { drawSettingsSchema } from '../lib/schema'
import type { DrawSettings, DrawSummary } from '../types'

export function DrawSettingsForm(props: {
  settings: DrawSettings
  summary?: DrawSummary
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { currency } = useSystemConfig()
  const unit = currency.quotaPerUnit
  const client = useQueryClient()
  const [discardOpen, setDiscardOpen] = useState(false)
  const form = useForm<DrawSettings>({
    resolver: zodResolver(drawSettingsSchema),
    defaultValues: props.settings,
  })
  const dirty = form.formState.isDirty
  useEffect(() => {
    if (!dirty) form.reset(props.settings)
  }, [props.settings, dirty, form])
  const prizes = useWatch({ control: form.control, name: 'prizes' })
  const values = useWatch({ control: form.control })
  const fields = useFieldArray({ control: form.control, name: 'prizes' })
  const probability = prizes.reduce((sum, p) => sum + p.weight, 0)
  // Divide before multiplication so safe wallet integers are never multiplied
  // by a million in JavaScript. This is an estimate, not settlement arithmetic.
  const expected = prizes.reduce(
    (sum, p) => sum + (p.quota / 1_000_000) * p.weight,
    0
  )
  const largest = Math.max(
    ...prizes.filter((p) => p.weight > 0).map((p) => p.quota),
    0
  )
  const tooSmall = [
    values.daily_budget_quota,
    values.total_budget_quota,
    values.user_cap_quota,
  ].some((v) => v !== undefined && v > 0 && v < largest)
  const save = useMutation({
    mutationFn: saveDrawSettings,
    onSuccess: (s) => {
      form.reset(s)
      client.setQueryData([...DRAW_QUERY_KEY, 'settings'], s)
      void client.invalidateQueries({ queryKey: DRAW_QUERY_KEY })
      void client.invalidateQueries({ queryKey: STATUS_QUERY_KEY })
      toast.success(t('Lucky draw settings saved'))
    },
  })
  const numberFields = [
    {
      name: 'lookback_days',
      label: 'Recharge lookback days',
      min: 1,
      max: 3650,
    },
    {
      name: 'eligibility_days',
      label: 'Qualification duration (days, 0 = unlimited)',
      min: 0,
      max: 3650,
    },
    { name: 'daily_attempts', label: 'Daily attempts', min: 1, max: 100 },
    {
      name: 'daily_budget_quota',
      label: 'Daily prize budget',
      money: true,
      min: 0,
    },
    {
      name: 'total_budget_quota',
      label: 'Total prize budget',
      money: true,
      min: 0,
    },
    {
      name: 'user_cap_quota',
      label: 'Per-user reward cap',
      money: true,
      min: 0,
    },
  ] as const
  const switches = [
    { name: 'enabled', label: 'Enable lucky draw' },
    { name: 'include_subscriptions', label: 'Include subscription payments' },
    { name: 'renew_on_recharge', label: 'Renew qualification after recharge' },
    {
      name: 'follow_registration_risk',
      label: 'Follow registration risk review',
    },
    { name: 'require_turnstile', label: 'Require human verification' },
    { name: 'show_winners', label: 'Show masked recent winners' },
  ] as const
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((s) => save.mutate(s))}
        className='space-y-5'
      >
        <fieldset disabled={save.isPending} className='min-w-0 space-y-5'>
          <Card data-card-hover='false'>
            <CardHeader>
              <CardTitle>{t('Qualification and limits')}</CardTitle>
            </CardHeader>
            <CardContent className='space-y-5'>
              <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
                {switches.map((s) => (
                  <FormField
                    key={s.name}
                    control={form.control}
                    name={s.name}
                    render={({ field }) => (
                      <FormItem className='flex items-center justify-between gap-3 rounded-md border p-3'>
                        <FormLabel>{t(s.label)}</FormLabel>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>
              <div className='grid gap-5 sm:grid-cols-2 xl:grid-cols-3'>
                <FormField
                  control={form.control}
                  name='threshold_amount'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Recharge requirement')}</FormLabel>
                      <FormControl>
                        <Input {...field} inputMode='decimal' />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='currency'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Payment currency')}</FormLabel>
                      <FormControl>
                        <NativeSelect {...field} className='w-full'>
                          <NativeSelectOption value='CNY'>
                            CNY
                          </NativeSelectOption>
                          <NativeSelectOption value='USD'>
                            USD
                          </NativeSelectOption>
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='recharge_mode'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Recharge calculation')}</FormLabel>
                      <FormControl>
                        <NativeSelect {...field} className='w-full'>
                          <NativeSelectOption value='lifetime'>
                            {t('Lifetime recharge')}
                          </NativeSelectOption>
                          <NativeSelectOption value='rolling'>
                            {t('Recent recharge')}
                          </NativeSelectOption>
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {numberFields.map((s) => (
                  <FormField
                    key={s.name}
                    control={form.control}
                    name={s.name}
                    render={({ field }) => {
                      const money = 'money' in s && s.money
                      return (
                        <FormItem>
                          <FormLabel>
                            {t(s.label)}
                            {money && ' (USD)'}
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type='number'
                              min={s.min}
                              max={'max' in s ? s.max : undefined}
                              step={money ? 1 / unit : 1}
                              value={money ? field.value / unit : field.value}
                              onChange={(e) =>
                                field.onChange(
                                  money
                                    ? Math.round(e.target.valueAsNumber * unit)
                                    : e.target.valueAsNumber
                                )
                              }
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )
                    }}
                  />
                ))}
                <FormField
                  control={form.control}
                  name='timezone'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Reset time zone')}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder='Asia/Shanghai' />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='allowed_groups'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Allowed groups (empty = all)')}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {(['starts_at', 'ends_at'] as const).map((name) => (
                  <FormField
                    key={name}
                    control={form.control}
                    name={name}
                    render={({ field }) => {
                      let value = ''
                      if (field.value) {
                        const date = new Date(field.value * 1000)
                        value = new Date(
                          date.getTime() - date.getTimezoneOffset() * 60_000
                        )
                          .toISOString()
                          .slice(0, 16)
                      }
                      return (
                        <FormItem>
                          <FormLabel>
                            {t(
                              name === 'starts_at'
                                ? 'Activity start (browser time)'
                                : 'Activity end (browser time)'
                            )}
                          </FormLabel>
                          <FormControl>
                            <Input
                              type='datetime-local'
                              name={field.name}
                              ref={field.ref}
                              onBlur={field.onBlur}
                              value={value}
                              onChange={(e) =>
                                field.onChange(
                                  e.target.value
                                    ? Math.floor(
                                        new Date(e.target.value).getTime() /
                                          1000
                                      )
                                    : 0
                                )
                              }
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )
                    }}
                  />
                ))}
              </div>
              <p className='text-muted-foreground text-sm'>
                {t(
                  'Zero budgets mean unlimited. Rewards are wallet credits in USD. Payment conversion uses the verified payment ledger shared with check-in.'
                )}
              </p>
              <p className='text-muted-foreground text-sm'>
                {t(
                  'Turnstile uses the site configuration. Enabling it without valid site keys pauses drawing.'
                )}
              </p>
              {tooSmall && (
                <p role='alert' className='text-destructive text-sm'>
                  {t(
                    'A configured limit is smaller than the largest prize. Drawing will remain paused.'
                  )}
                </p>
              )}
            </CardContent>
          </Card>
          <Card data-card-hover='false'>
            <CardHeader>
              <CardTitle>{t('Prize pool')}</CardTitle>
            </CardHeader>
            <CardContent className='space-y-5'>
              <div className='flex flex-wrap gap-4 text-sm'>
                <p
                  className={
                    probability === 1_000_000
                      ? 'text-primary'
                      : 'text-destructive'
                  }
                  role='status'
                >
                  {t('Total probability')}:{' '}
                  {new Intl.NumberFormat(locale, {
                    maximumFractionDigits: 4,
                  }).format(probability / 10000)}
                  %
                </p>
                <p>
                  {t('Expected reward per draw')}:{' '}
                  {formatQuotaWithCurrency(expected, {
                    locale,
                    abbreviate: false,
                    digitsSmall: 6,
                  })}
                </p>
              </div>
              <p className='text-muted-foreground text-sm'>
                {t(
                  'Keep 6 to 8 prizes. Probabilities support four decimal places and must total 100%. Stock is lifetime inventory; editing or reordering never resets awards.'
                )}
              </p>
              {fields.fields.map((item, index) => (
                <div key={item.id} className='space-y-4 rounded-md border p-4'>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <span className='text-muted-foreground text-sm'>
                      {t('Prize')} {index + 1} · ID: {prizes[index]?.id} ·{' '}
                      {t('Awarded')}:{' '}
                      {formatNumber(
                        props.summary?.stock.find(
                          (s) => s.prize_id === prizes[index]?.id
                        )?.awarded ?? 0,
                        locale
                      )}
                    </span>
                    <div className='flex gap-1'>
                      <Button
                        type='button'
                        size='icon'
                        variant='ghost'
                        aria-label={t('Move up')}
                        disabled={index === 0}
                        onClick={() => fields.swap(index, index - 1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type='button'
                        size='icon'
                        variant='ghost'
                        aria-label={t('Move down')}
                        disabled={index === fields.fields.length - 1}
                        onClick={() => fields.swap(index, index + 1)}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        type='button'
                        size='icon'
                        variant='ghost'
                        aria-label={t('Remove prize')}
                        disabled={fields.fields.length <= 6}
                        onClick={() => fields.remove(index)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                  <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
                    <FormField
                      control={form.control}
                      name={`prizes.${index}.name`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('Prize name')}</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`prizes.${index}.kind`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('Prize type')}</FormLabel>
                          <FormControl>
                            <NativeSelect
                              {...field}
                              className='w-full'
                              onChange={(e) => {
                                field.onChange(e)
                                if (e.target.value === 'none') {
                                  form.setValue(`prizes.${index}.quota`, 0)
                                  form.setValue(`prizes.${index}.stock`, 0)
                                }
                              }}
                            >
                              <NativeSelectOption value='credit'>
                                {t('Wallet credit')}
                              </NativeSelectOption>
                              <NativeSelectOption value='none'>
                                {t('No reward')}
                              </NativeSelectOption>
                            </NativeSelect>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {(
                      [
                        {
                          name: 'quota',
                          label: 'Reward',
                          factor: unit,
                          max: Number.MAX_SAFE_INTEGER / unit,
                        },
                        {
                          name: 'weight',
                          label: 'Probability (%)',
                          factor: 10000,
                          max: 100,
                        },
                        {
                          name: 'stock',
                          label: 'Stock (0 = unlimited)',
                          factor: 1,
                          max: 1e9,
                        },
                      ] as const
                    ).map((s) => (
                      <FormField
                        key={s.name}
                        control={form.control}
                        name={`prizes.${index}.${s.name}`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              {t(s.label)}
                              {s.name === 'quota' && ' (USD)'}
                            </FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                type='number'
                                min={0}
                                max={s.max}
                                step={1 / s.factor}
                                disabled={
                                  s.name !== 'weight' &&
                                  prizes[index]?.kind === 'none'
                                }
                                value={field.value / s.factor}
                                onChange={(e) =>
                                  field.onChange(
                                    Math.round(
                                      e.target.valueAsNumber * s.factor
                                    )
                                  )
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
                      name={`prizes.${index}.color`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('Prize color')}</FormLabel>
                          <FormControl>
                            <Input {...field} type='color' />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              ))}
              {form.formState.errors.prizes?.message && (
                <p role='alert' className='text-destructive text-sm'>
                  {t(form.formState.errors.prizes.message)}
                </p>
              )}
              <Button
                type='button'
                variant='outline'
                disabled={fields.fields.length >= 8}
                onClick={() =>
                  fields.append({
                    id: crypto.randomUUID().replaceAll('-', ''),
                    name: t('New prize'),
                    kind: 'credit',
                    quota: Math.round(unit * 0.01),
                    weight: 0,
                    stock: 0,
                    color: '#0d9488',
                  })
                }
              >
                <Plus aria-hidden='true' />
                {t('Add prize')}
              </Button>
            </CardContent>
          </Card>
          <div className='flex flex-wrap items-center gap-3'>
            <Button type='submit' disabled={probability !== 1_000_000}>
              <Save aria-hidden='true' />
              {save.isPending ? t('Saving...') : t('Save settings')}
            </Button>
            <Button
              type='button'
              variant='outline'
              onClick={() => setDiscardOpen(true)}
            >
              {t('Discard changes')}
            </Button>
            {props.settings.version !== values.version && (
              <p className='text-destructive text-sm'>
                {t('Lucky draw settings changed. Reload before continuing.')}
              </p>
            )}
          </div>
        </fieldset>
        <ConfirmDialog
          open={discardOpen}
          onOpenChange={setDiscardOpen}
          title={t('Discard changes')}
          desc={t('Discard unsaved changes and load the latest settings?')}
          handleConfirm={() => {
            form.reset(props.settings)
            setDiscardOpen(false)
          }}
        />
      </form>
    </Form>
  )
}
