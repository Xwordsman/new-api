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
import { Plus, Save, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

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
import { Textarea } from '@/components/ui/textarea'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { saveBenchmarkSettings } from '../api'
import { benchmarkSettingsSchema } from '../lib/schema'
import type { BenchmarkSettings, SettingsResponse } from '../types'

export function BenchmarkSettingsForm(props: { data: SettingsResponse }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState<string[]>([])
  const form = useForm<BenchmarkSettings>({
    resolver: zodResolver(benchmarkSettingsSchema),
    defaultValues: props.data.settings,
  })
  const prompts = useFieldArray({ control: form.control, name: 'svg_prompts' })
  const groups = form.watch('groups')
  const save = useMutation({
    mutationFn: saveBenchmarkSettings,
    onSuccess: async (settings) => {
      form.reset(settings)
      queryClient.setQueryData<SettingsResponse>(
        ['benchmark', 'settings'],
        (current) => current && { ...current, settings }
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['benchmark'] }),
        queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY }),
      ])
      toast.success(t('Benchmark settings saved'))
    },
  })
  const options = [
    ...new Set([
      ...props.data.available_groups.map((g) => g.group),
      ...groups.map((g) => g.group),
    ]),
  ].map((group) => ({ label: group, value: group }))
  return (
    <Form {...form}>
      <form
        noValidate
        className='space-y-6'
        onSubmit={form.handleSubmit(
          (values) => save.mutate(values),
          () => setExpanded(groups.map((g) => g.group))
        )}
      >
        <fieldset
          disabled={save.isPending}
          className='space-y-6 disabled:opacity-70'
        >
          <div className='console-surface bg-card space-y-5 rounded-xl border p-5 sm:p-6'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <h3 className='font-semibold'>{t('Scheduled model checks')}</h3>
              <Button
                type='submit'
                disabled={save.isPending || !form.formState.isDirty}
              >
                <Save aria-hidden />
                {t('Save')}
              </Button>
            </div>
            <Alert>
              <AlertDescription>
                {t(
                  'Probes call upstream models at platform expense. Each enabled group runs one candy check and one rotating SVG prompt per interval. Visitors are not charged.'
                )}
              </AlertDescription>
            </Alert>
            <FormField
              control={form.control}
              name='enabled'
              render={({ field }) => (
                <FormItem className='flex items-center justify-between gap-4'>
                  <FormLabel>{t('Enable benchmark')}</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <div className='grid gap-5 sm:grid-cols-2 lg:grid-cols-3'>
              {(
                [
                  [
                    'interval_minutes',
                    t('Default interval (minutes)'),
                    5,
                    10080,
                  ],
                  ['timeout_seconds', t('Request timeout (seconds)'), 10, 600],
                  ['retention_days', t('History retention (days)'), 1, 90],
                  [
                    'candy_max_tokens',
                    t('Candy output token limit'),
                    16,
                    32768,
                  ],
                  ['svg_max_tokens', t('SVG output token limit'), 128, 32768],
                ] as const
              ).map(([key, label, min, max]) => (
                <FormField
                  key={key}
                  control={form.control}
                  name={key}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{label}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          min={min}
                          max={max}
                          step={1}
                          onChange={(e) =>
                            field.onChange(e.target.valueAsNumber)
                          }
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
              name='groups'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Benchmark groups')}</FormLabel>
                  <FormControl>
                    <MultiSelect
                      aria-label={t('Benchmark groups')}
                      options={options}
                      selected={field.value.map((g) => g.group)}
                      allowCreate={false}
                      placeholder={t('Select groups')}
                      onChange={(selected) =>
                        field.onChange(
                          selected.map(
                            (group) =>
                              groups.find((g) => g.group === group) ?? {
                                group,
                                model:
                                  props.data.available_groups
                                    .find((g) => g.group === group)
                                    ?.models.find((m) =>
                                      /gpt|codex/i.test(m)
                                    ) ?? '',
                                enabled: true,
                                interval_minutes: 0,
                                candy_enabled: true,
                                svg_enabled: true,
                              }
                          )
                        )
                      }
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Select groups, then choose the GPT model to sample in each group. Group access permissions still apply.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <Accordion
            multiple
            keepMounted
            value={expanded}
            onValueChange={setExpanded}
            className='gap-3'
          >
            {groups.map((group, index) => (
              <AccordionItem
                key={group.group}
                value={group.group}
                data-console-tone='info'
                className='console-surface bg-card rounded-xl border'
              >
                <AccordionTrigger
                  className='px-5 py-4'
                  aria-label={group.group}
                >
                  <span className='min-w-0 break-all'>{group.group}</span>
                </AccordionTrigger>
                <AccordionContent className='space-y-5 border-t p-5'>
                  <div className='grid gap-5 sm:grid-cols-2'>
                    <FormField
                      control={form.control}
                      name={`groups.${index}.model`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('Model')}</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder='gpt-4o' />
                          </FormControl>
                          <FormDescription>
                            {props.data.available_groups
                              .find((g) => g.group === group.group)
                              ?.models.join(' · ')}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`groups.${index}.interval_minutes`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('Group interval (minutes)')}</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type='number'
                              min={0}
                              max={10080}
                              onChange={(e) =>
                                field.onChange(e.target.valueAsNumber)
                              }
                            />
                          </FormControl>
                          <FormDescription>
                            {t(
                              'Use 0 to follow the default interval. Minimum custom interval: 5 minutes.'
                            )}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className='flex flex-wrap gap-6'>
                    {(
                      [
                        ['enabled', t('Enabled')],
                        ['candy_enabled', t('Candy logic')],
                        ['svg_enabled', t('SVG drawing')],
                      ] as const
                    ).map(([key, label]) => (
                      <FormField
                        key={key}
                        control={form.control}
                        name={`groups.${index}.${key}`}
                        render={({ field }) => (
                          <FormItem className='flex items-center gap-3'>
                            <FormLabel>{label}</FormLabel>
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
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          <div
            data-console-tone='warning'
            className='console-surface bg-card space-y-5 rounded-xl border p-5 sm:p-6'
          >
            <h3 className='font-semibold'>{t('Candy logic')}</h3>
            <FormField
              control={form.control}
              name='candy_prompt'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Candy question')}</FormLabel>
                  <FormControl>
                    <Textarea {...field} className='min-h-44' />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='candy_answer'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Expected answer')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Only outer whitespace is ignored. Explanations and reasoning are not accepted as the answer.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div
            data-console-tone='chart-4'
            className='console-surface bg-card space-y-5 rounded-xl border p-5 sm:p-6'
          >
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <h3 className='font-semibold'>{t('SVG prompt library')}</h3>
              <Button
                type='button'
                variant='outline'
                disabled={prompts.fields.length >= 24}
                onClick={() =>
                  prompts.append({ name: '', prompt: '', enabled: true })
                }
              >
                <Plus aria-hidden />
                {t('Add prompt')}
              </Button>
            </div>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Enabled prompts rotate in order for each group. SVG success checks structure, not artistic quality.'
              )}
            </p>
            {prompts.fields.map((prompt, index) => (
              <div key={prompt.id} className='space-y-4 rounded-lg border p-4'>
                <div className='flex items-start gap-3'>
                  <FormField
                    control={form.control}
                    name={`svg_prompts.${index}.name`}
                    render={({ field }) => (
                      <FormItem className='flex-1'>
                        <FormLabel>{t('Prompt name')}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='mt-6'
                    aria-label={t('Remove prompt')}
                    onClick={() => prompts.remove(index)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
                <FormField
                  control={form.control}
                  name={`svg_prompts.${index}.prompt`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('SVG prompt')}</FormLabel>
                      <FormControl>
                        <Textarea {...field} className='min-h-28' />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`svg_prompts.${index}.enabled`}
                  render={({ field }) => (
                    <FormItem className='flex items-center gap-3'>
                      <FormLabel>{t('Enabled')}</FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            ))}
            {(form.formState.errors.svg_prompts?.root ||
              form.formState.errors.svg_prompts?.message) && (
              <p
                role='alert'
                aria-label={t('SVG prompt library')}
                className='text-destructive text-sm'
              >
                {t('Invalid benchmark settings')}
              </p>
            )}
          </div>
        </fieldset>
      </form>
    </Form>
  )
}
