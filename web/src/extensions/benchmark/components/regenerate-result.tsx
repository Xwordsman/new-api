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
import { RotateCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { regenerateBenchmarkRun } from '../api'
import type { BenchmarkRun } from '../types'

export function RegenerateResult(props: {
  run: BenchmarkRun
  onOpen?: (id: number) => void
  onVersion?: (id: number) => void
}) {
  const { t } = useTranslation()
  const role = useAuthStore((state) => state.auth.user?.role ?? ROLE.GUEST)
  const client = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const regenerate = useMutation({
    mutationFn: () => regenerateBenchmarkRun(props.run.id),
    onSuccess: (run) => {
      client.setQueryData(['benchmark', 'run', run.id], run)
      setConfirm(false)
      props.onOpen?.(run.id)
      void client.invalidateQueries({ queryKey: ['benchmark'] })
      toast.success(t('Regeneration queued'))
    },
  })
  const sourceRunID = props.run.source_run_id
  const sourceExists =
    !props.run.versions ||
    props.run.versions.some((version) => version.id === sourceRunID)
  if (role < ROLE.ADMIN && !props.run.manual && !sourceRunID) return null
  return (
    <div className='flex flex-wrap items-center gap-2'>
      {props.run.manual && (
        <span className='text-muted-foreground text-xs'>
          {t('Manual regeneration')}
        </span>
      )}
      {!!sourceRunID && sourceExists && (props.onVersion || props.onOpen) && (
        <Button
          variant='link'
          size='sm'
          onClick={() => (props.onVersion ?? props.onOpen)?.(sourceRunID)}
        >
          {t('View original result')}
        </Button>
      )}
      {role >= ROLE.ADMIN && (
        <>
          <Button
            variant='outline'
            size='sm'
            disabled={props.run.status === 'running' || regenerate.isPending}
            onClick={() => setConfirm(true)}
          >
            <RotateCw aria-hidden />
            {t('Regenerate result')}
          </Button>
          <ConfirmDialog
            open={confirm}
            onOpenChange={(open) => {
              if (!regenerate.isPending) setConfirm(open)
            }}
            title={t('Regenerate this result?')}
            desc={t(
              'Reuse the saved group, model and prompt. The original result is retained. Automatic detection times and prompt rotation stay unchanged.'
            )}
            confirmText={t('Regenerate result')}
            isLoading={regenerate.isPending}
            handleConfirm={() => regenerate.mutate()}
          />
        </>
      )}
    </div>
  )
}
