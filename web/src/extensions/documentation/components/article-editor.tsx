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
import { useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { CodeBlockEditor } from '@/components/ai-elements/code-block'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useSystemConfig } from '@/hooks/use-system-config'

import type { DocumentationFormValues } from '../lib/schema'
import { ArticleMarkdown } from './article-markdown'

export function ArticleEditor(props: { index: number }) {
  const { t } = useTranslation()
  const form = useFormContext<DocumentationFormValues>()
  const article = useWatch({
    control: form.control,
    name: `articles.${props.index}`,
  })
  const categories = useWatch({ control: form.control, name: 'categories' })
  const system = useSystemConfig()
  const errors = form.formState.errors.articles?.[props.index]
  const preview = article.content
    .replaceAll('{{site_name}}', system.systemName)
    .replaceAll('{{site_url}}', window.location.origin)
    .replaceAll('{{api_base_url}}', `${window.location.origin}/v1`)
  return (
    <div className='min-w-0 space-y-5'>
      <FieldGroup className='grid gap-4 sm:grid-cols-2'>
        <Field data-invalid={Boolean(errors?.title)}>
          <FieldLabel htmlFor='docs-article-title'>
            {t('Article title')}
          </FieldLabel>
          <Input
            id='docs-article-title'
            aria-invalid={Boolean(errors?.title)}
            {...form.register(`articles.${props.index}.title`)}
          />
          {errors?.title && (
            <FieldError>
              {t('A title is required and must be within the size limit.')}
            </FieldError>
          )}
        </Field>
        <Field data-invalid={Boolean(errors?.slug)}>
          <FieldLabel htmlFor='docs-article-slug'>
            {t('Article address')}
          </FieldLabel>
          <Input
            id='docs-article-slug'
            maxLength={100}
            aria-invalid={Boolean(errors?.slug)}
            {...form.register(`articles.${props.index}.slug`)}
          />
          <FieldDescription>/docs/guides/{article.slug}</FieldDescription>
          {errors?.slug && (
            <FieldError>
              {t(
                'Use a unique address with lowercase letters, numbers and hyphens.'
              )}
            </FieldError>
          )}
        </Field>
        <Field data-invalid={Boolean(errors?.category_id)}>
          <FieldLabel htmlFor='docs-article-category'>
            {t('Category')}
          </FieldLabel>
          <NativeSelect
            id='docs-article-category'
            className='w-full'
            aria-invalid={Boolean(errors?.category_id)}
            {...form.register(`articles.${props.index}.category_id`)}
          >
            {categories.map((category) => (
              <NativeSelectOption key={category.id} value={category.id}>
                {category.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {errors?.category_id && (
            <FieldError>{t('Select an existing category.')}</FieldError>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor='docs-article-status'>
            {t('Publication status')}
          </FieldLabel>
          <NativeSelect
            id='docs-article-status'
            className='w-full'
            {...form.register(`articles.${props.index}.status`)}
          >
            <NativeSelectOption value='draft'>{t('Draft')}</NativeSelectOption>
            <NativeSelectOption value='published'>
              {t('Published')}
            </NativeSelectOption>
          </NativeSelect>
          <FieldDescription>
            {t(
              'Drafts are only visible in this editor. Publishing takes effect after saving.'
            )}
          </FieldDescription>
        </Field>
        <Field
          className='sm:col-span-2'
          data-invalid={Boolean(errors?.description)}
        >
          <FieldLabel htmlFor='docs-article-description'>
            {t('Article description')}
          </FieldLabel>
          <Textarea
            id='docs-article-description'
            aria-invalid={Boolean(errors?.description)}
            rows={2}
            {...form.register(`articles.${props.index}.description`)}
          />
          {errors?.description && (
            <FieldError>
              {t('Descriptions must be at most 600 characters.')}
            </FieldError>
          )}
        </Field>
      </FieldGroup>
      <Alert>
        <AlertDescription>
          {t(
            'Site variables are replaced automatically when readers view the article.'
          )}
          <div className='mt-2 flex flex-wrap gap-2 font-mono text-xs'>
            <code>{'{{site_name}}'}</code>
            <code>{'{{site_url}}'}</code>
            <code>{'{{api_base_url}}'}</code>
          </div>
        </AlertDescription>
      </Alert>
      <Tabs defaultValue='edit'>
        <TabsList>
          <TabsTrigger value='edit'>{t('Markdown source')}</TabsTrigger>
          <TabsTrigger value='preview'>{t('Preview')}</TabsTrigger>
        </TabsList>
        <TabsContent value='edit' className='min-w-0 pt-3'>
          <CodeBlockEditor
            ariaLabel={t('Article Markdown content')}
            title={t('Article Markdown content')}
            language='markdown'
            autoFocus={false}
            rows={22}
            value={article.content}
            onChange={(value) =>
              form.setValue(`articles.${props.index}.content`, value, {
                shouldDirty: true,
                shouldValidate: Boolean(errors?.content),
              })
            }
          />
          {errors?.content && (
            <FieldError className='mt-2'>
              {t(
                'Keep each article within 128 KB and add content before publishing.'
              )}
            </FieldError>
          )}
        </TabsContent>
        <TabsContent
          value='preview'
          className='bg-background mt-3 min-h-80 rounded-lg border p-5'
        >
          <p className='text-muted-foreground mb-5 text-xs'>
            {t(
              'Preview uses this browser address. Published links use the configured server address.'
            )}
          </p>
          {article.content ? (
            <ArticleMarkdown
              content={preview}
              baseUrl={`${window.location.origin}/docs/guides/${article.slug}`}
            />
          ) : (
            <p className='text-muted-foreground py-10 text-center text-sm'>
              {t('Write some Markdown to preview the article.')}
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
