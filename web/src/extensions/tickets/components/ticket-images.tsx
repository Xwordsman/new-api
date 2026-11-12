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
import { ImageOff, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'

import { getTicketImage } from '../api'
import { ticketQueryKey } from '../hooks'
import type { TicketImage, TicketView } from '../types'

export function TicketImageButton(props: {
  image: TicketImage
  ticketID: number
  view: TicketView
}) {
  const { t } = useTranslation()
  const userID = useAuthStore((state) => state.auth.user?.id)
  const [url, setUrl] = useState('')
  const [open, setOpen] = useState(false)
  const query = useQuery({
    queryKey: [
      ...ticketQueryKey,
      userID,
      props.view,
      'image',
      props.ticketID,
      props.image.id,
    ],
    queryFn: ({ signal }) =>
      getTicketImage(props.view, props.ticketID, props.image.id, signal),
    enabled: !!userID,
    staleTime: Infinity,
    meta: { errorToast: false },
  })
  useEffect(() => {
    if (!query.data) return
    const next = URL.createObjectURL(query.data)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [query.data])

  return (
    <>
      <Button
        variant='outline'
        className='bg-background size-24 overflow-hidden p-0'
        aria-label={t('View image {{name}}', { name: props.image.name })}
        onClick={() => {
          if (url) setOpen(true)
          else if (query.isError) void query.refetch()
        }}
        disabled={query.isPending}
      >
        {query.isPending && <Loader2 className='size-4 animate-spin' />}
        {query.isError && (
          <span className='flex flex-col items-center gap-1 text-[10px]'>
            <ImageOff className='size-4' />
            {t('Retry')}
          </span>
        )}
        {url && (
          <img
            src={url}
            alt={props.image.name}
            loading='lazy'
            className='size-full object-cover'
          />
        )}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={props.image.name}
        contentClassName='sm:max-w-3xl'
      >
        {url && (
          <img
            src={url}
            alt={props.image.name}
            className='mx-auto max-h-[75vh] max-w-full object-contain'
          />
        )}
      </Dialog>
    </>
  )
}
