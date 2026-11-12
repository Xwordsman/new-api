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

import { leaderboardQueryKey, saveLeaderboardSettings } from '../api'
import {
  leaderboardSettingsSchema,
  settingsToForm,
  splitList,
  type SettingsFormValues,
} from '../lib/schema'
import type { LeaderboardSettings } from '../types'

export function LeaderboardSettingsForm(props: {
  settings: LeaderboardSettings
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [expanded, setExpanded] = useState<string[]>([])
  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(leaderboardSettingsSchema),
    defaultValues: settingsToForm(props.settings),
  })
  const revision = form.watch('revision')
  const save = useMutation({
    mutationFn: saveLeaderboardSettings,
    onSuccess: async (settings) => {
      form.reset(settingsToForm(settings))
      await Promise.all([
        client.invalidateQueries({ queryKey: leaderboardQueryKey }),
        client.invalidateQueries({ queryKey: STATUS_QUERY_KEY }),
      ])
      toast.success(t('Leaderboard settings saved'))
    },
  })
  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit(
          (values) => {
            const {
              excluded_users,
              model_prefixes_text,
              safety_codes_text,
              ...settings
            } = values
            save.mutate({
              ...settings,
              excluded_user_ids: splitList(excluded_users).map(Number),
              model_prefixes: splitList(model_prefixes_text),
              safety_codes: splitList(safety_codes_text),
            })
          },
          () => setExpanded(['advanced'])
        )}
      >
        <fieldset
          disabled={save.isPending}
          className='space-y-6 disabled:opacity-70'
        >
          {props.settings.revision > revision && (
            <Alert>
              <AlertDescription className='flex flex-wrap items-center justify-between gap-3'>
                <span>
                  {t('Leaderboard settings changed. Reload before saving.')}
                </span>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => form.reset(settingsToForm(props.settings))}
                >
                  {t('Reload saved settings')}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <div className='console-surface bg-card space-y-5 rounded-xl border p-5 sm:p-6'>
            <div className='flex items-center justify-between gap-3'>
              <h3 className='font-semibold'>{t('Leaderboard settings')}</h3>
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
                <FormItem className='flex items-center justify-between gap-4'>
                  <div>
                    <FormLabel>{t('Enable leaderboard')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Disabling stops publication and new savings and warning collection.'
                      )}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <div className='grid gap-5 sm:grid-cols-2'>
              {(
                [
                  [
                    'interval_minutes',
                    t('Refresh interval (minutes)'),
                    1,
                    1440,
                  ],
                  ['top_n', t('Entries per leaderboard'), 4, 50],
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
                          step={1}
                          min={min}
                          max={max}
                          onChange={(event) =>
                            field.onChange(event.target.valueAsNumber)
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>
            <div className='grid gap-5 sm:grid-cols-2'>
              {(
                [
                  ['invitations', t('Invitation leaders')],
                  ['income', t('Referral earnings')],
                  ['tokens', t('Token consumption')],
                  ['savings', t('VIP savings')],
                  ['cyber', t('Cyber warnings')],
                ] as const
              ).map(([key, label]) => (
                <FormField
                  key={key}
                  control={form.control}
                  name={key}
                  render={({ field }) => (
                    <FormItem className='flex items-center justify-between gap-4 rounded-lg border p-4'>
                      <FormLabel>{label}</FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              ))}
            </div>
          </div>
          <Accordion
            multiple
            keepMounted
            value={expanded}
            onValueChange={setExpanded}
          >
            <AccordionItem
              value='advanced'
              data-console-tone='info'
              className='console-surface bg-card rounded-xl border'
            >
              <AccordionTrigger className='px-5 py-4'>
                {t('Privacy and counting rules')}
              </AccordionTrigger>
              <AccordionContent className='space-y-6 border-t p-5 sm:p-6'>
                {(
                  [
                    [
                      'mask_names',
                      t('Mask participant names'),
                      t(
                        'Other participants appear with masked names. Your own entry remains recognizable.'
                      ),
                    ],
                    [
                      'exclude_admins',
                      t('Exclude administrators'),
                      t(
                        'Administrator and root accounts are excluded from all rankings.'
                      ),
                    ],
                    [
                      'invitation_paid_only',
                      t('Count paid invitations only'),
                      t(
                        'An invitee must have a qualifying, non-refunded paid order to count.'
                      ),
                    ],
                  ] as const
                ).map(([key, label, description]) => (
                  <FormField
                    key={key}
                    control={form.control}
                    name={key}
                    render={({ field }) => (
                      <FormItem className='flex items-center justify-between gap-4'>
                        <div>
                          <FormLabel>{label}</FormLabel>
                          <FormDescription>{description}</FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                ))}
                <FormField
                  control={form.control}
                  name='excluded_users'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Excluded user IDs')}</FormLabel>
                      <FormControl>
                        <Textarea {...field} placeholder='12, 34, 56' />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Separate entries with commas or new lines. Up to 500 positive user IDs.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='warning_retention_days'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Warning retention (days)')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          min={1}
                          max={3650}
                          onChange={(event) =>
                            field.onChange(event.target.valueAsNumber)
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Expired warnings are deleted during refresh. The all-time warning board covers retained records only.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className='grid gap-5 sm:grid-cols-2'>
                  <FormField
                    control={form.control}
                    name='model_prefixes_text'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t('Safety warning model prefixes')}
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            className='min-h-36 font-mono text-xs'
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'Case-insensitive prefixes, separated by commas or new lines. Wildcards are not supported.'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='safety_codes_text'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t('Upstream safety error codes')}
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            className='min-h-36 font-mono text-xs'
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'Exact upstream error code or type matches only. Local permission errors and message keywords are not counted.'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </fieldset>
      </form>
    </Form>
  )
}
