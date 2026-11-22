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
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { formatTimestamp } from '@/lib/format'

import { getEventDetails } from '../api'
import type { ProtectionEvent } from '../types'
import {
  InspectionCoverage,
  ProtectionLabel,
  SuspectedIntent,
} from './record-label'
import type { ReviewAction } from './review-dialog'

export function EventDetailsDialog(props: {
  event: ProtectionEvent
  onClose: () => void
  onAction: (action: ReviewAction) => void
}) {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['request-protection', 'event', props.event.id],
    queryFn: () => getEventDetails(props.event.id),
  })
  const event = props.event
  const metadata = [
    [t('User'), `${event.username || '—'} #${event.user_id}`],
    [t('Key ID'), `${event.token_name || '—'} #${event.token_id}`],
    [t('IP address'), event.ip || '—'],
    [
      t('Model / Channel'),
      `${event.model} / ${event.channel_name || '—'} #${event.channel_id}`,
    ],
    [t('Group'), event.group],
    [t('Request ID'), event.request_id],
  ]
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={`${t('Protection event details')} #${event.id}`}
      description={t(
        'Review extracted request text and matching evidence before taking action.'
      )}
      contentClassName='sm:max-w-5xl'
      bodyClassName='space-y-5'
      footer={
        <>
          {event.restrictions?.map((restriction) => (
            <Button
              key={restriction.id}
              variant='outline'
              onClick={() =>
                props.onAction({ kind: 'release', subject: restriction.id })
              }
            >
              {t('Release restriction')} ({restriction.id})
            </Button>
          ))}
          {!event.restrictions?.length && (
            <Button
              variant='outline'
              onClick={() => props.onAction({ kind: 'hold', event: event.id })}
            >
              {t('Pause this user')}
            </Button>
          )}
          {event.review === 'pending' && (
            <>
              <Button
                variant='outline'
                onClick={() =>
                  props.onAction({
                    kind: 'review',
                    event: event.id,
                    verdict: 'false_positive',
                  })
                }
              >
                {t('Mark false positive')}
              </Button>
              <Button
                onClick={() =>
                  props.onAction({
                    kind: 'review',
                    event: event.id,
                    verdict: 'confirmed',
                  })
                }
              >
                {t('Confirm violation')}
              </Button>
            </>
          )}
        </>
      }
    >
      <dl className='grid gap-3 sm:grid-cols-2'>
        {metadata.map(([label, value]) => (
          <div key={label} className='min-w-0'>
            <dt className='text-muted-foreground text-sm'>{label}</dt>
            <dd className='break-all'>{value || '—'}</dd>
          </div>
        ))}
      </dl>
      <div className='flex flex-wrap gap-3 text-sm'>
        <ProtectionLabel value={event.decision} />
        <ProtectionLabel value={event.upstream} />
        <ProtectionLabel value={event.review} />
      </div>
      {(event.uninspected || event.finding === 'check_failed') && (
        <section className='space-y-2'>
          <h3 className='font-semibold'>{t('Inspection coverage')}</h3>
          <InspectionCoverage event={event} />
        </section>
      )}
      <section className='space-y-2'>
        <h3 className='font-semibold'>{t('Suspected intent')}</h3>
        <SuspectedIntent event={event} />
      </section>
      <section className='space-y-2'>
        <h3 className='font-semibold'>{t('Matched keywords')}</h3>
        {event.matches.map((hit) => (
          <div
            key={`${hit.rule_id}-${hit.source}-${hit.matched || hit.evidence}`}
            className='rounded-md border p-3 text-sm'
          >
            <p className='font-medium break-all'>{hit.matched || hit.name}</p>
            <p className='text-muted-foreground'>
              <ProtectionLabel value={hit.source} /> · {hit.rule_id}
            </p>
            {hit.evidence && (
              <pre className='mt-2 font-sans break-all whitespace-pre-wrap'>
                {hit.evidence}
              </pre>
            )}
          </div>
        ))}
      </section>
      {query.isPending && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {query.data && (
        <>
          {(query.data.content_truncated || query.data.content_redacted) && (
            <Alert>
              <AlertDescription>
                {query.data.content_truncated && (
                  <p>
                    {t(
                      'Content was truncated or could not be fully extracted. Attachments are not stored.'
                    )}
                  </p>
                )}
                {query.data.content_redacted && (
                  <p>{t('Recognizable credentials have been redacted.')}</p>
                )}
              </AlertDescription>
            </Alert>
          )}
          <section className='space-y-2'>
            <div className='flex items-center justify-between'>
              <h3 className='font-semibold'>{t('Request content')}</h3>
              {query.data.request_content && (
                <CopyButton value={query.data.request_content} />
              )}
            </div>
            <pre className='bg-muted max-h-96 overflow-auto rounded-md p-4 font-mono text-sm break-all whitespace-pre-wrap'>
              {query.data.request_content ||
                t('Content unavailable for this older event')}
            </pre>
          </section>
          <section className='space-y-2'>
            <h3 className='font-semibold'>{t('Review history')}</h3>
            {(query.data.audits || []).map((audit) => (
              <div key={audit.id} className='rounded-md border p-3 text-sm'>
                <p>
                  {formatTimestamp(audit.created_at)} ·{' '}
                  <ProtectionLabel value={audit.action} /> · {t('Operator ID')}{' '}
                  #{audit.actor_id || '—'}
                </p>
                <p className='break-all whitespace-pre-wrap'>{audit.note}</p>
              </div>
            ))}
            {!query.data.audits?.length && (
              <p className='text-muted-foreground text-sm'>
                {t('No protection audit records')}
              </p>
            )}
          </section>
        </>
      )}
    </Dialog>
  )
}
