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
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { TagInput } from '@/components/tag-input'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { getLobeIcon } from '@/lib/lobe-icon'

import {
  emptyAppearance,
  type GroupAppearance,
  type GroupCategory,
  type GroupDisplayOption,
  type GroupDisplaySettings,
} from './types'

export function GroupAppearanceTable(props: {
  options: GroupDisplayOption[]
  settings: GroupDisplaySettings
  vendors: GroupCategory[]
  disabled: boolean
  onChange: (group: string, value: GroupAppearance) => void
  onVendorChange: (group: string, category: string) => void
  onAdvanced: (group: string) => void
}) {
  const { t } = useTranslation()
  const rows = props.options.map((option) => ({
    ...option,
    appearance: Object.hasOwn(props.settings.groups, option.value)
      ? props.settings.groups[option.value]
      : emptyAppearance,
  }))
  return (
    <StaticDataTable
      className='overflow-x-auto'
      tableClassName='min-w-[1180px]'
      tableProps={{
        'aria-label': t('API key group appearance'),
        withContainer: false,
      }}
      containerProps={{
        role: 'region',
        tabIndex: 0,
        'aria-label': t('API key group appearance'),
      }}
      data={rows}
      getRowKey={(row) => row.value}
      emptyContent={
        <EmptyState
          className='min-h-40'
          title={t('No groups yet. Add a group to get started.')}
        />
      }
      columns={[
        {
          id: 'group',
          header: t('Group name'),
          className: 'w-32',
          cell: (row) => (
            <span
              className='block max-w-40 truncate font-mono text-xs'
              title={row.value}
            >
              {row.value}
            </span>
          ),
        },
        {
          id: 'vendor',
          header: t('Vendor'),
          className: 'w-44',
          cell: (row) => (
            <Combobox
              aria-label={t('Vendor')}
              disabled={props.disabled}
              className='min-w-36'
              value={row.appearance.category}
              showSelectedIcon
              options={[
                { value: '', label: t('Other groups') },
                ...props.vendors.map((vendor) => ({
                  value: vendor.id,
                  label: vendor.name,
                  icon: getLobeIcon(vendor.icon, 16),
                  disabled:
                    props.settings.categories.length >= 64 &&
                    !props.settings.categories.some(
                      (category) => category.id === vendor.id
                    ),
                })),
              ]}
              onValueChange={(value) =>
                props.onVendorChange(row.value, value ?? '')
              }
            />
          ),
        },
        {
          id: 'name',
          header: t('Display name'),
          className: 'w-44',
          cell: (row) => (
            <Input
              aria-label={t('Display name')}
              className='min-w-36'
              placeholder={row.label}
              maxLength={120}
              value={row.appearance.display_name}
              onChange={(event) =>
                props.onChange(row.value, {
                  ...row.appearance,
                  display_name: event.target.value,
                })
              }
            />
          ),
        },
        {
          id: 'description',
          header: t('Short description'),
          className: 'min-w-52',
          cell: (row) => (
            <Input
              aria-label={t('Short description')}
              placeholder={row.desc || t('Short description')}
              maxLength={600}
              value={row.appearance.description}
              onChange={(event) =>
                props.onChange(row.value, {
                  ...row.appearance,
                  description: event.target.value,
                })
              }
            />
          ),
        },
        {
          id: 'tags',
          header: t('Tags'),
          className: 'w-52',
          cell: (row) => (
            <div className='min-w-44'>
              <Label className='sr-only' htmlFor={`group-tags-${row.value}`}>
                {t('Tags')}
              </Label>
              <TagInput
                id={`group-tags-${row.value}`}
                disabled={props.disabled}
                value={row.appearance.tags.map((tag) => tag.label)}
                maxTags={6}
                maxLength={32}
                onChange={(labels) =>
                  props.onChange(row.value, {
                    ...row.appearance,
                    tags: labels.map(
                      (label) =>
                        row.appearance.tags.find(
                          (tag) => tag.label === label
                        ) ?? { label, color: '' }
                    ),
                  })
                }
              />
            </div>
          ),
        },
        {
          id: 'featured',
          header: t('Featured'),
          className: 'w-16 text-center',
          cell: (row) => (
            <div className='flex justify-center'>
              <Switch
                aria-label={t('Featured')}
                disabled={props.disabled}
                checked={row.appearance.featured}
                onCheckedChange={(featured) =>
                  props.onChange(row.value, { ...row.appearance, featured })
                }
              />
            </div>
          ),
        },
        {
          id: 'style',
          header: t('Style'),
          className: 'w-40',
          cell: (row) => {
            let style = 'custom'
            if (!row.appearance.border && !row.appearance.background) {
              style = 'plain'
            }
            if (
              row.appearance.border === 'solid' &&
              !row.appearance.background
            ) {
              style = 'outline'
            }
            if (
              row.appearance.border === 'gradient' &&
              row.appearance.background
            ) {
              style = 'highlight'
            }
            return (
              <Combobox
                aria-label={t('Style')}
                disabled={props.disabled}
                className='min-w-32'
                value={style}
                options={[
                  { value: 'plain', label: t('Default style') },
                  { value: 'outline', label: t('Colored border') },
                  { value: 'highlight', label: t('Gradient highlight') },
                  ...(style === 'custom'
                    ? [
                        {
                          value: 'custom',
                          label: t('Custom style'),
                          disabled: true,
                        },
                      ]
                    : []),
                ]}
                onValueChange={(value) => {
                  if (!value || value === 'custom') return
                  let border: GroupAppearance['border'] = ''
                  if (value === 'outline') border = 'solid'
                  if (value === 'highlight') border = 'gradient'
                  props.onChange(row.value, {
                    ...row.appearance,
                    border,
                    background: value === 'highlight',
                    gradient_to:
                      value === 'highlight'
                        ? row.appearance.gradient_to || '#a78bfa'
                        : '',
                  })
                }}
              />
            )
          },
        },
        {
          id: 'advanced',
          header: t('More'),
          className: 'w-16 text-right',
          cell: (row) => (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              disabled={props.disabled}
              onClick={() => props.onAdvanced(row.value)}
            >
              {t('More')}
            </Button>
          ),
        },
      ]}
    />
  )
}
