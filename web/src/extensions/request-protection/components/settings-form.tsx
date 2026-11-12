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
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'

import { checkAlerts, saveSettings } from '../api'
import {
  protectionSchema,
  toForm,
  toSettings,
  type ProtectionForm,
} from '../lib/schema'
import type { ProtectionSettings } from '../types'
import { DryRunPanel } from './dry-run-panel'
import { PenaltyControls, PolicyControls } from './policy-controls'
import { RulesEditor } from './rules-editor'

export function ProtectionSettingsForm(props: {
  settings: ProtectionSettings
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const form = useForm<ProtectionForm>({
    resolver: zodResolver(protectionSchema, {
      error: () => 'Check this value and the permitted limits',
    }),
    defaultValues: toForm(props.settings),
    shouldFocusError: false,
  })
  const revision = useWatch({ control: form.control, name: 'revision' })
  const save = useMutation({
    mutationFn: (value: ProtectionForm) => saveSettings(toSettings(value)),
    onSuccess: async (settings) => {
      form.reset(toForm(settings))
      client.setQueryData(['request-protection', 'settings'], settings)
      await client.invalidateQueries({ queryKey: ['request-protection'] })
      toast.success(t('Request protection settings saved'))
    },
    onSettled: async (_data, error) => {
      if (error) {
        await client.invalidateQueries({
          queryKey: ['request-protection', 'settings'],
        })
      }
    },
  })
  const alerts = useMutation({
    mutationFn: checkAlerts,
    onSuccess: () => toast.success(t('Alert check queued')),
  })
  return (
    <Form {...form}>
      <div className='space-y-6'>
        <form
          className='console-surface bg-card space-y-6 rounded-xl border p-5 sm:p-6'
          onSubmit={form.handleSubmit((value) => save.mutate(value))}
          noValidate
        >
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <h3 className='font-semibold'>{t('Protection policy')}</h3>
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
                'Start in observation mode and review matches before enforcing. The plugin stores rule hits and keyed content fingerprints, never full prompts or API credentials.'
              )}
            </AlertDescription>
          </Alert>
          {props.settings.revision > revision && (
            <Alert>
              <AlertDescription className='flex flex-wrap items-center justify-between gap-3'>
                <span>
                  {t('Request protection changed. Reload and try again.')}
                </span>
                <Button
                  type='button'
                  variant='outline'
                  disabled={save.isPending}
                  onClick={() => form.reset(toForm(props.settings))}
                >
                  {t('Reload saved settings')}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <PolicyControls disabled={save.isPending} />
          <RulesEditor disabled={save.isPending} />
          {form.formState.isSubmitted && !form.formState.isValid && (
            <p role='alert' className='text-destructive text-sm'>
              {t(
                'Check the policy fields and expand rules to resolve validation errors.'
              )}
            </p>
          )}
          <PenaltyControls disabled={save.isPending} />
          <p className='text-muted-foreground text-sm'>
            {t(
              'Disabling protection or using observation mode bypasses plugin restrictions. Releasing a restriction never enables a disabled, expired or exhausted Key or account.'
            )}
          </p>
          <div className='flex flex-wrap justify-end gap-3'>
            <Button
              type='button'
              variant='outline'
              disabled={alerts.isPending || save.isPending}
              onClick={() => alerts.mutate()}
            >
              {t('Check alert queue')}
            </Button>
            <Button
              type='submit'
              disabled={save.isPending || !form.formState.isDirty}
            >
              {t('Save')}
            </Button>
          </div>
        </form>
        <DryRunPanel disabled={save.isPending} />
      </div>
    </Form>
  )
}
