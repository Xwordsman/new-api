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
import { ImagePlus, UploadCloud, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

import { ticketImageError } from '../constants'

function imageIdentity(file: File) {
  return JSON.stringify([file.name, file.size, file.lastModified, file.type])
}

function DraftImage(props: {
  file: File
  onRemove: () => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  useEffect(() => {
    const next = URL.createObjectURL(props.file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [props.file])
  return (
    <div className='group relative size-20 shrink-0 rounded-lg border'>
      {url && (
        <img
          src={url}
          alt={props.file.name}
          className='size-full rounded-lg object-cover'
        />
      )}
      <Button
        type='button'
        variant='secondary'
        size='icon'
        className='absolute -top-2 -right-2 size-6 rounded-full border shadow-sm'
        aria-label={t('Remove image {{name}}', { name: props.file.name })}
        disabled={props.disabled}
        onClick={props.onRemove}
      >
        <X className='size-3' />
      </Button>
    </div>
  )
}

// PromptInput owns an AI SDK form and converts files to FileUIPart URLs. This
// picker keeps original Files for the ticket's multipart form and strict limits.
export function AttachmentPicker(props: {
  files: File[]
  onChange: (files: File[]) => void
  disabled?: boolean
  compact?: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)

  const addFiles = (incoming: File[]) => {
    if (props.disabled || incoming.length === 0) return
    if (
      props.files.length + incoming.length > 5 ||
      incoming.some(
        (file) =>
          !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
          !/\.(png|jpe?g|webp)$/i.test(file.name) ||
          file.size <= 0 ||
          file.size > 2 * 1024 * 1024
      )
    ) {
      setError(ticketImageError)
      return
    }
    setError('')
    const files = new Map(
      [...props.files, ...incoming].map((file) => [imageIdentity(file), file])
    )
    props.onChange([...files.values()])
  }

  return (
    <div className='space-y-2'>
      <Label htmlFor={id} className={cn('text-xs', props.compact && 'sr-only')}>
        {t('Image attachments')}
      </Label>
      <div
        role='group'
        aria-label={t('Image attachments')}
        tabIndex={props.disabled ? -1 : 0}
        aria-disabled={props.disabled}
        onPaste={(event) => {
          const files = [...event.clipboardData.files]
          if (files.length > 0) {
            event.preventDefault()
            addFiles(files)
          }
        }}
        onDragOver={(event) => {
          event.preventDefault()
          if (!props.disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          addFiles([...event.dataTransfer.files])
        }}
        className={cn(
          'focus-visible:ring-ring rounded-lg border border-dashed p-3 outline-none focus-visible:ring-2',
          dragging && 'border-primary bg-primary/5',
          props.disabled && 'opacity-60'
        )}
      >
        <input
          ref={input}
          id={id}
          type='file'
          multiple
          accept='.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp'
          className='sr-only'
          disabled={props.disabled}
          tabIndex={-1}
          onChange={(event) => {
            addFiles([...(event.target.files ?? [])])
            event.target.value = ''
          }}
        />
        <div
          className={cn(
            'flex items-center gap-3',
            !props.compact && 'flex-wrap'
          )}
        >
          <UploadCloud
            className='text-muted-foreground size-5 shrink-0'
            aria-hidden='true'
          />
          <div className='min-w-0 flex-1'>
            <p className='text-xs'>{t('Click, paste or drop images here')}</p>
            {!props.compact && (
              <p className='text-muted-foreground mt-1 text-[11px]'>
                {t('PNG / JPG / WebP, up to 5 images, 2 MB each')}
              </p>
            )}
          </div>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={props.disabled || props.files.length >= 5}
            onClick={() => input.current?.click()}
          >
            <ImagePlus className='size-3.5' />
            {t('Add images')}
          </Button>
        </div>
        {props.files.length > 0 && (
          <div className='mt-4 flex flex-wrap gap-3'>
            {props.files.map((file) => (
              <DraftImage
                key={imageIdentity(file)}
                file={file}
                disabled={!!props.disabled}
                onRemove={() => {
                  props.onChange(props.files.filter((item) => item !== file))
                  setError('')
                }}
              />
            ))}
          </div>
        )}
      </div>
      {error && (
        <p role='alert' className='text-destructive text-xs'>
          {t(error)}
        </p>
      )}
    </div>
  )
}
