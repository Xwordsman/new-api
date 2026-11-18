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

import { TagInput } from '@/components/tag-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

import type { GroupAppearance } from './types'

export function AppearanceFields(props: {
  value: GroupAppearance
  placeholder: string
  onChange: (value: GroupAppearance) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const prefix = useId()
  const value = props.value
  return (
    <div className='space-y-4'>
      <div className='grid gap-4 sm:grid-cols-2'>
        <div className='space-y-2'>
          <Label htmlFor={`${prefix}-name`}>{t('Display name')}</Label>
          <Input
            id={`${prefix}-name`}
            disabled={props.disabled}
            placeholder={props.placeholder}
            value={value.display_name}
            maxLength={120}
            onChange={(event) =>
              props.onChange({ ...value, display_name: event.target.value })
            }
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor={`${prefix}-description`}>
            {t('Short description')}
          </Label>
          <Input
            id={`${prefix}-description`}
            disabled={props.disabled}
            value={value.description}
            maxLength={600}
            onChange={(event) =>
              props.onChange({ ...value, description: event.target.value })
            }
          />
        </div>
      </div>
      <div className='space-y-2'>
        <Label htmlFor={`${prefix}-tags`}>{t('Tags')}</Label>
        <TagInput
          id={`${prefix}-tags`}
          disabled={props.disabled}
          maxTags={6}
          maxLength={32}
          value={value.tags.map((tag) => tag.label)}
          onChange={(labels) =>
            props.onChange({
              ...value,
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
      </div>
      <div className='bg-muted/40 flex items-center justify-between gap-4 rounded-lg border p-3'>
        <div className='space-y-1'>
          <Label htmlFor={`${prefix}-featured`}>{t('Featured')}</Label>
          <p
            id={`${prefix}-featured-help`}
            className='text-muted-foreground text-xs'
          >
            {t(
              'Automatically adds a featured icon, a glowing gradient border and an animated gradient name.'
            )}
          </p>
        </div>
        <Switch
          id={`${prefix}-featured`}
          aria-describedby={`${prefix}-featured-help`}
          disabled={props.disabled}
          checked={value.featured}
          onCheckedChange={(featured) => props.onChange({ ...value, featured })}
        />
      </div>
    </div>
  )
}
