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
import { Eye, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { ApiKeyGroupOptions } from '@/features/keys/components/api-key-group-combobox'

import { getGroupDisplay, saveGroupDisplay } from './api'
import { AppearanceFields } from './appearance-fields'
import { CategoryEditor } from './category-editor'
import { GroupAppearanceTable } from './group-table'
import { displaySettingsSchema } from './schema'
import {
  applyGroupAppearance,
  emptyAppearance,
  type GroupAppearance,
  type GroupDisplayOption,
  type GroupDisplaySettings,
} from './types'
import { vendorPresets } from './vendor-presets'

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
  const [advanced, setAdvanced] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [selected, setSelected] = useState(props.options[0]?.value ?? '')
  const [vendorsOpen, setVendorsOpen] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const vendors = useMemo(
    () => [
      ...draft.categories,
      ...vendorPresets.filter(
        (preset) =>
          !draft.categories.some(
            (category) =>
              category.id === preset.id ||
              category.name.toLowerCase() === preset.name.toLowerCase()
          )
      ),
    ],
    [draft.categories]
  )
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
  const advancedAppearance =
    advanced && Object.hasOwn(draft.groups, advanced)
      ? draft.groups[advanced]
      : emptyAppearance
  const updateGroup = (group: string, appearance: GroupAppearance) => {
    form.setValue(
      'groups',
      { ...form.getValues('groups'), [group]: appearance },
      { shouldDirty: true }
    )
  }
  return (
    <section className='min-w-0 space-y-4'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='space-y-1'>
          <h2 className='font-semibold'>{t('API key group appearance')}</h2>
          <p className='text-muted-foreground max-w-2xl text-sm'>
            {t(
              'Choose a vendor for each group to set its icon and color automatically. Edit the row, then save.'
            )}
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
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
                (errors) => {
                  setInvalid(true)
                  if (errors.categories) setVendorsOpen(true)
                  const group = Object.keys(errors.groups ?? {})[0]
                  if (group) setAdvanced(group)
                }
              )()
            }
          >
            {save.isPending ? t('Saving...') : t('Save appearance')}
          </Button>
        </div>
      </div>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-muted-foreground text-xs'>
          {t(
            'Add tags with Enter. Use More only for custom icons, colors or ordering.'
          )}
        </p>
        <div className='flex items-center gap-2'>
          {dirty && (
            <span className='text-muted-foreground text-xs'>
              {t('Unsaved changes')}
            </span>
          )}
          <Button
            type='button'
            variant='ghost'
            size='sm'
            disabled={busy}
            onClick={() => setVendorsOpen(true)}
          >
            {t('Custom vendors')}
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='icon-sm'
            disabled={busy}
            aria-label={t('Reload saved appearance')}
            title={t('Reload saved appearance')}
            onClick={() => setConfirm('reload')}
          >
            <RotateCcw aria-hidden='true' className='size-4' />
          </Button>
        </div>
      </div>
      <fieldset disabled={busy} className='min-w-0 disabled:opacity-60'>
        <GroupAppearanceTable
          options={props.options}
          settings={draft}
          vendors={vendors}
          disabled={busy}
          onChange={updateGroup}
          onVendorChange={(group, category) => {
            const current = Object.hasOwn(draft.groups, group)
              ? draft.groups[group]
              : emptyAppearance
            if (current.category === category) return
            const vendor = vendors.find((entry) => entry.id === category)
            if (
              vendor &&
              !draft.categories.some((entry) => entry.id === category)
            ) {
              form.setValue('categories', [...draft.categories, vendor], {
                shouldDirty: true,
              })
            }
            updateGroup(group, { ...current, category, icon: '', color: '' })
          }}
          onAdvanced={setAdvanced}
        />
      </fieldset>
      {invalid && (
        <p role='alert' className='text-destructive text-sm'>
          {t(
            'Check category names, hex colors, unique tags and sort orders before saving.'
          )}
        </p>
      )}
      <Dialog
        open={preview}
        onOpenChange={setPreview}
        title={t('Live preview')}
        description={t('This is how groups appear when creating an API key.')}
        contentClassName='sm:max-w-lg'
      >
        <div className='overflow-hidden rounded-xl border'>
          <ApiKeyGroupOptions
            options={previewOptions}
            value={selected}
            onValueChange={setSelected}
          />
        </div>
      </Dialog>
      <Dialog
        open={advanced !== null}
        onOpenChange={(open) => {
          if (!open) setAdvanced(null)
        }}
        title={t('More settings for {{group}}', { group: advanced })}
        description={t('Changes here are included when you save appearance.')}
        footer={
          <Button type='button' onClick={() => setAdvanced(null)}>
            {t('Done')}
          </Button>
        }
      >
        {advanced !== null && (
          <fieldset disabled={busy} className='min-w-0 space-y-5'>
            <AppearanceFields
              key={advanced}
              showErrors={invalid}
              disabled={busy}
              value={advancedAppearance}
              category={draft.categories.find(
                (category) => category.id === advancedAppearance.category
              )}
              onChange={(value) => updateGroup(advanced, value)}
            />
            <Button
              type='button'
              variant='outline'
              onClick={() => {
                const groups = { ...form.getValues('groups') }
                delete groups[advanced]
                form.setValue('groups', groups, { shouldDirty: true })
              }}
            >
              {t('Reset this group appearance')}
            </Button>
          </fieldset>
        )}
      </Dialog>
      <Dialog
        open={vendorsOpen}
        onOpenChange={setVendorsOpen}
        title={t('Custom vendors')}
        description={t(
          'Common vendors are ready to select in the table. Add a vendor here only if it is missing.'
        )}
        footer={
          <Button
            type='button'
            disabled={busy}
            onClick={() => setVendorsOpen(false)}
          >
            {t('Done')}
          </Button>
        }
      >
        <fieldset disabled={busy} className='min-w-0'>
          <CategoryEditor
            showErrors={invalid}
            disabled={busy}
            categories={draft.categories}
            onChange={(categories) =>
              form.setValue('categories', categories, { shouldDirty: true })
            }
            onRemove={setConfirm}
          />
        </fieldset>
      </Dialog>
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
