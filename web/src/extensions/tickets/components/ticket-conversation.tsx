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
import {
  ArrowLeft,
  CheckCheck,
  Loader2,
  RotateCcw,
  Send,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useStickToBottom } from 'use-stick-to-bottom'

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { formatDateTimeObject } from '@/lib/time'
import { cn } from '@/lib/utils'

import { changeTicketStatus, replyToTicket } from '../api'
import { ticketActions, ticketCategories } from '../constants'
import { ticketQueryKey, useReadTicket, useTicketConversation } from '../hooks'
import { ticketReplySchema } from '../lib/schema'
import type { TicketAction, TicketMessage, TicketView } from '../types'
import { AttachmentPicker } from './attachment-picker'
import { TicketImageButton } from './ticket-images'
import { TicketStatusBadge } from './ticket-status'

function MessageBubble(props: { message: TicketMessage; view: TicketView }) {
  const { t } = useTranslation()
  const message = props.message
  if (message.event) {
    return (
      <p className='text-muted-foreground py-2 text-center text-[11px]'>
        {message.author_name} · {t(ticketActions[message.event].eventKey)} ·{' '}
        {formatDateTimeObject(new Date(message.created_at * 1000))}
      </p>
    )
  }
  return (
    <article
      className={cn(
        'flex flex-col gap-2',
        message.staff ? 'items-start' : 'items-end'
      )}
    >
      <div className='text-muted-foreground flex flex-wrap items-center gap-2 text-[11px]'>
        <span>{message.author_name}</span>
        {message.staff && (
          <Badge variant='secondary' className='text-[10px]'>
            {t('Support team')}
          </Badge>
        )}
        <time dateTime={new Date(message.created_at * 1000).toISOString()}>
          {formatDateTimeObject(new Date(message.created_at * 1000))}
        </time>
      </div>
      <div
        className={cn(
          'max-w-full rounded-xl border px-4 py-3 text-sm leading-relaxed sm:max-w-[92%]',
          message.staff
            ? 'bg-background'
            : 'border-blue-100 bg-blue-50/70 dark:border-blue-900 dark:bg-blue-950/40'
        )}
      >
        {message.body && (
          <p className='[overflow-wrap:anywhere] break-words whitespace-pre-wrap'>
            {message.body}
          </p>
        )}
        {message.attachments.length > 0 && (
          <div className={cn('flex flex-wrap gap-2', message.body && 'mt-3')}>
            {message.attachments.map((image) => (
              <TicketImageButton
                key={image.id}
                image={image}
                view={props.view}
                ticketID={message.ticket_id}
              />
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

export function TicketConversation(props: {
  id: number
  view: TicketView
  onBack: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const query = useTicketConversation(props.view, props.id)
  const ticket = query.data?.pages[0].ticket
  const messages =
    [...(query.data?.pages ?? [])].reverse().flatMap((page) => page.messages) ??
    []
  const [images, setImages] = useState<File[]>([])
  const [action, setAction] = useState<TicketAction | null>(null)
  const scroll = useStickToBottom({ initial: 'instant', resize: 'instant' })
  const { scrollRef, scrollToBottom } = scroll
  const readCursor = useRef(0)
  const {
    mutate: read,
    isError: readError,
    reset: resetRead,
  } = useReadTicket(props.view, props.id)
  const form = useForm<{ body: string }>({
    resolver: zodResolver(ticketReplySchema),
    defaultValues: { body: '' },
  })
  const reply = useMutation({
    mutationFn: (values: { body: string }) => {
      if (!ticket) {
        throw new Error('This ticket has changed. Refresh and try again.')
      }
      return replyToTicket(props.view, ticket, values.body, images)
    },
    onSuccess: () => {
      form.reset()
      setImages([])
      void client.invalidateQueries({ queryKey: ticketQueryKey })
    },
    onSettled: (_data, error) => {
      if (error) void query.refetch()
    },
  })
  const changeStatus = useMutation({
    mutationFn: (next: TicketAction) => {
      if (!ticket) {
        throw new Error('This ticket has changed. Refresh and try again.')
      }
      return changeTicketStatus(props.view, ticket, next)
    },
    onSuccess: () => {
      setAction(null)
      void client.invalidateQueries({ queryKey: ticketQueryKey })
    },
    onSettled: (_data, error) => {
      if (error) void query.refetch()
    },
  })

  const latest = query.data?.pages[0].messages.at(-1)?.id ?? 0
  const isUnread = ticket?.unread ?? false
  useEffect(() => {
    const container = scrollRef.current
    if (!container || latest === 0) return
    const markVisible = () => {
      if (
        document.visibilityState !== 'visible' ||
        !isUnread ||
        readCursor.current >= latest ||
        container.scrollHeight - container.scrollTop - container.clientHeight >=
          100
      ) {
        return
      }
      readCursor.current = latest
      read(latest)
    }
    void Promise.resolve(
      scrollToBottom({
        animation: 'instant',
        preserveScrollPosition: true,
      })
    ).then(markVisible)
    markVisible()
    container.addEventListener('scroll', markVisible, { passive: true })
    document.addEventListener('visibilitychange', markVisible)
    return () => {
      container.removeEventListener('scroll', markVisible)
      document.removeEventListener('visibilitychange', markVisible)
    }
  }, [latest, isUnread, read, scrollRef, scrollToBottom])

  if (query.isPending) return <LoadingState className='min-h-80' />
  if (query.isError || !ticket) {
    return (
      <div className='p-5'>
        <Button variant='ghost' size='sm' onClick={props.onBack}>
          <ArrowLeft />
          {t('Back to tickets')}
        </Button>
        <ErrorState onRetry={() => void query.refetch()} />
      </div>
    )
  }
  const closed = ticket.status === 'resolved' || ticket.status === 'withdrawn'
  const pending = reply.isPending || changeStatus.isPending

  return (
    <section
      aria-label={t('Ticket conversation')}
      className='flex h-full min-h-0 flex-col'
    >
      <header className='space-y-3 border-b p-4 sm:px-5'>
        <Button
          variant='ghost'
          size='sm'
          className='text-muted-foreground -ms-2 md:hidden'
          onClick={props.onBack}
        >
          <ArrowLeft className='size-3.5' />
          {t('Back to tickets')}
        </Button>
        <div className='flex flex-wrap items-start justify-between gap-2'>
          <div className='min-w-0 flex-1'>
            <p className='text-muted-foreground mb-1 text-[11px]'>
              #{ticket.id} · {t(ticketCategories[ticket.category])}
            </p>
            <h2 className='text-base font-semibold break-words'>
              {ticket.subject}
            </h2>
          </div>
          <TicketStatusBadge status={ticket.status} />
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          {props.view === 'team' && (
            <span className='text-muted-foreground me-auto text-xs'>
              {ticket.username} · ID {ticket.user_id}
            </span>
          )}
          {closed ? (
            <Button
              size='sm'
              variant='outline'
              disabled={pending}
              onClick={() => setAction('reopen')}
            >
              <RotateCcw className='size-3.5' />
              {t('Reopen ticket')}
            </Button>
          ) : (
            <>
              <Button
                size='sm'
                variant='outline'
                disabled={pending}
                onClick={() => setAction('resolve')}
              >
                <CheckCheck className='size-3.5' />
                {t('Resolve ticket')}
              </Button>
              {props.view === 'mine' && (
                <Button
                  size='sm'
                  variant='ghost'
                  disabled={pending}
                  onClick={() => setAction('withdraw')}
                >
                  <X className='size-3.5' />
                  {t('Withdraw ticket')}
                </Button>
              )}
            </>
          )}
          {isUnread && (
            <Button
              size='sm'
              variant='ghost'
              onClick={() => {
                void scroll.scrollToBottom('instant')
              }}
            >
              {t('Latest replies')}
            </Button>
          )}
        </div>
      </header>
      <Conversation instance={scroll} className='bg-muted/15'>
        <ConversationContent
          aria-label={t('Messages')}
          className='space-y-5 p-4 sm:p-5'
          scrollClassName='overflow-y-auto overscroll-contain'
        >
          {query.hasNextPage && (
            <div className='text-center'>
              <Button
                size='sm'
                variant='outline'
                disabled={query.isFetchingNextPage}
                onClick={() => {
                  const container = scroll.scrollRef.current
                  const height = container?.scrollHeight ?? 0
                  const top = container?.scrollTop ?? 0
                  scroll.stopScroll()
                  void query.fetchNextPage().then(() =>
                    requestAnimationFrame(() => {
                      if (container) {
                        container.scrollTop =
                          top + container.scrollHeight - height
                      }
                    })
                  )
                }}
              >
                {query.isFetchingNextPage && (
                  <Loader2 className='size-3 animate-spin' />
                )}
                {t('Load earlier messages')}
              </Button>
            </div>
          )}
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              view={props.view}
            />
          ))}
        </ConversationContent>
        <ConversationScrollButton aria-label={t('Latest replies')} />
      </Conversation>
      {readError && (
        <Button
          variant='ghost'
          size='sm'
          onClick={() => {
            resetRead()
            read(latest)
          }}
        >
          {t('Retry marking as read')}
        </Button>
      )}
      {closed ? (
        <div className='text-muted-foreground shrink-0 border-t p-5 text-center text-xs'>
          {t('This ticket is closed. Reopen it to continue the conversation.')}
        </div>
      ) : (
        <div className='shrink-0 border-t p-4 sm:px-5'>
          <Form {...form}>
            <form
              className='space-y-3'
              onSubmit={form.handleSubmit((values) => {
                if (!values.body && images.length === 0) {
                  form.setError('body', {
                    message: 'Write a reply or add an image.',
                  })
                  return
                }
                reply.mutate(values)
              })}
            >
              <FormField
                control={form.control}
                name='body'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='sr-only'>{t('Reply')}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        disabled={pending}
                        maxLength={10000}
                        placeholder={t(
                          'Write a reply. Please redact sensitive information.'
                        )}
                        className='max-h-40 min-h-20 resize-y'
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <AttachmentPicker
                files={images}
                onChange={setImages}
                disabled={pending}
                compact
              />
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <span className='text-muted-foreground text-[11px]'>
                  {t('Do not share passwords or API keys.')}
                </span>
                <Button type='submit' size='sm' disabled={pending}>
                  {reply.isPending ? (
                    <Loader2 className='size-3.5 animate-spin' />
                  ) : (
                    <Send className='size-3.5' />
                  )}
                  {t('Send reply')}
                </Button>
              </div>
              {reply.isError && (
                <p role='alert' className='text-destructive text-xs'>
                  {t(
                    'Reply failed. Your draft is still here; please try again.'
                  )}
                </p>
              )}
            </form>
          </Form>
        </div>
      )}
      <ConfirmDialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open && !changeStatus.isPending) setAction(null)
        }}
        title={action ? t(ticketActions[action].labelKey) : ''}
        desc={action ? t(ticketActions[action].descriptionKey) : ''}
        confirmText={action ? t(ticketActions[action].labelKey) : ''}
        destructive={action === 'withdraw'}
        isLoading={changeStatus.isPending}
        handleConfirm={() => {
          if (action) changeStatus.mutate(action)
        }}
      />
    </section>
  )
}
