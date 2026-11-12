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
import { ArrowDown, ArrowUp, FolderPlus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

import type { DocumentationFormValues } from '../lib/schema'

export function CategoryManager() {
  const { t } = useTranslation()
  const form = useFormContext<DocumentationFormValues>()
  const categories = useFieldArray({
    control: form.control,
    name: 'categories',
    keyName: 'formId',
  })
  const articles = useWatch({ control: form.control, name: 'articles' })
  const [deleting, setDeleting] = useState<string | null>(null)
  return (
    <section
      aria-label={t('Documentation categories')}
      className='console-surface bg-card space-y-5 rounded-xl border p-5 sm:p-6'
    >
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h2 className='font-semibold'>{t('Documentation categories')}</h2>
          <p className='text-muted-foreground mt-1 text-sm'>
            {t(
              'Organize the reading navigation. Move articles before deleting a category.'
            )}
          </p>
        </div>
        <Button
          type='button'
          variant='outline'
          disabled={categories.fields.length >= 64}
          title={
            categories.fields.length >= 64
              ? t('Use no more than 64 categories.')
              : undefined
          }
          onClick={() =>
            categories.append({
              id: `category-${crypto.randomUUID().slice(0, 8)}`,
              title: t('New category'),
              description: '',
              sort_order: categories.fields.length,
            })
          }
        >
          <FolderPlus aria-hidden='true' />
          {t('Add category')}
        </Button>
      </div>
      {!categories.fields.length && (
        <EmptyState
          title={t('No categories yet')}
          description={t('Add a category before creating an article.')}
          className='min-h-36'
        />
      )}
      <div className='grid gap-4 xl:grid-cols-2'>
        {categories.fields.map((category, index) => {
          const inUse = articles.some(
            (article) => article.category_id === category.id
          )
          const errors = form.formState.errors.categories?.[index]
          return (
            <div
              key={category.formId}
              className='space-y-4 rounded-lg border p-4'
            >
              <div className='flex items-center justify-between gap-3'>
                <code className='text-muted-foreground min-w-0 truncate text-xs'>
                  {category.id}
                </code>
                <div className='flex gap-1'>
                  <Button
                    type='button'
                    size='icon-sm'
                    variant='ghost'
                    disabled={index === 0}
                    aria-label={t('Move category up')}
                    onClick={() => {
                      categories.move(index, index - 1)
                      form
                        .getValues('categories')
                        .forEach((_item, position) =>
                          form.setValue(
                            `categories.${position}.sort_order`,
                            position,
                            { shouldDirty: true }
                          )
                        )
                    }}
                  >
                    <ArrowUp aria-hidden='true' />
                  </Button>
                  <Button
                    type='button'
                    size='icon-sm'
                    variant='ghost'
                    disabled={index === categories.fields.length - 1}
                    aria-label={t('Move category down')}
                    onClick={() => {
                      categories.move(index, index + 1)
                      form
                        .getValues('categories')
                        .forEach((_item, position) =>
                          form.setValue(
                            `categories.${position}.sort_order`,
                            position,
                            { shouldDirty: true }
                          )
                        )
                    }}
                  >
                    <ArrowDown aria-hidden='true' />
                  </Button>
                  <Button
                    type='button'
                    size='icon-sm'
                    variant='destructive'
                    disabled={inUse}
                    aria-label={t('Delete category')}
                    title={
                      inUse
                        ? t('Move articles before deleting this category.')
                        : t('Delete category')
                    }
                    onClick={() => setDeleting(category.id)}
                  >
                    <Trash2 aria-hidden='true' />
                  </Button>
                </div>
              </div>
              <FieldGroup>
                <Field data-invalid={Boolean(errors?.title)}>
                  <FieldLabel htmlFor={`category-title-${category.id}`}>
                    {t('Category title')}
                  </FieldLabel>
                  <Input
                    id={`category-title-${category.id}`}
                    aria-invalid={Boolean(errors?.title)}
                    {...form.register(`categories.${index}.title`)}
                  />
                  {errors?.title && (
                    <FieldError>
                      {t(
                        'A title is required and must be within the size limit.'
                      )}
                    </FieldError>
                  )}
                </Field>
                <Field data-invalid={Boolean(errors?.description)}>
                  <FieldLabel htmlFor={`category-description-${category.id}`}>
                    {t('Category description')}
                  </FieldLabel>
                  <Textarea
                    id={`category-description-${category.id}`}
                    aria-invalid={Boolean(errors?.description)}
                    rows={2}
                    {...form.register(`categories.${index}.description`)}
                  />
                  {errors?.description && (
                    <FieldError>
                      {t('Descriptions must be at most 600 characters.')}
                    </FieldError>
                  )}
                </Field>
              </FieldGroup>
            </div>
          )
        })}
      </div>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={t('Delete category')}
        desc={t(
          'This removes the category from the documentation navigation after saving.'
        )}
        destructive
        confirmText={t('Delete')}
        handleConfirm={() => {
          const index = form
            .getValues('categories')
            .findIndex((item) => item.id === deleting)
          if (
            index >= 0 &&
            !form
              .getValues('articles')
              .some((article) => article.category_id === deleting)
          ) {
            categories.remove(index)
          }
          setDeleting(null)
        }}
      />
    </section>
  )
}
