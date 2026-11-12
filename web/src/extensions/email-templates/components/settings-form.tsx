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
import { RotateCcw, Save } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'

import { saveEmailTemplates } from '../api'
import {
  createFormValues,
  settingsFromForm,
  settingsSchema,
  templateKey,
  type EmailTemplateFormValues,
} from '../lib/schema'
import type { EmailTemplateConfiguration } from '../types'
import { TemplateEditor } from './template-editor'

const templateLanguages = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
] as const

export function EmailTemplateSettingsForm(props: {
  configuration: EmailTemplateConfiguration
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const form = useForm<EmailTemplateFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: createFormValues(props.configuration),
  })
  const [type, setType] = useState(props.configuration.catalog[0].type)
  const [language, setLanguage] = useState('zh-CN')
  const [restoreOpen, setRestoreOpen] = useState(false)
  const definition =
    props.configuration.catalog.find((item) => item.type === type) ??
    props.configuration.catalog[0]
  const key = templateKey({ type, language })
  const selected = form.watch(`templates.${key}`)
  const bundled = definition.defaults[language]
  const customized =
    selected.subject !== bundled.subject || selected.html !== bundled.html
  const revision = form.watch('revision')
  const enabled = form.watch('enabled')
  const save = useMutation({
    mutationFn: saveEmailTemplates,
    onSuccess: (settings) => {
      const configuration = { ...props.configuration, settings }
      form.reset(createFormValues(configuration))
      client.setQueryData(['email-templates', 'settings'], configuration)
      toast.success(t('Email templates saved'))
    },
    onSettled: (_data, error) => {
      if (error) {
        void client.invalidateQueries({
          queryKey: ['email-templates', 'settings'],
        })
      }
    },
  })

  return (
    <Form {...form}>
      <form
        className='space-y-5 pb-6'
        noValidate
        onSubmit={form.handleSubmit((values) =>
          save.mutate(settingsFromForm(values, props.configuration.catalog))
        )}
      >
        <div className='console-surface bg-card space-y-4 rounded-xl border p-5 sm:p-6'>
          <div className='flex flex-wrap items-start justify-between gap-4'>
            <div className='space-y-1.5'>
              <h2 className='font-semibold'>{t('Email appearance')}</h2>
              <p className='text-muted-foreground text-sm'>
                {t(
                  'Customize existing emails. Delivery still uses your current SMTP or Resend settings.'
                )}
              </p>
            </div>
            <Button
              type='submit'
              disabled={save.isPending || !form.formState.isDirty}
            >
              <Save aria-hidden='true' />
              {save.isPending ? t('Saving...') : t('Save Changes')}
            </Button>
          </div>
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <FormItem className='flex items-center justify-between gap-4 rounded-lg border p-4'>
                <div className='space-y-1'>
                  <FormLabel>{t('Enable email templates')}</FormLabel>
                  <p className='text-muted-foreground text-xs'>
                    {t(
                      'When disabled, emails use the original new-api formatting. Saved templates are kept.'
                    )}
                  </p>
                </div>
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
          {!enabled && (
            <p className='text-muted-foreground text-xs'>
              {t(
                'You can edit and preview while disabled. Enable and save to apply templates to outgoing emails.'
              )}
            </p>
          )}
          {props.configuration.settings.revision > revision && (
            <Alert>
              <AlertDescription className='flex flex-wrap items-center justify-between gap-3'>
                <span>
                  {t('Email templates changed. Reload before saving.')}
                </span>
                <Button
                  type='button'
                  variant='outline'
                  disabled={save.isPending}
                  onClick={() => {
                    form.reset(createFormValues(props.configuration))
                    save.reset()
                  }}
                >
                  {t('Reload saved settings')}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {save.isError && (
            <Alert variant='destructive'>
              <AlertDescription>
                {t(
                  'Saving failed. Your edits are kept. Reload saved settings if another administrator changed them.'
                )}
              </AlertDescription>
            </Alert>
          )}
          {form.formState.errors.templates && (
            <Alert variant='destructive'>
              <AlertDescription>
                {t(
                  'Check every edited template: a subject is required (up to 240 characters), and HTML must be between 1 byte and 48 KB.'
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>
        <fieldset
          disabled={save.isPending}
          className='console-surface bg-card min-w-0 space-y-5 rounded-xl border p-5 sm:p-6'
        >
          <div className='flex flex-wrap items-end gap-4 border-b pb-5'>
            <div className='w-full min-w-0 space-y-2 sm:min-w-64 sm:flex-1'>
              <Label htmlFor='email-template-type'>{t('Email type')}</Label>
              <NativeSelect
                id='email-template-type'
                className='w-full'
                value={type}
                onChange={(event) => setType(event.target.value)}
              >
                {props.configuration.catalog.map((item) => (
                  <NativeSelectOption key={item.type} value={item.type}>
                    {t(item.name)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className='min-w-40 flex-1 space-y-2 sm:max-w-56'>
              <Label htmlFor='email-template-language'>
                {t('Email language')}
              </Label>
              <NativeSelect
                id='email-template-language'
                className='w-full'
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                {templateLanguages.map((item) => (
                  <NativeSelectOption key={item.value} value={item.value}>
                    {item.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <Badge variant='secondary' className='mb-1.5'>
              {customized ? t('Customized') : t('Default template')}
            </Badge>
            <Button
              type='button'
              variant='outline'
              disabled={save.isPending || !customized}
              onClick={() => setRestoreOpen(true)}
            >
              <RotateCcw aria-hidden='true' />
              {t('Restore this template')}
            </Button>
          </div>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Email language follows the recipient preference or request language, then the server default. Other languages use English.'
            )}
          </p>
          <TemplateEditor
            key={key}
            template={selected}
            definition={definition}
            disabled={save.isPending}
            onChange={(template) =>
              form.setValue(
                `templates.${key}`,
                { ...selected, subject: template.subject, html: template.html },
                { shouldDirty: true }
              )
            }
          />
        </fieldset>
      </form>
      <ConfirmDialog
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        title={t('Restore this template?')}
        desc={t(
          'Restore the selected email type and language to the bundled design. Save Changes to apply it.'
        )}
        confirmText={t('Restore default')}
        handleConfirm={() => {
          form.setValue(
            `templates.${key}`,
            { ...selected, subject: bundled.subject, html: bundled.html },
            { shouldDirty: true }
          )
          setRestoreOpen(false)
        }}
      />
    </Form>
  )
}
