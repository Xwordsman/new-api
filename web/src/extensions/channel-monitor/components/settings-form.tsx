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
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { LobeIconField } from '@/components/lobe-icon-field'
import { MultiSelect } from '@/components/multi-select'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
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
import { Switch } from '@/components/ui/switch'
import { toIntlLocale } from '@/i18n/languages'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { saveMonitorSettings } from '../api'
import { monitorSettingsSchema } from '../lib/schema'
import type { MonitorSettings, MonitorSettingsResponse } from '../types'

export function MonitorSettingsForm(props: { data: MonitorSettingsResponse }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [expandedGroups, setExpandedGroups] = useState<string[]>([])
  const form = useForm<MonitorSettings>({
    resolver: zodResolver(monitorSettingsSchema),
    defaultValues: props.data.settings,
  })
  const groups = form.watch('groups')
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 8 })
  const available = new Map(
    props.data.available_groups.map((group) => [group.group, group.ratio])
  )
  const options = [
    ...new Set([
      ...available.keys(),
      ...props.data.settings.groups.map((group) => group.group),
    ]),
  ].map((group) => {
    const ratio = available.get(group)
    return {
      label: group,
      value: group,
      hint:
        ratio === undefined
          ? t('Group no longer configured')
          : `×${formatter.format(ratio)}`,
    }
  })
  const save = useMutation({
    mutationFn: saveMonitorSettings,
    onSuccess: async (settings) => {
      form.reset(settings)
      queryClient.setQueryData<MonitorSettingsResponse>(
        ['channel-monitor', 'settings'],
        (current) => current && { ...current, settings }
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['channel-monitor'] }),
        queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY }),
      ])
      toast.success(t('Channel monitor settings saved'))
    },
  })
  return (
    <Form {...form}>
      <form
        noValidate
        className='space-y-6'
        onSubmit={form.handleSubmit(
          (values) => save.mutate(values),
          (errors) => {
            const invalidGroups = groups
              .filter((_, index) => errors.groups?.[index])
              .map((group) => group.group)
            setExpandedGroups((current) => [
              ...new Set([...current, ...invalidGroups]),
            ])
          }
        )}
      >
        <div className='console-surface bg-card space-y-6 rounded-xl border p-5 sm:p-6'>
          <div className='flex items-start justify-between gap-4'>
            <div>
              <h3 className='font-semibold'>{t('Published groups')}</h3>
              <p className='text-muted-foreground mt-2 text-sm leading-6'>
                {t(
                  'Publish up to 24 groups. Users only see groups their account can use. Display order follows Group pricing.'
                )}
              </p>
            </div>
            <Button
              type='submit'
              disabled={save.isPending || !form.formState.isDirty}
            >
              <Save aria-hidden />
              {t('Save')}
            </Button>
          </div>
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <FormItem className='flex items-center justify-between gap-4 rounded-lg border p-4'>
                <FormLabel>{t('Enable channel monitor')}</FormLabel>
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
          <FormField
            control={form.control}
            name='groups'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Groups to display')}</FormLabel>
                <FormControl>
                  <MultiSelect
                    aria-label={t('Groups to display')}
                    options={options}
                    selected={field.value.map((group) => group.group)}
                    onChange={(selected) =>
                      field.onChange(
                        selected.map(
                          (name) =>
                            groups.find((group) => group.group === name) ?? {
                              group: name,
                              display_name: '',
                              description: '',
                              badge: '',
                              icon: '',
                              promotion: null,
                            }
                        )
                      )
                    }
                    allowCreate={false}
                    disabled={save.isPending}
                    placeholder={t('Select groups')}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Only these groups and their aggregate model statistics are published. Channel identities and request details remain private.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <Alert>
            <AlertDescription>
              {t(
                'Manage public discounts in Group pricing. Removing a monitor group does not remove its discount.'
              )}
            </AlertDescription>
          </Alert>
        </div>
        <Accordion
          multiple
          keepMounted
          value={expandedGroups}
          onValueChange={setExpandedGroups}
          className='gap-3'
        >
          {groups.map((group, index) => {
            const ratio = available.get(group.group)
            return (
              <AccordionItem
                key={group.group}
                value={group.group}
                data-console-tone='info'
                className='console-surface bg-card overflow-hidden rounded-xl border'
              >
                <AccordionTrigger
                  aria-label={group.group}
                  className='items-center gap-4 rounded-xl px-5 py-4 hover:no-underline sm:px-6'
                >
                  <span className='flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1.5'>
                    <span className='min-w-0 font-mono font-semibold break-all'>
                      {group.group}
                    </span>
                    <span className='text-muted-foreground text-sm font-normal'>
                      {t('Current base multiplier')}:{' '}
                      {ratio === undefined
                        ? t('Group no longer configured')
                        : `×${formatter.format(ratio)}`}
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className='space-y-5 border-t p-5 sm:p-6'>
                  <div className='grid gap-5 sm:grid-cols-2'>
                    {(
                      [
                        {
                          key: 'display_name',
                          label: t('Display name'),
                          max: 80,
                        },
                        { key: 'badge', label: t('Group badge'), max: 24 },
                        {
                          key: 'description',
                          label: t('Description'),
                          max: 240,
                        },
                      ] as const
                    ).map((item) => (
                      <FormField
                        key={item.key}
                        control={form.control}
                        name={`groups.${index}.${item.key}`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{item.label}</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                maxLength={item.max}
                                disabled={save.isPending}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
                  <FormField
                    control={form.control}
                    name={`groups.${index}.icon`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor={`monitor-icon-${index}`}>
                          {t('Group icon')}
                        </FormLabel>
                        <fieldset disabled={save.isPending} className='min-w-0'>
                          <LobeIconField
                            id={`monitor-icon-${index}`}
                            value={field.value ?? ''}
                            onChange={field.onChange}
                          />
                        </fieldset>
                        <FormDescription>
                          {t(
                            'Choose a vendor or model icon for this group. Leave empty to detect it from enabled models; mixed or unknown providers use the default group icon.'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      </form>
    </Form>
  )
}
