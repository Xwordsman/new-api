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
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { DateTimePicker } from '@/components/datetime-picker'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { toIntlLocale } from '@/i18n/languages'

import type { PromotionForm } from './schema'

export function PromotionFields(props: {
  index: number
  baseRatio?: number
  disabled: boolean
}) {
  const { t, i18n } = useTranslation()
  const form = useFormContext<PromotionForm>()
  const promotion = form.watch(`groups.${props.index}.promotion`)
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 8 })
  return (
    <section aria-label={t('Public group discount')} className='space-y-5'>
      <FormField
        control={form.control}
        name={`groups.${props.index}.promotion`}
        render={({ field }) => (
          <FormItem className='flex items-center justify-between gap-4'>
            <div className='space-y-1.5'>
              <FormLabel data-error={false}>
                {t('Enable public discount')}
              </FormLabel>
              <FormDescription>
                {t(
                  'Set the final public multiplier during the scheduled period.'
                )}
              </FormDescription>
            </div>
            {/* The controller stores the entire rule; validation errors belong to its individual fields below. */}
            <FormControl aria-invalid={false}>
              <Switch
                onBlur={field.onBlur}
                checked={field.value?.enabled ?? false}
                disabled={props.disabled}
                onCheckedChange={(enabled) =>
                  field.onChange({
                    ratio: (props.baseRatio ?? 1) * 0.8,
                    label: '',
                    starts_at: 0,
                    ends_at: 0,
                    daily_start: '',
                    daily_end: '',
                    timezone: 'Asia/Shanghai',
                    ...field.value,
                    enabled,
                  })
                }
              />
            </FormControl>
          </FormItem>
        )}
      />
      {promotion && (
        <>
          <div className='grid gap-5 sm:grid-cols-2'>
            <FormField
              control={form.control}
              name={`groups.${props.index}.promotion.ratio`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Discounted multiplier')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type='number'
                      min='0.00000001'
                      step='any'
                      value={Number.isNaN(field.value) ? '' : field.value}
                      onChange={(event) =>
                        field.onChange(event.target.valueAsNumber)
                      }
                      disabled={props.disabled}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Enter the final multiplier, for example 0.24 instead of a base multiplier of 0.3. If the base falls below it, the lower base applies.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`groups.${props.index}.promotion.label`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Offer label')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={80}
                      placeholder={t('Limited-time offer')}
                      disabled={props.disabled}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {(['starts_at', 'ends_at'] as const).map((key) => {
              const label =
                key === 'starts_at' ? t('Offer starts') : t('Offer ends')
              return (
                <FormField
                  key={key}
                  control={form.control}
                  name={`groups.${props.index}.promotion.${key}`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{label}</FormLabel>
                      <FormControl>
                        <DateTimePicker
                          ref={field.ref}
                          aria-label={label}
                          value={
                            field.value > 0
                              ? new Date(field.value * 1000)
                              : undefined
                          }
                          onChange={(date) =>
                            field.onChange(
                              date ? Math.floor(date.getTime() / 1000) : 0
                            )
                          }
                          onBlur={field.onBlur}
                          disabled={props.disabled}
                          placeholder={t('No time limit')}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )
            })}
          </div>
          <p className='text-muted-foreground text-xs leading-5'>
            {t(
              'Dates use your browser time zone. Leave the start empty for immediate availability, or the end empty for no expiry.'
            )}
          </p>
          <div className='grid gap-5 sm:grid-cols-3'>
            {(['daily_start', 'daily_end', 'timezone'] as const).map((key) => {
              let label = t('Daily time zone')
              if (key === 'daily_start') label = t('Daily start time')
              if (key === 'daily_end') label = t('Daily end time')
              return (
                <FormField
                  key={key}
                  control={form.control}
                  name={`groups.${props.index}.promotion.${key}`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{label}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type={key === 'timezone' ? 'text' : 'time'}
                          step={key === 'timezone' ? undefined : 60}
                          placeholder={
                            key === 'timezone' ? 'Asia/Shanghai' : undefined
                          }
                          disabled={props.disabled}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )
            })}
          </div>
          <p className='text-muted-foreground text-xs leading-5'>
            {t(
              'Optional daily schedule, using the IANA time zone above (default: Asia/Shanghai). Overnight periods are supported. Leave both times empty for all day. The end time is exclusive.'
            )}
          </p>
          {props.baseRatio !== undefined &&
            Number.isFinite(promotion.ratio) &&
            promotion.ratio > 0 && (
              <p className='rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 text-sm text-sky-700 dark:text-sky-300'>
                {t('Multiplier during offer')}:{' '}
                <span className='font-mono tabular-nums'>
                  ×{formatter.format(props.baseRatio)} → ×
                  {formatter.format(Math.min(props.baseRatio, promotion.ratio))}
                </span>
              </p>
            )}
        </>
      )}
    </section>
  )
}
