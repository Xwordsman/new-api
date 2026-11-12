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
import { type FieldPath, useFormContext } from 'react-hook-form'

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

import type { SettingsFormValues } from '../lib/schema'

export function SettingField(props: {
  name: FieldPath<SettingsFormValues>
  label: string
  description?: string
  kind?: 'number' | 'text' | 'toggle'
  max?: number
}) {
  const form = useFormContext<SettingsFormValues>()
  return (
    <FormField
      control={form.control}
      name={props.name}
      render={({ field }) => (
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
          <FormControl>
            {props.kind === 'toggle' ? (
              <Switch
                name={field.name}
                ref={field.ref}
                onBlur={field.onBlur}
                checked={!!field.value}
                onCheckedChange={field.onChange}
              />
            ) : (
              <Input
                name={field.name}
                ref={field.ref}
                onBlur={field.onBlur}
                type={props.kind === 'text' ? 'text' : 'number'}
                min={0}
                max={props.max ?? 100000}
                step={1}
                value={
                  Number.isNaN(field.value) ? '' : String(field.value ?? '')
                }
                onChange={(event) =>
                  field.onChange(
                    props.kind === 'text'
                      ? event.target.value
                      : event.target.valueAsNumber
                  )
                }
              />
            )}
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
