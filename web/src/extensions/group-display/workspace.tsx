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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, FolderPlus, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { ApiKeyGroupOptions } from '@/features/keys/components/api-key-group-combobox'

import { getGroupDisplay, saveGroupDisplay } from './api'
import { CategoryCard } from './category-card'
import { CategoryEditor } from './category-editor'
import { displaySettingsSchema } from './schema'
import {
  applyGroupAppearance,
  emptyAppearance,
  type GroupAppearance,
  type GroupCategory,
  type GroupDisplayOption,
  type GroupDisplaySettings,
} from './types'

export function GroupDisplayWorkspace(props: {
  options: GroupDisplayOption[]
}) {
  const query = useQuery({
    queryKey: ['group-display'],
    queryFn: getGroupDisplay,
    refetchOnWindowFocus: false,
  })
  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  return <DisplayEditor initial={query.data} options={props.options} />
}

function DisplayEditor(props: {
  initial: GroupDisplaySettings
  options: GroupDisplayOption[]
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const form = useForm<GroupDisplaySettings>({
    resolver: zodResolver(displaySettingsSchema),
    defaultValues: props.initial,
  })
  const draft = form.watch()
  const dirty = form.formState.isDirty
  useEffect(() => {
    if (!dirty) form.reset(props.initial)
  }, [props.initial, form, dirty])
  const [editing, setEditing] = useState<{ category?: GroupCategory } | null>(
    null
  )
  const [preview, setPreview] = useState(false)
  const [selected, setSelected] = useState(props.options[0]?.value ?? '')
  const [confirm, setConfirm] = useState<
    { type: 'reload' } | { type: 'remove'; category: GroupCategory } | null
  >(null)
  const [invalid, setInvalid] = useState(false)
  const save = useMutation({
    mutationFn: saveGroupDisplay,
    onSuccess: async (settings) => {
      form.reset(settings)
      setInvalid(false)
      client.setQueryData(['group-display'], settings)
      await client.invalidateQueries({ queryKey: ['user-groups'] })
      toast.success(t('Group appearance saved'))
    },
  })
  const reload = useMutation({
    mutationFn: getGroupDisplay,
    onSuccess: (settings) => {
      form.reset(settings)
      setInvalid(false)
      client.setQueryData(['group-display'], settings)
      setConfirm(null)
    },
  })
  const busy = save.isPending || reload.isPending
  const previewOptions = applyGroupAppearance(props.options, draft)
  const available = previewOptions.filter((option) => !option.category)
  const updateGroup = (group: string, appearance: GroupAppearance) => {
    form.setValue(
      'groups',
      { ...form.getValues('groups'), [group]: appearance },
      { shouldDirty: true }
    )
  }
  return (
    <section className='min-w-0 space-y-5'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='space-y-1'>
          <h2 className='font-semibold'>{t('API key group appearance')}</h2>
          <p className='text-muted-foreground max-w-2xl text-sm'>
            {t(
              'Create a category, add system groups, then expand a group to set tags and featured styling.'
            )}
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={busy || draft.categories.length >= 64}
            onClick={() => setEditing({})}
          >
            <Plus aria-hidden='true' className='size-4' />
            {t('Add category')}
          </Button>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => setPreview(true)}
          >
            <Eye aria-hidden='true' className='size-4' />
            {t('Preview')}
          </Button>
          <Button
            type='button'
            size='sm'
            disabled={busy}
            onClick={() =>
              void form.handleSubmit(
                async (settings) => {
                  await save.mutateAsync(settings).catch(() => {})
                },
                () => setInvalid(true)
              )()
            }
          >
            {save.isPending ? t('Saving...') : t('Save appearance')}
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='icon-sm'
            disabled={busy}
            aria-label={t('Reload saved appearance')}
            title={t('Reload saved appearance')}
            onClick={() => setConfirm({ type: 'reload' })}
          >
            <RotateCcw aria-hidden='true' className='size-4' />
          </Button>
        </div>
      </div>
      {dirty && (
        <p className='text-muted-foreground text-xs'>{t('Unsaved changes')}</p>
      )}
      {draft.categories.length === 0 && (
        <EmptyState
          icon={FolderPlus}
          title={t('Create your first category')}
          description={t(
            'Use categories to organize the groups shown when creating an API key.'
          )}
          className='min-h-48'
          bordered
        />
      )}
      <div className='space-y-4'>
        {draft.categories.map((category, index) => (
          <CategoryCard
            key={category.id}
            category={category}
            options={previewOptions
              .filter((option) => option.category?.id === category.id)
              .sort(
                (a, b) =>
                  (a.appearance?.sort_order ?? 0) -
                  (b.appearance?.sort_order ?? 0)
              )}
            available={available}
            disabled={busy}
            first={index === 0}
            last={index === draft.categories.length - 1}
            onEdit={() => setEditing({ category })}
            onRemove={() => setConfirm({ type: 'remove', category })}
            onMove={(offset) => {
              const categories = [...draft.categories]
              ;[categories[index], categories[index + offset]] = [
                categories[index + offset],
                categories[index],
              ]
              form.setValue('categories', categories, { shouldDirty: true })
            }}
            onAdd={(groups) => {
              const next = new Map(Object.entries(form.getValues('groups')))
              for (const group of groups) {
                if (!available.some((option) => option.value === group)) {
                  continue
                }
                const current = next.get(group) ?? emptyAppearance
                next.set(group, {
                  ...current,
                  category: category.id,
                  color: '',
                  icon: '',
                })
              }
              form.setValue('groups', Object.fromEntries(next), {
                shouldDirty: true,
              })
            }}
            onChange={updateGroup}
          />
        ))}
      </div>
      {available.length > 0 && (
        <div className='bg-muted/30 space-y-3 rounded-xl border border-dashed p-4'>
          <h3 className='text-muted-foreground text-sm font-medium'>
            {t('Uncategorized system groups')}
          </h3>
          <div className='flex flex-wrap gap-2'>
            {available.map((option) => (
              <span
                key={option.value}
                className='bg-background rounded-md border px-2 py-1 font-mono text-xs break-all'
              >
                {option.value}
              </span>
            ))}
          </div>
          <p className='text-muted-foreground text-xs'>
            {t('Use Add system groups in a category to organize these groups.')}
          </p>
        </div>
      )}
      {props.options.length === 0 && (
        <p className='text-muted-foreground text-sm'>
          {t(
            'No system groups are available yet. Add them in Pricing and access first.'
          )}
        </p>
      )}
      {invalid && (
        <p role='alert' className='text-destructive text-sm'>
          {t(
            'Check category names, hex colors, unique tags and sort orders before saving.'
          )}
        </p>
      )}
      {editing && (
        <CategoryEditor
          initial={editing.category}
          disabled={busy}
          onClose={() => setEditing(null)}
          onSave={(category) => {
            const categories = form.getValues('categories')
            form.setValue(
              'categories',
              editing.category
                ? categories.map((item) =>
                    item.id === category.id ? category : item
                  )
                : [...categories, category],
              { shouldDirty: true }
            )
            setEditing(null)
          }}
        />
      )}
      <Dialog
        open={preview}
        onOpenChange={setPreview}
        title={t('Live preview')}
        description={t('This is how groups appear when creating an API key.')}
        contentClassName='sm:max-w-lg'
      >
        <div className='rounded-xl border'>
          <ApiKeyGroupOptions
            options={previewOptions}
            value={selected}
            onValueChange={setSelected}
          />
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !reload.isPending) setConfirm(null)
        }}
        title={
          confirm?.type === 'reload'
            ? t('Reload saved appearance')
            : t('Remove category')
        }
        desc={
          confirm?.type === 'reload'
            ? t('Discard appearance drafts and load the latest saved settings?')
            : t(
                'Groups in this category will move to Other groups. Save appearance to apply this change.'
              )
        }
        isLoading={reload.isPending}
        handleConfirm={() => {
          if (confirm?.type === 'reload') {
            reload.mutate()
            return
          }
          if (confirm?.type !== 'remove') return
          form.setValue(
            'categories',
            draft.categories.filter(
              (category) => category.id !== confirm.category.id
            ),
            { shouldDirty: true }
          )
          form.setValue(
            'groups',
            Object.fromEntries(
              Object.entries(draft.groups).map(([key, group]) => [
                key,
                group.category === confirm.category.id
                  ? { ...group, category: '' }
                  : group,
              ])
            ),
            { shouldDirty: true }
          )
          setConfirm(null)
        }}
      />
    </section>
  )
}
