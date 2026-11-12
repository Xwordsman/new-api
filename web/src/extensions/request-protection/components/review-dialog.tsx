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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { releaseSubject, reviewEvent } from '../api'

export type ReviewAction =
  | { kind: 'release'; subject: string }
  | { kind: 'review'; event: number; verdict: 'confirmed' | 'false_positive' }

export function ProtectionReviewDialog(props: {
  action: ReviewAction
  onClose: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const id = useId()
  const [note, setNote] = useState('')
  const [invalid, setInvalid] = useState(false)
  const save = useMutation({
    mutationFn: () =>
      props.action.kind === 'release'
        ? releaseSubject({
            subject_id: props.action.subject,
            note: note.trim(),
          })
        : reviewEvent({
            event_id: props.action.event,
            verdict: props.action.verdict,
            note: note.trim(),
          }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['request-protection'] })
      toast.success(t('Protection review saved'))
      props.onClose()
    },
  })
  let title = t('Release restriction')
  let description = t(
    'Release this plugin restriction and reset its violation window. Host account and Key settings are preserved.'
  )
  if (props.action.kind === 'review') {
    title =
      props.action.verdict === 'confirmed'
        ? t('Confirm violation')
        : t('Mark false positive')
    description = t(
      'False positives stop counting toward restrictions. Related active restrictions are recalculated using their original thresholds.'
    )
  }
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) props.onClose()
      }}
      title={title}
      desc={description}
      confirmText={t('Confirm')}
      isLoading={save.isPending}
      handleConfirm={() => {
        if (
          !note.trim() ||
          new TextEncoder().encode(note.trim()).length > 500
        ) {
          setInvalid(true)
          return
        }
        save.mutate()
      }}
    >
      <div className='space-y-2'>
        <Label htmlFor={id}>{t('Review reason')}</Label>
        <Textarea
          id={id}
          value={note}
          maxLength={500}
          onChange={(event) => {
            setNote(event.target.value)
            setInvalid(false)
          }}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
          disabled={save.isPending}
        />
        {invalid && (
          <p
            id={`${id}-error`}
            role='alert'
            className='text-destructive text-sm'
          >
            {t('Enter a reason of at most 500 bytes.')}
          </p>
        )}
      </div>
    </ConfirmDialog>
  )
}
