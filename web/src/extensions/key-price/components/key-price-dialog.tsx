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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { handleServerError } from '@/lib/handle-server-error'

import { acceptPriceQuote, getPriceDetail, getPriceQuote } from '../api'
import type { PriceQuote } from '../types'
import { PriceEventsTable } from './events-table'
import { RatesTable } from './rates-table'

export function KeyPriceDialog(props: {
  tokenId: number
  name: string
  onClose: () => void
  onAccepted: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [quote, setQuote] = useState<PriceQuote | null>(null)
  const [protectedKey, setProtectedKey] = useState<boolean | null>(null)
  const [expired, setExpired] = useState(false)
  const detail = useQuery({
    queryKey: ['key-price', 'detail', props.tokenId],
    queryFn: () => getPriceDetail(props.tokenId),
    refetchOnWindowFocus: false,
  })
  useEffect(() => {
    if (!quote) return
    const timer = window.setTimeout(
      () => setExpired(true),
      Math.max(0, quote.expires_at * 1000 - Date.now())
    )
    return () => window.clearTimeout(timer)
  }, [quote])
  const review = useMutation({
    mutationFn: () => getPriceQuote(props.tokenId),
    onSuccess: (value) => {
      setQuote(value)
      setExpired(false)
      setProtectedKey((previous) => previous ?? value.protected)
    },
  })
  const settings = quote?.settings ?? detail.data?.settings
  let selected =
    protectedKey ??
    (detail.data?.tracked
      ? detail.data.state.protected
      : settings?.default_protect) ??
    true
  if (settings && !settings.allow_opt_out) selected = true
  const accept = useMutation({
    mutationFn: (reviewedQuote: PriceQuote) =>
      acceptPriceQuote(props.tokenId, reviewedQuote.quote, selected),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['key-price'] })
      toast.success(
        t(
          'Multipliers accepted. Only the price protection pause has been cleared.'
        )
      )
      props.onAccepted()
      props.onClose()
    },
    onError: (error) => {
      setQuote(null)
      void detail.refetch()
      handleServerError(error)
    },
  })
  const busy = review.isPending || accept.isPending
  const ready = quote && !expired
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) props.onClose()
      }}
      title={`${t('Key price protection')} · ${props.name}`}
      className='sm:max-w-2xl'
      desc={t(
        'Review the effective group multipliers before accepting. Manual disablement, expiry and quota limits still apply.'
      )}
      isLoading={busy}
      disabled={!detail.data || !settings?.enabled || detail.isFetching}
      confirmText={
        ready
          ? t('Accept multipliers and resume')
          : t('Review current multipliers')
      }
      handleConfirm={() => {
        if (quote && !expired) {
          accept.mutate(quote)
          return
        }
        review.mutate()
      }}
    >
      <div className='max-h-[60vh] space-y-4 overflow-y-auto pr-1'>
        {detail.isPending && <LoadingState />}
        {detail.isError && <ErrorState onRetry={() => void detail.refetch()} />}
        {detail.data && (
          <>
            {!settings?.enabled && (
              <Alert>
                <AlertDescription>
                  {t('Price protection is disabled by the administrator.')}
                </AlertDescription>
              </Alert>
            )}
            {detail.data.state.paused && (
              <Alert variant='destructive'>
                <AlertDescription>
                  {t(
                    'This Key is paused by price protection. Accept the current multipliers to clear this pause.'
                  )}
                </AlertDescription>
              </Alert>
            )}
            {expired && (
              <Alert variant='destructive'>
                <AlertDescription>
                  {t(
                    'The price quote expired. Review the current multipliers again.'
                  )}
                </AlertDescription>
              </Alert>
            )}
            {ready && (
              <Alert>
                <AlertDescription>
                  {t(
                    'Confirm the multipliers below. A price or routing change will require a new review.'
                  )}
                </AlertDescription>
              </Alert>
            )}
            <RatesTable
              accepted={detail.data.accepted}
              current={quote?.rates ?? detail.data.current}
            />
            <div className='flex items-center justify-between gap-4 rounded-lg border p-4'>
              <div>
                <Label htmlFor='key-price-protected'>
                  {t('Protect this Key from multiplier increases')}
                </Label>
                <p className='text-muted-foreground mt-1 text-xs'>
                  {t(
                    'A temporary price drop does not lower your accepted ceiling. Future checks use the configured increase threshold.'
                  )}
                </p>
              </div>
              <Switch
                id='key-price-protected'
                checked={selected}
                onCheckedChange={setProtectedKey}
                disabled={busy || !settings?.allow_opt_out || !settings.enabled}
              />
            </div>
            {settings && (
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Pause when a group multiplier rises more than {{percent}}% above its accepted value.',
                  { percent: settings.increase_percent }
                )}
              </p>
            )}
            <details>
              <summary className='cursor-pointer text-sm font-medium'>
                {t('Protection history')}
              </summary>
              <div className='mt-3'>
                <PriceEventsTable events={detail.data.events} />
              </div>
            </details>
          </>
        )}
      </div>
    </ConfirmDialog>
  )
}
