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
import { useFormContext, type FieldPath } from 'react-hook-form'

import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import type { SettingsFormValues } from '../lib/schema'

export function SettingField(props: {
  name: FieldPath<SettingsFormValues>
  label: string
  kind?: 'number' | 'text' | 'list' | 'toggle'
  description?: string
  options?: readonly (readonly [string, string])[]
}) {
  const form = useFormContext<SettingsFormValues>()
  return (
    <FormField
      control={form.control}
      name={props.name}
      render={({ field }) => {
        let input = <Input {...field} value={String(field.value ?? '')} />
        if (props.options) {
          input = (
            <NativeSelect
              {...field}
              value={String(field.value)}
              className='w-full'
            >
              {props.options.map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )
        } else if (props.kind === 'toggle') {
          input = (
            <Switch
              name={field.name}
              ref={field.ref}
              onBlur={field.onBlur}
              checked={!!field.value}
              onCheckedChange={field.onChange}
            />
          )
        } else if (props.kind === 'number') {
          input = (
            <Input
              {...field}
              type='number'
              step={1}
              value={Number.isNaN(field.value) ? '' : (field.value as number)}
              onChange={(event) => field.onChange(event.target.valueAsNumber)}
            />
          )
        } else if (props.kind === 'list') {
          input = (
            <Textarea
              {...field}
              value={String(field.value ?? '')}
              className='min-h-24'
            />
          )
        }
        return (
          <FormItem
            className={
              props.kind === 'toggle'
                ? 'flex items-center justify-between gap-4 rounded-lg border p-4'
                : undefined
            }
          >
            <div>
              <FormLabel>{props.label}</FormLabel>
              {props.description && (
                <FormDescription>{props.description}</FormDescription>
              )}
            </div>
            <FormControl>{input}</FormControl>
            <FormMessage />
          </FormItem>
        )
      }}
    />
  )
}
