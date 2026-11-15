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
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { useFormContext } from 'react-hook-form'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import type { RedemptionStoreSettings } from '../types'

export function StoreEditor(props: {
  index: number
  total: number
  onMove: (from: number, to: number) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const form = useFormContext<RedemptionStoreSettings>()
  return (
    <fieldset className='bg-card space-y-4 rounded-lg border p-4'>
      <legend className='px-2 text-sm font-medium'>
        {t('Store {{number}}', { number: props.index + 1 })}
      </legend>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <FormField
          control={form.control}
          name={`stores.${props.index}.enabled`}
          render={({ field }) => (
            <FormItem className='flex items-center gap-3'>
              <FormLabel>{t('Show this store')}</FormLabel>
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
        <div className='flex gap-1'>
          <Button
            type='button'
            variant='outline'
            size='icon'
            aria-label={t('Move store up')}
            disabled={props.index === 0}
            onClick={() => props.onMove(props.index, props.index - 1)}
          >
            <ArrowUp aria-hidden='true' />
          </Button>
          <Button
            type='button'
            variant='outline'
            size='icon'
            aria-label={t('Move store down')}
            disabled={props.index === props.total - 1}
            onClick={() => props.onMove(props.index, props.index + 1)}
          >
            <ArrowDown aria-hidden='true' />
          </Button>
          <Button
            type='button'
            variant='outline'
            size='icon'
            aria-label={t('Remove store')}
            onClick={props.onRemove}
          >
            <Trash2 aria-hidden='true' />
          </Button>
        </div>
      </div>
      <div className='grid gap-4 md:grid-cols-2'>
        <FormField
          control={form.control}
          name={`stores.${props.index}.name`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Store name')}</FormLabel>
              <FormControl>
                <Input {...field} maxLength={80} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name={`stores.${props.index}.url`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Store URL')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type='url'
                  maxLength={2048}
                  placeholder='https://'
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={form.control}
        name={`stores.${props.index}.description`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('Store description (optional)')}</FormLabel>
            <FormControl>
              <Textarea {...field} maxLength={300} rows={2} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </fieldset>
  )
}
