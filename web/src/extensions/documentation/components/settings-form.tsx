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
import { Link } from '@tanstack/react-router'
import { ExternalLink, RotateCcw, Save } from 'lucide-react'
import { useState } from 'react'
import { Controller, FormProvider, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { FormNavigationGuard } from '@/features/system-settings/components/form-navigation-guard'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import {
  documentationKey,
  documentationSettingsKey,
  saveDocumentationSettings,
} from '../api'
import {
  documentationSettingsSchema,
  type DocumentationFormValues,
} from '../lib/schema'
import type { DocumentationSettings } from '../types'
import { ArticleManager } from './article-manager'
import { CategoryManager } from './category-manager'

export function DocumentationSettingsForm(props: {
  settings: DocumentationSettings
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const form = useForm<DocumentationFormValues>({
    resolver: zodResolver(documentationSettingsSchema),
    defaultValues: props.settings,
  })
  const [discard, setDiscard] = useState(false)
  const revision = form.watch('revision')
  const conflict = props.settings.revision > revision
  const save = useMutation({
    mutationFn: saveDocumentationSettings,
    onSuccess: (settings) => {
      form.reset(settings)
      client.setQueryData(documentationSettingsKey, settings)
      void client.invalidateQueries({
        queryKey: documentationKey,
        predicate: (query) => query.queryKey[1] !== 'settings',
      })
      void client.invalidateQueries({ queryKey: STATUS_QUERY_KEY })
      toast.success(t('Documentation settings saved'))
    },
    onSettled: (_data, error) => {
      if (error) {
        void client.invalidateQueries({ queryKey: documentationSettingsKey })
      }
    },
  })
  return (
    <FormProvider {...form}>
      <FormNavigationGuard when={form.formState.isDirty} />
      <form
        noValidate
        className='space-y-5 pb-6'
        onSubmit={form.handleSubmit((settings) => save.mutate(settings))}
      >
        <div className='console-surface bg-card space-y-5 rounded-xl border p-5 sm:p-6'>
          <div className='flex flex-wrap items-start justify-between gap-4'>
            <div>
              <h2 className='font-semibold'>{t('Documentation publishing')}</h2>
              <p className='text-muted-foreground mt-1 text-sm'>
                {t(
                  'Manage a public knowledge base without changing the application source code.'
                )}
              </p>
            </div>
            <div className='flex flex-wrap gap-2'>
              <Button
                type='button'
                variant='outline'
                disabled={save.isPending || !form.formState.isDirty}
                onClick={() => setDiscard(true)}
              >
                <RotateCcw aria-hidden='true' />
                {t('Discard changes')}
              </Button>
              <Button
                type='submit'
                disabled={save.isPending || !form.formState.isDirty || conflict}
              >
                <Save aria-hidden='true' />
                {save.isPending ? t('Saving...') : t('Save Changes')}
              </Button>
            </div>
          </div>
          <Controller
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <Field
                orientation='horizontal'
                className='items-center justify-between rounded-lg border p-4'
              >
                <div className='space-y-1'>
                  <FieldLabel htmlFor='docs-enabled'>
                    {t('Enable documentation center')}
                  </FieldLabel>
                  <FieldDescription>
                    {t(
                      'When disabled, public pages and downloads are unavailable. Saved content is kept.'
                    )}
                  </FieldDescription>
                </div>
                <Switch
                  id='docs-enabled'
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={save.isPending}
                />
              </Field>
            )}
          />
          {conflict && (
            <Alert>
              <AlertDescription className='flex flex-wrap items-center justify-between gap-3'>
                <span>
                  {t(
                    'Documentation changed on the server. Reload saved settings before saving again.'
                  )}
                </span>
                <Button
                  type='button'
                  variant='outline'
                  disabled={save.isPending}
                  onClick={() => setDiscard(true)}
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
          {Object.keys(form.formState.errors).length > 0 && (
            <Alert variant='destructive'>
              <AlertDescription>
                {t(
                  form.formState.errors.articles?.message ??
                    form.formState.errors.categories?.message ??
                    'Check the title, article addresses, categories and article content before saving.'
                )}
              </AlertDescription>
            </Alert>
          )}
          <fieldset disabled={save.isPending} className='min-w-0'>
            <FieldGroup className='grid gap-4 md:grid-cols-2'>
              <Field data-invalid={Boolean(form.formState.errors.title)}>
                <FieldLabel htmlFor='docs-title'>
                  {t('Documentation title')}
                </FieldLabel>
                <Input
                  id='docs-title'
                  aria-invalid={Boolean(form.formState.errors.title)}
                  {...form.register('title')}
                />
                {form.formState.errors.title && (
                  <FieldError>
                    {t(
                      'A title is required and must be within the size limit.'
                    )}
                  </FieldError>
                )}
              </Field>
              <Field data-invalid={Boolean(form.formState.errors.description)}>
                <FieldLabel htmlFor='docs-description'>
                  {t('Documentation introduction')}
                </FieldLabel>
                <Textarea
                  id='docs-description'
                  aria-invalid={Boolean(form.formState.errors.description)}
                  rows={2}
                  {...form.register('description')}
                />
                {form.formState.errors.description && (
                  <FieldError>
                    {t('Descriptions must be at most 600 characters.')}
                  </FieldError>
                )}
              </Field>
            </FieldGroup>
          </fieldset>
          {props.settings.enabled && (
            <Button
              variant='outline'
              render={
                <Link to='/docs' target='_blank' rel='noopener noreferrer' />
              }
            >
              <ExternalLink aria-hidden='true' />
              {t('Open documentation center')}
            </Button>
          )}
        </div>
        <fieldset
          disabled={save.isPending}
          inert={save.isPending}
          className='min-w-0'
        >
          <Tabs defaultValue='articles'>
            <TabsList>
              <TabsTrigger value='articles'>{t('Articles')}</TabsTrigger>
              <TabsTrigger value='categories'>{t('Categories')}</TabsTrigger>
            </TabsList>
            <TabsContent value='articles' className='pt-3'>
              <ArticleManager />
            </TabsContent>
            <TabsContent value='categories' className='pt-3'>
              <CategoryManager />
            </TabsContent>
          </Tabs>
        </fieldset>
      </form>
      <ConfirmDialog
        open={discard}
        onOpenChange={setDiscard}
        title={t('Discard unsaved documentation changes?')}
        desc={t(
          'Your local edits will be replaced with the latest saved documentation.'
        )}
        destructive
        confirmText={t('Reload saved settings')}
        handleConfirm={() => {
          form.reset(props.settings)
          save.reset()
          setDiscard(false)
        }}
      />
    </FormProvider>
  )
}
