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
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { LobeIconField } from '@/components/lobe-icon-field'
import { TagInput } from '@/components/tag-input'
import { Combobox } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import { appearanceSchema } from './schema'
import type { GroupAppearance, GroupCategory } from './types'

export function AppearanceFields(props: {
  value: GroupAppearance
  categories: GroupCategory[]
  onChange: (value: GroupAppearance) => void
  disabled?: boolean
  showErrors?: boolean
}) {
  const { t } = useTranslation()
  const prefix = useId()
  const value = props.value
  const patch = (update: Partial<GroupAppearance>) =>
    props.onChange({ ...value, ...update })
  const validation = appearanceSchema.safeParse(value)
  const errors = props.showErrors ? validation.error?.issues : undefined
  return (
    <div className='space-y-5'>
      <div className='grid gap-4 sm:grid-cols-2'>
        <div className='space-y-2'>
          <Label htmlFor={`${prefix}-name`}>{t('Display name')}</Label>
          <Input
            id={`${prefix}-name`}
            value={value.display_name}
            maxLength={120}
            onChange={(event) => patch({ display_name: event.target.value })}
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor={`${prefix}-category`}>{t('Display category')}</Label>
          <Combobox
            disabled={props.disabled}
            id={`${prefix}-category`}
            value={value.category}
            options={[
              { value: '', label: t('Other groups') },
              ...props.categories.map((category) => ({
                value: category.id,
                label: category.name,
              })),
            ]}
            onValueChange={(category) => patch({ category: category ?? '' })}
          />
        </div>
      </div>
      <div className='space-y-2'>
        <Label htmlFor={`${prefix}-description`}>
          {t('Short description')}
        </Label>
        <Textarea
          id={`${prefix}-description`}
          value={value.description}
          maxLength={600}
          onChange={(event) => patch({ description: event.target.value })}
        />
      </div>
      <div className='space-y-2'>
        <Label htmlFor={`${prefix}-icon`}>{t('Group icon')}</Label>
        <LobeIconField
          disabled={props.disabled}
          id={`${prefix}-icon`}
          value={value.icon}
          onChange={(icon) => patch({ icon })}
        />
        <p className='text-muted-foreground text-xs'>
          {t('Leave the icon or color empty to inherit from the category.')}
        </p>
      </div>
      <div className='grid gap-4 sm:grid-cols-2'>
        <div className='space-y-2'>
          <Label htmlFor={`${prefix}-color`}>{t('Accent color')}</Label>
          <Input
            aria-invalid={errors?.some((issue) => issue.path[0] === 'color')}
            id={`${prefix}-color`}
            value={value.color}
            placeholder='#16a34a'
            maxLength={7}
            onChange={(event) => patch({ color: event.target.value })}
          />
          {errors?.some((issue) => issue.path[0] === 'color') && (
            <p className='text-destructive text-xs'>
              {t('Use a hex color such as #16a34a, or leave it empty.')}
            </p>
          )}
        </div>
        <div className='space-y-2'>
          <Label htmlFor={`${prefix}-order`}>
            {t('Order within category')}
          </Label>
          <Input
            aria-invalid={errors?.some(
              (issue) => issue.path[0] === 'sort_order'
            )}
            id={`${prefix}-order`}
            type='number'
            min={0}
            max={100000}
            value={value.sort_order}
            onChange={(event) =>
              patch({ sort_order: Number(event.target.value) })
            }
          />
          {errors?.some((issue) => issue.path[0] === 'sort_order') && (
            <p className='text-destructive text-xs'>
              {t('Enter a whole number from 0 to 100000.')}
            </p>
          )}
        </div>
        <div className='space-y-2'>
          <Label htmlFor={`${prefix}-border`}>{t('Border style')}</Label>
          <Combobox
            disabled={props.disabled}
            id={`${prefix}-border`}
            value={value.border}
            options={[
              { value: '', label: t('None') },
              { value: 'solid', label: t('Solid') },
              { value: 'gradient', label: t('Gradient') },
            ]}
            onValueChange={(border) =>
              patch({ border: (border ?? '') as GroupAppearance['border'] })
            }
          />
        </div>
        {value.border === 'gradient' && (
          <div className='space-y-2'>
            <Label htmlFor={`${prefix}-gradient`}>
              {t('Gradient end color')}
            </Label>
            <Input
              aria-invalid={errors?.some(
                (issue) => issue.path[0] === 'gradient_to'
              )}
              id={`${prefix}-gradient`}
              value={value.gradient_to}
              placeholder='#38bdf8'
              maxLength={7}
              onChange={(event) => patch({ gradient_to: event.target.value })}
            />
            {errors?.some((issue) => issue.path[0] === 'gradient_to') && (
              <p className='text-destructive text-xs'>
                {t('Use a hex color such as #16a34a, or leave it empty.')}
              </p>
            )}
          </div>
        )}
      </div>
      <div className='flex flex-wrap gap-6'>
        <Label
          className='flex items-center gap-2'
          htmlFor={`${prefix}-featured`}
        >
          <Switch
            disabled={props.disabled}
            id={`${prefix}-featured`}
            checked={value.featured}
            onCheckedChange={(featured) => patch({ featured })}
          />
          {t('Featured')}
        </Label>
        <Label
          className='flex items-center gap-2'
          htmlFor={`${prefix}-background`}
        >
          <Switch
            disabled={props.disabled}
            id={`${prefix}-background`}
            checked={value.background}
            onCheckedChange={(background) => patch({ background })}
          />
          {t('Tinted background')}
        </Label>
      </div>
      <div className='space-y-3'>
        <Label htmlFor={`${prefix}-tags`}>{t('Tags')}</Label>
        <TagInput
          id={`${prefix}-tags`}
          disabled={props.disabled}
          value={value.tags.map((tag) => tag.label)}
          maxTags={6}
          maxLength={32}
          onChange={(labels) =>
            patch({
              tags: labels.map(
                (label) =>
                  value.tags.find((tag) => tag.label === label) ?? {
                    label,
                    color: '',
                  }
              ),
            })
          }
        />
        <p className='text-muted-foreground text-xs'>
          {t(
            'Press Enter to add up to six tags. Empty tag colors use the group accent.'
          )}
        </p>
        <div className='grid gap-3 sm:grid-cols-2'>
          {value.tags.map((tag, index) => (
            <div key={tag.label} className='space-y-1'>
              <Label htmlFor={`${prefix}-tag-color-${index}`}>
                {t('Color for {{tag}}', { tag: tag.label })}
              </Label>
              <Input
                aria-invalid={errors?.some(
                  (issue) =>
                    issue.path[0] === 'tags' &&
                    issue.path[1] === index &&
                    issue.path[2] === 'color'
                )}
                id={`${prefix}-tag-color-${index}`}
                maxLength={7}
                value={tag.color}
                placeholder='#16a34a'
                onChange={(event) =>
                  patch({
                    tags: value.tags.map((item, i) =>
                      i === index
                        ? { ...item, color: event.target.value }
                        : item
                    ),
                  })
                }
              />
              {errors?.some(
                (issue) =>
                  issue.path[0] === 'tags' &&
                  issue.path[1] === index &&
                  issue.path[2] === 'color'
              ) && (
                <p className='text-destructive text-xs'>
                  {t('Use a hex color such as #16a34a, or leave it empty.')}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
