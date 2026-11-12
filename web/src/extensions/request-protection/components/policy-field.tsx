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
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import type { ProtectionForm } from '../lib/schema'

// Business fields share this form context while retaining the shared Form
// components' label, error, accessibility and translation behavior.
export function PolicyField(props: {
  name: FieldPath<ProtectionForm>
  label: string
  description?: string
  kind?: 'number' | 'switch' | 'lines'
  min?: number
  max?: number
  options?: { value: string; label: string }[]
  disabled?: boolean
}) {
  const form = useFormContext<ProtectionForm>()
  return (
    <FormField
      control={form.control}
      name={props.name}
      render={({ field }) => {
        let control = (
          <Input
            {...field}
            value={String(field.value ?? '')}
            disabled={props.disabled}
          />
        )
        if (props.kind === 'number') {
          control = (
            <Input
              {...field}
              type='number'
              min={props.min}
              max={props.max}
              step={1}
              value={Number.isNaN(field.value) ? '' : Number(field.value)}
              onChange={(event) =>
                field.onChange(
                  event.target.value === ''
                    ? Number.NaN
                    : Number(event.target.value)
                )
              }
              disabled={props.disabled}
            />
          )
        }
        if (props.kind === 'lines') {
          control = (
            <Textarea
              {...field}
              value={String(field.value ?? '')}
              rows={3}
              disabled={props.disabled}
            />
          )
        }
        if (props.kind === 'switch') {
          control = (
            <Switch
              name={field.name}
              ref={field.ref}
              onBlur={field.onBlur}
              checked={Boolean(field.value)}
              onCheckedChange={field.onChange}
              disabled={props.disabled}
            />
          )
        }
        if (props.options) {
          control = (
            <NativeSelect
              name={field.name}
              ref={field.ref}
              onBlur={field.onBlur}
              value={String(field.value)}
              onChange={field.onChange}
              disabled={props.disabled}
              className='w-full'
            >
              {props.options.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )
        }
        return (
          <FormItem
            className={
              props.kind === 'switch'
                ? 'flex flex-wrap items-center justify-between gap-x-4 rounded-lg border p-4'
                : ''
            }
          >
            <FormLabel>{props.label}</FormLabel>
            <FormControl>{control}</FormControl>
            {props.description && (
              <FormDescription className='w-full'>
                {props.description}
              </FormDescription>
            )}
            <FormMessage />
          </FormItem>
        )
      }}
    />
  )
}
