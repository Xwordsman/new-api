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
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'

import { deleteBenchmarkRun, reviewBenchmarkRun } from '../api'
import { reviewSchema, type ReviewValues } from '../lib/history-schema'
import type { BenchmarkRun } from '../types'

export function ResultActions(props: {
  run: BenchmarkRun
  onDeleted: (nextID: number) => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [reviewOpen, setReviewOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const form = useForm<ReviewValues>({
    resolver: zodResolver(reviewSchema),
    defaultValues: {
      quality: props.run.quality ?? '',
      reason: props.run.quality_reason ?? '',
    },
  })
  const review = useMutation({
    mutationFn: (value: ReviewValues) =>
      reviewBenchmarkRun(
        props.run.id,
        value.quality,
        value.reason,
        props.run.reviewed_at ?? 0
      ),
    onSuccess: () => {
      setReviewOpen(false)
      void client.invalidateQueries({ queryKey: ['benchmark'] })
      toast.success(t('Visual review saved'))
    },
  })
  const remove = useMutation({
    mutationFn: () => deleteBenchmarkRun(props.run.id),
    onSuccess: (result) => {
      setDeleteOpen(false)
      props.onDeleted(result.next_run_id)
      // The deleted version may still be mounted until React processes the
      // selection change. Do not refetch its detail queries and produce a 404.
      void client.cancelQueries({
        queryKey: ['benchmark', 'run', props.run.id],
      })
      client.removeQueries({ queryKey: ['benchmark', 'run', props.run.id] })
      void client.invalidateQueries({
        queryKey: ['benchmark'],
        predicate: (query) =>
          query.queryKey[1] !== 'run' || query.queryKey[2] !== props.run.id,
      })
      toast.success(t('Benchmark result deleted'))
    },
  })
  const busy =
    review.isPending || remove.isPending || props.run.status === 'running'
  return (
    <div className='flex flex-wrap gap-2'>
      {props.run.kind === 'svg' && props.run.status === 'passed' && (
        <Button
          variant='outline'
          size='sm'
          disabled={busy}
          onClick={() => setReviewOpen(true)}
        >
          {t('Review visual quality')}
        </Button>
      )}
      <Button
        variant='outline'
        size='sm'
        disabled={busy}
        onClick={() => setDeleteOpen(true)}
      >
        {t('Delete result')}
      </Button>
      <Dialog
        open={reviewOpen}
        onOpenChange={(open) => {
          if (!review.isPending) setReviewOpen(open)
        }}
        title={t('Review visual quality')}
        description={t(
          'This is an administrator assessment of this version, not an automatic vision check.'
        )}
      >
        <form
          className='space-y-4'
          onSubmit={form.handleSubmit((value) => review.mutate(value))}
        >
          <div className='space-y-2'>
            <Label htmlFor={`quality-${props.run.id}`}>
              {t('Visual quality')}
            </Label>
            <NativeSelect
              id={`quality-${props.run.id}`}
              {...form.register('quality')}
              disabled={review.isPending}
            >
              <NativeSelectOption value=''>
                {t('Awaiting visual review')}
              </NativeSelectOption>
              <NativeSelectOption value='normal'>
                {t('Visual quality normal')}
              </NativeSelectOption>
              <NativeSelectOption value='suspected'>
                {t('Visual quality suspected')}
              </NativeSelectOption>
              <NativeSelectOption value='abnormal'>
                {t('Visual quality abnormal')}
              </NativeSelectOption>
            </NativeSelect>
          </div>
          <div className='space-y-2'>
            <Label htmlFor={`reason-${props.run.id}`}>
              {t('Review reason')}
            </Label>
            <Textarea
              id={`reason-${props.run.id}`}
              {...form.register('reason')}
              maxLength={500}
              disabled={review.isPending}
              aria-invalid={!!form.formState.errors.reason}
              aria-describedby={
                form.formState.errors.reason
                  ? `reason-error-${props.run.id}`
                  : undefined
              }
            />
            {form.formState.errors.reason && (
              <p
                id={`reason-error-${props.run.id}`}
                role='alert'
                className='text-destructive text-sm'
              >
                {t('Enter a reason (up to 500 characters).')}
              </p>
            )}
          </div>
          <Button type='submit' disabled={review.isPending}>
            {t('Save review')}
          </Button>
        </form>
      </Dialog>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!remove.isPending) setDeleteOpen(open)
        }}
        title={t('Delete this benchmark result?')}
        desc={t(
          'Only this version will be deleted. Remaining versions stay available; statistics are recalculated and the automatic schedule is unchanged.'
        )}
        destructive
        confirmText={t('Delete result')}
        isLoading={remove.isPending}
        handleConfirm={() => remove.mutate()}
      />
    </div>
  )
}
