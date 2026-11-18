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
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { LobeIconField } from '@/components/lobe-icon-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import type { GroupCategory } from './types'

export function CategoryEditor(props: {
  categories: GroupCategory[]
  onChange: (categories: GroupCategory[]) => void
  onRemove: (id: string) => void
  showErrors?: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const prefix = useId()
  const move = (index: number, offset: number) => {
    const categories = [...props.categories]
    ;[categories[index], categories[index + offset]] = [
      categories[index + offset],
      categories[index],
    ]
    props.onChange(categories)
  }
  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h3 className='font-medium'>{t('Display categories')}</h3>
        <Button
          type='button'
          size='sm'
          variant='outline'
          disabled={props.categories.length >= 64}
          onClick={() =>
            props.onChange([
              ...props.categories,
              { id: crypto.randomUUID(), name: '', icon: '', color: '' },
            ])
          }
        >
          {t('Add category')}
        </Button>
      </div>
      {props.categories.map((category, index) => (
        <div key={category.id} className='space-y-3 rounded-lg border p-3'>
          <div className='flex flex-wrap items-end gap-2'>
            <div className='min-w-32 flex-1 space-y-2'>
              <Label htmlFor={`${prefix}-${category.id}-name`}>
                {t('Category name')}
              </Label>
              <Input
                aria-invalid={props.showErrors && !category.name.trim()}
                id={`${prefix}-${category.id}-name`}
                value={category.name}
                maxLength={80}
                onChange={(event) =>
                  props.onChange(
                    props.categories.map((item) =>
                      item.id === category.id
                        ? { ...item, name: event.target.value }
                        : item
                    )
                  )
                }
              />
              {props.showErrors && !category.name.trim() && (
                <p className='text-destructive text-xs'>
                  {t('Enter a category name.')}
                </p>
              )}
            </div>
            <div className='w-28 space-y-2'>
              <Label htmlFor={`${prefix}-${category.id}-color`}>
                {t('Accent color')}
              </Label>
              <Input
                aria-invalid={
                  props.showErrors &&
                  !/^$|^#[0-9a-fA-F]{6}$/.test(category.color)
                }
                id={`${prefix}-${category.id}-color`}
                value={category.color}
                placeholder='#16a34a'
                maxLength={7}
                onChange={(event) =>
                  props.onChange(
                    props.categories.map((item) =>
                      item.id === category.id
                        ? { ...item, color: event.target.value }
                        : item
                    )
                  )
                }
              />
              {props.showErrors &&
                !/^$|^#[0-9a-fA-F]{6}$/.test(category.color) && (
                  <p className='text-destructive text-xs'>
                    {t('Use a hex color such as #16a34a, or leave it empty.')}
                  </p>
                )}
            </div>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              disabled={index === 0}
              aria-label={t('Move {{name}} up', { name: category.name })}
              onClick={() => move(index, -1)}
            >
              <ArrowUp className='size-4' />
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              disabled={index === props.categories.length - 1}
              aria-label={t('Move {{name}} down', { name: category.name })}
              onClick={() => move(index, 1)}
            >
              <ArrowDown className='size-4' />
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              aria-label={t('Remove category {{name}}', {
                name: category.name,
              })}
              onClick={() => props.onRemove(category.id)}
            >
              <Trash2 className='size-4' />
            </Button>
          </div>
          <div className='space-y-2'>
            <Label htmlFor={`${prefix}-${category.id}-icon`}>
              {t('Category icon')}
            </Label>
            <LobeIconField
              disabled={props.disabled}
              id={`${prefix}-${category.id}-icon`}
              value={category.icon}
              onChange={(icon) =>
                props.onChange(
                  props.categories.map((item) =>
                    item.id === category.id ? { ...item, icon } : item
                  )
                )
              }
            />
          </div>
        </div>
      ))}
    </div>
  )
}
