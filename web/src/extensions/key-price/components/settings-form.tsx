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
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'

import { savePriceSettings } from '../api'
import { settingsSchema, type PriceSettings } from '../types'

export function PriceSettingsForm(props: { settings: PriceSettings }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const form = useForm<PriceSettings>({
    resolver: zodResolver(settingsSchema, {
      error: () => 'Check this value and the permitted limits',
    }),
    defaultValues: props.settings,
  })
  const revision = form.watch('revision')
  const save = useMutation({
    mutationFn: savePriceSettings,
    onSuccess: async (value) => {
      form.reset(value)
      client.setQueryData(['key-price', 'settings'], value)
      await client.invalidateQueries({ queryKey: ['key-price'] })
      toast.success(t('Price protection settings saved'))
    },
  })
  const switches = [
    { name: 'enabled', label: t('Enable Key price protection') },
    { name: 'default_protect', label: t('Protect new Keys by default') },
    {
      name: 'allow_opt_out',
      label: t('Allow users to turn off protection for their Keys'),
    },
  ] as const
  return (
    <Form {...form}>
      <form
        className='console-surface bg-card space-y-6 rounded-xl border p-5 sm:p-6'
        onSubmit={form.handleSubmit((value) => save.mutate(value))}
        noValidate
      >
        <div className='flex items-center justify-between gap-4'>
          <h3 className='font-semibold'>{t('Group multiplier protection')}</h3>
          <Button
            type='submit'
            disabled={save.isPending || !form.formState.isDirty}
          >
            {t('Save')}
          </Button>
        </div>
        <Alert>
          <AlertDescription>
            {t(
              'Checks run before each upstream attempt. Scheduled discount expiry, special group prices and Auto group retries use the actual billing multiplier. Running requests settle normally.'
            )}
          </AlertDescription>
        </Alert>
        {props.settings.revision > revision && (
          <Alert>
            <AlertDescription className='flex flex-wrap items-center justify-between gap-3'>
              <span>
                {t('Key price protection changed. Reload and confirm again.')}
              </span>
              <Button
                type='button'
                variant='outline'
                disabled={save.isPending}
                onClick={() => form.reset(props.settings)}
              >
                {t('Reload saved settings')}
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {switches.map((item) => (
          <FormField
            key={item.name}
            control={form.control}
            name={item.name}
            render={({ field }) => (
              <FormItem className='flex items-center justify-between gap-4 rounded-lg border p-4'>
                <FormLabel>{item.label}</FormLabel>
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
        ))}
        <p className='text-muted-foreground text-sm'>
          {t(
            'When opt-out is forbidden, protection is mandatory for tracked Keys regardless of their saved preference.'
          )}
        </p>
        <FormField
          control={form.control}
          name='legacy_mode'
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {t('Keys created before this plugin was installed')}
              </FormLabel>
              <FormControl>
                <NativeSelect
                  {...field}
                  disabled={save.isPending}
                  className='w-full'
                >
                  <NativeSelectOption value='ignore'>
                    {t('Keep working until the owner enables protection')}
                  </NativeSelectOption>
                  <NativeSelectOption value='confirm'>
                    {t('Require confirmation before the next request')}
                  </NativeSelectOption>
                </NativeSelect>
              </FormControl>
              <FormDescription>
                {t(
                  'Historical creation prices cannot be recovered. Requiring confirmation will block existing untracked Keys until their owners accept current multipliers.'
                )}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className='grid gap-6 sm:grid-cols-2'>
          <FormField
            control={form.control}
            name='increase_percent'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Allowed increase (%)')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={0}
                    max={100}
                    step='any'
                    {...field}
                    onChange={(event) =>
                      field.onChange(
                        event.target.value === ''
                          ? Number.NaN
                          : Number(event.target.value)
                      )
                    }
                    disabled={save.isPending}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Use 0 to pause on any increase. Compare against each accepted group multiplier.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='quote_ttl_seconds'
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t('Confirmation quote validity (seconds)')}
                </FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={60}
                    max={900}
                    step={1}
                    {...field}
                    onChange={(event) =>
                      field.onChange(
                        event.target.value === ''
                          ? Number.NaN
                          : Number(event.target.value)
                      )
                    }
                    disabled={save.isPending}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    '60–900 seconds. Expired quotes and quotes invalidated by price, routing or settings changes cannot be accepted.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Pauses remain until the owner confirms. Turning off this plugin bypasses only price protection and never enables disabled, expired or exhausted Keys.'
          )}
        </p>
      </form>
    </Form>
  )
}
