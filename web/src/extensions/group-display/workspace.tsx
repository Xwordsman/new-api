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
import { useId, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Label } from '@/components/ui/label'
import { ApiKeyGroupOptions } from '@/features/keys/components/api-key-group-combobox'

import { getGroupDisplay, saveGroupDisplay } from './api'
import { AppearanceFields } from './appearance-fields'
import { CategoryEditor } from './category-editor'
import { displaySettingsSchema } from './schema'
import {
  applyGroupAppearance,
  emptyAppearance,
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
  const groupField = useId()
  const form = useForm<GroupDisplaySettings>({
    resolver: zodResolver(displaySettingsSchema),
    defaultValues: props.initial,
  })
  const draft = form.watch()
  const [selected, setSelected] = useState(props.options[0]?.value ?? '')
  const [confirm, setConfirm] = useState<'reload' | string | null>(null)
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
  const previewOptions = applyGroupAppearance(props.options, draft)
  const activeGroup = props.options.some((option) => option.value === selected)
    ? selected
    : (props.options[0]?.value ?? '')
  const selectedOption = props.options.find(
    (option) => option.value === activeGroup
  )
  const appearance = Object.hasOwn(draft.groups, activeGroup)
    ? draft.groups[activeGroup]
    : emptyAppearance
  const busy = save.isPending || reload.isPending
  return (
    <section
      aria-label={t('Group appearance')}
      className='space-y-5 rounded-xl border p-4 sm:p-5'
    >
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='space-y-1'>
          <h2 className='font-semibold'>{t('Group appearance')}</h2>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Customize categories and group styles in the API key selector. Save new groups before editing their appearance.'
            )}
          </p>
        </div>
        <Button
          type='button'
          variant='outline'
          disabled={save.isPending || reload.isPending}
          onClick={() => setConfirm('reload')}
        >
          {t('Reload saved appearance')}
        </Button>
      </div>
      <form
        noValidate
        onSubmit={form.handleSubmit(
          async (settings) => {
            await save.mutateAsync(settings).catch(() => {})
          },
          (errors) => {
            setInvalid(true)
            const group = Object.keys(errors.groups ?? {})[0]
            if (group) setSelected(group)
          }
        )}
      >
        <fieldset
          disabled={save.isPending || reload.isPending}
          className='min-w-0 space-y-5 disabled:opacity-60'
        >
          <div className='grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(380px,1fr)]'>
            <div className='min-w-0 space-y-6'>
              <CategoryEditor
                showErrors={invalid}
                disabled={busy}
                categories={draft.categories}
                onChange={(categories) =>
                  form.setValue('categories', categories, { shouldDirty: true })
                }
                onRemove={setConfirm}
              />
              <div className='space-y-4 border-t pt-5'>
                <div className='space-y-2'>
                  <Label htmlFor={groupField}>{t('Group to customize')}</Label>
                  <Combobox
                    disabled={busy}
                    id={groupField}
                    options={props.options.map((option) => ({
                      value: option.value,
                      label: option.value,
                    }))}
                    value={activeGroup}
                    onValueChange={(value) => setSelected(value ?? '')}
                  />
                </div>
                {selectedOption && (
                  <>
                    <p className='text-muted-foreground text-xs'>
                      {t(
                        'Empty names and descriptions use the existing group settings. Changes here affect presentation only.'
                      )}
                    </p>
                    <AppearanceFields
                      showErrors={invalid}
                      disabled={busy}
                      value={appearance}
                      categories={draft.categories}
                      onChange={(value) =>
                        form.setValue(
                          'groups',
                          { ...draft.groups, [activeGroup]: value },
                          { shouldDirty: true }
                        )
                      }
                    />
                    <Button
                      type='button'
                      variant='outline'
                      onClick={() => {
                        const groups = { ...draft.groups }
                        delete groups[activeGroup]
                        form.setValue('groups', groups, { shouldDirty: true })
                      }}
                    >
                      {t('Reset this group appearance')}
                    </Button>
                  </>
                )}
              </div>
            </div>
            <aside
              aria-label={t('Live preview')}
              className='min-w-0 space-y-3 xl:sticky xl:top-4'
            >
              <h3 className='font-medium'>{t('Live preview')}</h3>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Preview uses the same component as the API key selector. Users only see groups available to them.'
                )}
              </p>
              <div className='overflow-hidden rounded-xl border shadow-sm'>
                <ApiKeyGroupOptions
                  options={previewOptions}
                  value={activeGroup}
                  onValueChange={setSelected}
                />
              </div>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Auto stays at the top. Lower sort numbers appear first within each category.'
                )}
              </p>
            </aside>
          </div>
          {invalid && (
            <p role='alert' className='text-destructive text-sm'>
              {t(
                'Check category names, hex colors, unique tags and sort orders before saving.'
              )}
            </p>
          )}
          <div className='flex flex-wrap items-center gap-3 border-t pt-4'>
            <Button type='submit' disabled={save.isPending || reload.isPending}>
              {t('Save appearance')}
            </Button>
            {form.formState.isDirty && (
              <span className='text-muted-foreground text-xs'>
                {t('Unsaved changes')}
              </span>
            )}
          </div>
        </fieldset>
      </form>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !reload.isPending) setConfirm(null)
        }}
        title={
          confirm === 'reload'
            ? t('Reload saved appearance')
            : t('Remove category')
        }
        desc={
          confirm === 'reload'
            ? t('Discard appearance drafts and load the latest saved settings?')
            : t(
                'Groups in this category will move to Other groups. Save appearance to apply this change.'
              )
        }
        isLoading={reload.isPending}
        handleConfirm={() => {
          if (confirm === 'reload') {
            reload.mutate()
            return
          }
          form.setValue(
            'categories',
            draft.categories.filter((category) => category.id !== confirm),
            { shouldDirty: true }
          )
          form.setValue(
            'groups',
            Object.fromEntries(
              Object.entries(draft.groups).map(([key, group]) => [
                key,
                group.category === confirm ? { ...group, category: '' } : group,
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
