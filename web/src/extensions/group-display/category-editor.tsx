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
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { LobeIconField } from '@/components/lobe-icon-field'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { displaySettingsSchema } from './schema'
import type { GroupCategory } from './types'

export function CategoryEditor(props: {
  initial?: GroupCategory
  disabled: boolean
  onSave: (category: GroupCategory) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const prefix = useId()
  const [value, setValue] = useState<GroupCategory>(
    () =>
      props.initial ?? {
        id: crypto.randomUUID(),
        name: '',
        color: '#16a34a',
        icon: '',
      }
  )
  const [invalid, setInvalid] = useState(false)
  const title = props.initial ? t('Edit category') : t('Add category')
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !props.disabled) props.onClose()
      }}
      title={title}
      description={t(
        'Choose a name and color, then add existing system groups to this category.'
      )}
      contentClassName='sm:max-w-md'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            disabled={props.disabled}
            onClick={props.onClose}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='submit'
            form={`${prefix}-form`}
            disabled={props.disabled}
          >
            {props.initial ? t('Done') : t('Add category')}
          </Button>
        </>
      }
    >
      <form
        id={`${prefix}-form`}
        className='space-y-5'
        onSubmit={(event) => {
          event.preventDefault()
          const result =
            displaySettingsSchema.shape.categories.element.safeParse(value)
          if (!result.success) {
            setInvalid(true)
            return
          }
          props.onSave(result.data)
        }}
      >
        <div className='space-y-2'>
          <Label htmlFor={`${prefix}-name`}>{t('Category name')}</Label>
          <Input
            id={`${prefix}-name`}
            disabled={props.disabled}
            aria-invalid={invalid && !value.name.trim()}
            maxLength={80}
            value={value.name}
            onChange={(event) =>
              setValue({ ...value, name: event.target.value })
            }
          />
          {invalid && !value.name.trim() && (
            <p className='text-destructive text-xs'>
              {t('Enter a category name.')}
            </p>
          )}
        </div>
        <div className='space-y-2'>
          <Label htmlFor={`${prefix}-color`}>{t('Category color')}</Label>
          <Input
            id={`${prefix}-color`}
            type='color'
            className='h-10 w-20 cursor-pointer p-1'
            disabled={props.disabled}
            value={value.color || '#16a34a'}
            onChange={(event) =>
              setValue({ ...value, color: event.target.value })
            }
          />
        </div>
        <Collapsible>
          <CollapsibleTrigger
            render={
              <Button
                type='button'
                variant='ghost'
                size='sm'
                disabled={props.disabled}
              />
            }
          >
            {t('Category icon')}
          </CollapsibleTrigger>
          <CollapsibleContent className='pt-3'>
            <LobeIconField
              id={`${prefix}-icon`}
              disabled={props.disabled}
              value={value.icon}
              onChange={(icon) => setValue({ ...value, icon })}
            />
          </CollapsibleContent>
        </Collapsible>
      </form>
    </Dialog>
  )
}
