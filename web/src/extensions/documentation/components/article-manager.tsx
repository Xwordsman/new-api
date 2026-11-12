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
import { ArrowDown, ArrowUp, FilePlus2, FileText, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { cn } from '@/lib/utils'

import type { DocumentationFormValues } from '../lib/schema'
import { ArticleEditor } from './article-editor'

export function ArticleManager() {
  const { t } = useTranslation()
  const form = useFormContext<DocumentationFormValues>()
  const articles = useFieldArray({
    control: form.control,
    name: 'articles',
    keyName: 'formId',
  })
  const values = useWatch({ control: form.control, name: 'articles' })
  const categories = useWatch({ control: form.control, name: 'categories' })
  const [selected, setSelected] = useState(values[0]?.id ?? '')
  const [search, setSearch] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const selectedIndex = values.findIndex((article) => article.id === selected)
  const selectedCategory = values[selectedIndex]?.category_id
  let previousIndex = -1
  for (let index = selectedIndex - 1; index >= 0; index -= 1) {
    if (values[index].category_id === selectedCategory) {
      previousIndex = index
      break
    }
  }
  const nextIndex = values.findIndex(
    (article, index) =>
      index > selectedIndex && article.category_id === selectedCategory
  )
  const filtered = values.filter((article) =>
    `${article.title} ${article.slug}`
      .toLowerCase()
      .includes(search.toLowerCase())
  )
  return (
    <section
      aria-label={t('Documentation articles')}
      className='console-surface bg-card space-y-5 rounded-xl border p-5 sm:p-6'
    >
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h2 className='font-semibold'>{t('Documentation articles')}</h2>
          <p className='text-muted-foreground mt-1 text-sm'>
            {t('Edit guides, arrange their order, and publish when ready.')}
          </p>
        </div>
        <Button
          type='button'
          disabled={!categories.length || values.length >= 500}
          title={
            values.length >= 500
              ? t('Use no more than 500 articles.')
              : undefined
          }
          onClick={() => {
            const id = `article-${crypto.randomUUID().slice(0, 8)}`
            articles.append({
              id,
              category_id: categories[0].id,
              slug: `guide-${crypto.randomUUID().slice(0, 8)}`,
              title: t('Untitled article'),
              description: '',
              content: '',
              status: 'draft',
              sort_order: articles.fields.length,
              updated_at: 0,
            })
            setSelected(id)
            setSearch('')
          }}
        >
          <FilePlus2 aria-hidden='true' />
          {t('New article')}
        </Button>
      </div>
      {!values.length && (
        <EmptyState
          icon={FileText}
          title={t('No articles yet')}
          description={t('Add a category, then write your first guide.')}
          className='min-h-48'
        />
      )}
      {values.length > 0 && (
        <div className='grid min-w-0 gap-6 xl:grid-cols-[240px_minmax(0,1fr)]'>
          <div className='min-w-0 space-y-3'>
            <InputGroup>
              <InputGroupAddon>
                <FileText aria-hidden='true' className='size-4' />
              </InputGroupAddon>
              <InputGroupInput
                aria-label={t('Filter articles')}
                placeholder={t('Filter articles')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </InputGroup>
            <div className='max-h-[640px] space-y-1 overflow-y-auto pr-1'>
              {categories.map((category) => {
                const items = filtered.filter(
                  (article) => article.category_id === category.id
                )
                if (!items.length) return null
                return (
                  <div key={category.id} className='mb-4'>
                    <h3 className='text-muted-foreground px-2 py-2 text-xs font-medium'>
                      {category.title}
                    </h3>
                    {items.map((article) => (
                      <Button
                        key={article.id}
                        type='button'
                        variant='ghost'
                        onClick={() => setSelected(article.id)}
                        aria-pressed={selected === article.id}
                        className={cn(
                          'h-auto w-full min-w-0 justify-start gap-2 px-2 py-2.5 text-left text-xs whitespace-normal',
                          selected === article.id && 'bg-primary/8 text-primary'
                        )}
                      >
                        <span className='min-w-0 flex-1 break-words'>
                          {article.title}
                        </span>
                        {article.status === 'draft' && (
                          <Badge variant='outline' className='text-[10px]'>
                            {t('Draft')}
                          </Badge>
                        )}
                        {form.formState.errors.articles?.[
                          values.findIndex((item) => item.id === article.id)
                        ] && (
                          <span
                            className='text-destructive'
                            aria-label={t('Needs attention')}
                          >
                            !
                          </span>
                        )}
                      </Button>
                    ))}
                  </div>
                )
              })}
              {!filtered.length && (
                <p className='text-muted-foreground px-2 py-6 text-xs'>
                  {t('No matching articles')}
                </p>
              )}
            </div>
          </div>
          {selectedIndex >= 0 ? (
            <div className='min-w-0 space-y-4'>
              <div className='flex items-center justify-between gap-3 border-b pb-4'>
                <Badge
                  variant={
                    values[selectedIndex].status === 'published'
                      ? 'default'
                      : 'outline'
                  }
                >
                  {values[selectedIndex].status === 'published'
                    ? t('Published')
                    : t('Draft')}
                </Badge>
                <div className='flex gap-2'>
                  <Button
                    type='button'
                    size='icon-sm'
                    variant='outline'
                    disabled={previousIndex < 0}
                    aria-label={t('Move article up')}
                    onClick={() => {
                      articles.move(selectedIndex, previousIndex)
                      form.getValues('articles').forEach((_article, index) =>
                        form.setValue(`articles.${index}.sort_order`, index, {
                          shouldDirty: true,
                        })
                      )
                    }}
                  >
                    <ArrowUp aria-hidden='true' />
                  </Button>
                  <Button
                    type='button'
                    size='icon-sm'
                    variant='outline'
                    disabled={nextIndex < 0}
                    aria-label={t('Move article down')}
                    onClick={() => {
                      articles.move(selectedIndex, nextIndex)
                      form.getValues('articles').forEach((_article, index) =>
                        form.setValue(`articles.${index}.sort_order`, index, {
                          shouldDirty: true,
                        })
                      )
                    }}
                  >
                    <ArrowDown aria-hidden='true' />
                  </Button>
                  <Button
                    type='button'
                    size='sm'
                    variant='destructive'
                    onClick={() => setDeleting(selected)}
                  >
                    <Trash2 aria-hidden='true' />
                    {t('Delete article')}
                  </Button>
                </div>
              </div>
              <ArticleEditor key={selected} index={selectedIndex} />
            </div>
          ) : (
            <EmptyState
              title={t('Select an article to edit')}
              className='min-h-48'
            />
          )}
        </div>
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={t('Delete article')}
        desc={t(
          'This article will be removed from the documentation center after saving.'
        )}
        destructive
        confirmText={t('Delete')}
        handleConfirm={() => {
          const index = form
            .getValues('articles')
            .findIndex((article) => article.id === deleting)
          if (index >= 0) articles.remove(index)
          if (selected === deleting) {
            setSelected(form.getValues('articles')[0]?.id ?? '')
          }
          setDeleting(null)
        }}
      />
    </section>
  )
}
