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
import { useWatch, type Control } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { SideDrawerSection } from '@/components/drawer-layout'
import {
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

import type { RedemptionFormValues } from '../lib/redemption-form'

export function RedemptionRechargeFields(props: {
  control: Control<RedemptionFormValues>
}) {
  const { t } = useTranslation()
  const sale =
    useWatch({ control: props.control, name: 'code_type' }) === 'sale'
  const typeOptions = [
    { value: 'gift', label: t('Gift code') },
    { value: 'sale', label: t('Sale recharge code') },
  ]
  const currencyOptions = [
    { value: 'CNY', label: 'CNY' },
    { value: 'USD', label: 'USD' },
  ]
  return (
    <SideDrawerSection>
      <FormField
        control={props.control}
        name='code_type'
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('Code purpose')}</FormLabel>
            <Select
              items={typeOptions}
              value={field.value}
              onValueChange={field.onChange}
            >
              <FormControl>
                <SelectTrigger className='w-full'>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {typeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormDescription>
              {t(
                'Gift codes only credit the wallet. Sale codes also count toward check-in and lucky draw recharge requirements.'
              )}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      {sale && (
        <>
          <FormField
            control={props.control}
            name='recharge_amount'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Qualifying sale amount')}</FormLabel>
                <FormControl>
                  <Input {...field} inputMode='decimal' maxLength={48} />
                </FormControl>
                <FormDescription>
                  {t(
                    'Enter the sale value per code, separately from wallet credit. This is an administrator-declared amount; external shop payments are not automatically verified.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={props.control}
            name='recharge_currency'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Sale currency')}</FormLabel>
                <Select
                  items={currencyOptions}
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger className='w-full'>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {currencyOptions.map((option) => (
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
          <FormField
            control={props.control}
            name='referral_enabled'
            render={({ field }) => (
              <FormItem>
                <div className='flex items-center justify-between gap-4'>
                  <FormLabel>{t('Allow referral commission')}</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </div>
                <FormDescription>
                  {t(
                    'When enabled, the sale amount follows referral rates, cooldowns, review rules and per-invitee caps. Disabled codes never generate commission.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </>
      )}
    </SideDrawerSection>
  )
}
