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
import { Form } from '@/components/ui/form'

import { concurrencySettingsKey, saveSettings } from '../api'
import { concurrencySchema, type SettingsFormValues } from '../lib/schema'
import type { ConcurrencySettings } from '../types'
import { RulesEditor } from './rules-editor'
import { SettingField } from './setting-field'

export function ConcurrencySettingsForm(props: {
  settings: ConcurrencySettings
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [expanded, setExpanded] = useState<string[]>([])
  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(concurrencySchema, {
      error: () => 'Check this value and the permitted limits',
    }),
    defaultValues: props.settings,
  })
  const revision = form.watch('revision')
  const save = useMutation({
    mutationFn: saveSettings,
    onSuccess: async (settings) => {
      form.reset(settings)
      await client.invalidateQueries({ queryKey: concurrencySettingsKey })
      toast.success(t('Concurrency settings saved'))
    },
  })
  const sections = [
    { id: 'groups', title: t('Account group overrides') },
    { id: 'users', title: t('User overrides') },
    { id: 'channels', title: t('Channel overrides') },
  ] as const
  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit(
          (values) => save.mutate(values),
          () => setExpanded(['groups', 'users', 'channels'])
        )}
      >
        <fieldset
          disabled={save.isPending}
          className='space-y-5 disabled:opacity-70'
        >
          <div className='console-surface bg-card space-y-5 rounded-xl border p-5'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <h2 className='font-semibold'>{t('Concurrency management')}</h2>
              <Button
                type='submit'
                disabled={save.isPending || !form.formState.isDirty}
              >
                {t('Save')}
              </Button>
            </div>
            <SettingField
              name='enabled'
              kind='toggle'
              label={t('Enable concurrency management')}
            />
            <p className='text-muted-foreground text-sm'>
              {t(
                'All API keys of an account share its limit. User overrides take priority over account group rules, then defaults. Zero means unlimited.'
              )}
            </p>
            {props.settings.revision > revision && (
              <Alert>
                <AlertDescription className='flex flex-wrap items-center justify-between gap-3'>
                  <span>
                    {t('Concurrency settings changed. Reload before saving.')}
                  </span>
                  <Button
                    type='button'
                    variant='outline'
                    onClick={() => form.reset(props.settings)}
                  >
                    {t('Reload saved settings')}
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
              <SettingField
                name='default_user_limit'
                label={t('Default account concurrency')}
              />
              <SettingField
                name='default_channel_limit'
                label={t('Default channel concurrency')}
              />
              <SettingField
                name='default_key_limit'
                label={t('Default per-credential concurrency')}
                description={t(
                  'Applies to each enabled credential in multi-key channels. Single-key channels use the channel limit.'
                )}
              />
              <SettingField
                name='queue_timeout_ms'
                label={t('Maximum queue wait (milliseconds)')}
                max={30000}
              />
              <SettingField
                name='max_queued_per_user'
                label={t('Maximum queued requests per account')}
                max={100}
                description={t(
                  'Set both queue limits to zero to reject immediately, or both above zero to enable waiting.'
                )}
              />
              <SettingField
                name='lease_seconds'
                label={t('Capacity lease (seconds)')}
                max={600}
                description={t(
                  '30–600 seconds. Active requests renew their leases; expired leases recover capacity after a crash.'
                )}
              />
            </div>
            <Alert>
              <AlertDescription>
                {t(
                  'Streaming requests hold capacity until they finish. Responses WebSocket counts each generation, not idle connections. Async tasks count only their HTTP submission. Saved changes apply to new requests.'
                )}
              </AlertDescription>
            </Alert>
          </div>
          <Accordion
            multiple
            keepMounted
            value={expanded}
            onValueChange={setExpanded}
            className='gap-4'
          >
            {sections.map((section) => (
              <AccordionItem
                key={section.id}
                value={section.id}
                className='console-surface bg-card rounded-xl border'
              >
                <AccordionTrigger className='p-5'>
                  {section.title}
                </AccordionTrigger>
                <AccordionContent className='space-y-4 border-t p-5'>
                  <p className='text-muted-foreground text-sm'>
                    {section.id === 'groups'
                      ? t(
                          'Use the account group from user management, not the API key routing group.'
                        )
                      : t(
                          'Enter the ID from user or channel management. Each scope supports up to 200 unique rules.'
                        )}
                  </p>
                  <RulesEditor scope={section.id} />
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </fieldset>
      </form>
    </Form>
  )
}
