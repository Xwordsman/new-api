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
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DateTimePicker } from '@/components/datetime-picker'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { formatTimestamp } from '@/lib/format'

import { cleanupBenchmarkRuns, previewBenchmarkCleanup } from '../api'
import { cleanupSchema, type CleanupValues } from '../lib/history-schema'
import type { HistorySelection } from '../types'

export function HistoryCleanup(props: { groups: string[] }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<{
    selection: HistorySelection
    ids: number[]
  } | null>(null)
  const form = useForm<CleanupValues>({
    resolver: zodResolver(cleanupSchema),
    defaultValues: {
      group: '',
      after: new Date(Date.now() - 86400000),
      before: new Date(),
    },
  })
  const inspect = useMutation({
    mutationFn: async (value: CleanupValues) => {
      const selection = {
        group: value.group,
        after: Math.floor(value.after.getTime() / 1000),
        before: Math.floor(value.before.getTime() / 1000),
      }
      return { selection, result: await previewBenchmarkCleanup(selection) }
    },
    onSuccess: ({ selection, result }) => {
      if (!result.count) {
        toast.info(t('No matching benchmark results'))
        return
      }
      setPreview({ selection, ids: result.ids })
    },
  })
  const remove = useMutation({
    mutationFn: (value: NonNullable<typeof preview>) =>
      cleanupBenchmarkRuns(value.selection, value.ids),
    onSuccess: (result) => {
      setPreview(null)
      setOpen(false)
      void client.invalidateQueries({ queryKey: ['benchmark'] })
      toast.success(
        t('Deleted {{count}} benchmark results', {
          count: result.deleted_count,
        })
      )
    },
  })
  return (
    <>
      <Button
        variant='outline'
        size='sm'
        disabled={!props.groups.length}
        onClick={() => setOpen(true)}
      >
        {t('Clean up history')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!inspect.isPending && !remove.isPending) setOpen(value)
        }}
        title={t('Clean up benchmark history')}
        description={t(
          'Select one group and a date range of up to 90 days. Running checks are excluded; preview up to 1,000 results before deleting.'
        )}
      >
        <form
          className='space-y-4'
          onSubmit={form.handleSubmit((value) => inspect.mutate(value))}
        >
          <div className='space-y-2'>
            <Label htmlFor='cleanup-group'>{t('Group')}</Label>
            <NativeSelect
              id='cleanup-group'
              {...form.register('group')}
              disabled={inspect.isPending || remove.isPending}
            >
              <NativeSelectOption value=''>
                {t('Select group')}
              </NativeSelectOption>
              {props.groups.map((group) => (
                <NativeSelectOption key={group} value={group}>
                  {group}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {(['after', 'before'] as const).map((field) => (
            <Controller
              key={field}
              name={field}
              control={form.control}
              render={({ field: control }) => (
                <div className='space-y-2'>
                  <Label htmlFor={`cleanup-${field}`}>
                    {field === 'after'
                      ? t('Start time (inclusive)')
                      : t('End time (exclusive)')}
                  </Label>
                  <DateTimePicker
                    id={`cleanup-${field}`}
                    aria-label={
                      field === 'after'
                        ? t('Start time (inclusive)')
                        : t('End time (exclusive)')
                    }
                    value={control.value}
                    onChange={control.onChange}
                    disabled={inspect.isPending || remove.isPending}
                  />
                </div>
              )}
            />
          ))}
          {Object.keys(form.formState.errors).length > 0 && (
            <p role='alert' className='text-destructive text-sm'>
              {t(
                'Choose a group and a valid past date range of up to 90 days.'
              )}
            </p>
          )}
          <Button
            type='submit'
            disabled={inspect.isPending || remove.isPending}
          >
            {t('Preview cleanup')}
          </Button>
        </form>
      </Dialog>
      <ConfirmDialog
        open={preview !== null}
        onOpenChange={(value) => {
          if (!value && !remove.isPending) setPreview(null)
        }}
        title={t('Delete selected benchmark results?')}
        desc={
          preview ? (
            <div className='space-y-2'>
              <p>
                {preview.selection.group} ·{' '}
                {formatTimestamp(preview.selection.after)} —{' '}
                {formatTimestamp(preview.selection.before)}
              </p>
              <p>
                {t(
                  'Delete exactly {{count}} previewed versions. This cannot be undone; statistics are recalculated and the automatic schedule is unchanged.',
                  { count: preview.ids.length }
                )}
              </p>
            </div>
          ) : (
            ''
          )
        }
        destructive
        confirmText={t('Delete results')}
        isLoading={remove.isPending}
        handleConfirm={() => {
          if (preview) remove.mutate(preview)
        }}
      />
    </>
  )
}
