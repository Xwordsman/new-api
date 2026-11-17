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
import { Plus, Trash2 } from 'lucide-react'
import { useFieldArray, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { toIntlLocale } from '@/i18n/languages'

import type { PromotionForm } from './schema'

export function PromotionPeriods(props: {
  index: number
  disabled: boolean
  baseRatio?: number
}) {
  const { t, i18n } = useTranslation()
  const form = useFormContext<PromotionForm>()
  const periods = useFieldArray({
    control: form.control,
    name: `groups.${props.index}.promotion.daily_periods`,
  })
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 8 })
  return (
    <div className='space-y-4'>
      {periods.fields.map((period, index) => (
        <fieldset key={period.id} className='rounded-lg border p-4'>
          <legend className='px-1 text-sm font-medium'>
            {t('Daily period {{number}}', { number: index + 1 })}
          </legend>
          <div className='grid items-start gap-4 sm:grid-cols-[1fr_1fr_1fr_auto]'>
            {(['start', 'end', 'ratio'] as const).map((key) => {
              let label = t('Discounted multiplier')
              if (key === 'start') label = t('Daily start time')
              if (key === 'end') label = t('Daily end time')
              return (
                <FormField
                  key={key}
                  control={form.control}
                  name={`groups.${props.index}.promotion.daily_periods.${index}.${key}`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{label}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type={key === 'ratio' ? 'number' : 'time'}
                          step={key === 'ratio' ? 'any' : 60}
                          min={key === 'ratio' ? '0.00000001' : undefined}
                          value={
                            typeof field.value === 'number' &&
                            Number.isNaN(field.value)
                              ? ''
                              : field.value
                          }
                          onChange={(event) =>
                            field.onChange(
                              key === 'ratio'
                                ? event.target.valueAsNumber
                                : event.target.value
                            )
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
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='sm:mt-6'
              aria-label={t('Remove daily period {{number}}', {
                number: index + 1,
              })}
              disabled={props.disabled || periods.fields.length === 1}
              onClick={() => periods.remove(index)}
            >
              <Trash2 aria-hidden='true' />
            </Button>
          </div>
        </fieldset>
      ))}
      <Button
        type='button'
        variant='outline'
        disabled={props.disabled || periods.fields.length >= 48}
        onClick={() =>
          periods.append({
            start: '',
            end: '',
            ratio: (props.baseRatio ?? 1) * 0.8,
          })
        }
      >
        <Plus aria-hidden='true' />
        {t('Add daily period')}
      </Button>
      {props.baseRatio !== undefined && (
        <p className='text-muted-foreground text-xs'>
          {t('Multiplier outside daily periods')}:{' '}
          <span className='font-mono'>
            ×{formatter.format(props.baseRatio)}
          </span>
        </p>
      )}
    </div>
  )
}
