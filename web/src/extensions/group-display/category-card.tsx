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
import { ArrowDown, ArrowUp, Folder, Pencil, Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { MultiSelect } from '@/components/multi-select'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { AutoGroupFlowBorder } from '@/features/keys/components/auto-group-visuals'
import { useMediaQuery } from '@/hooks'
import { getLobeIcon } from '@/lib/lobe-icon'

import { AppearanceFields } from './appearance-fields'
import { GroupOptionContents } from './group-option'
import {
  emptyAppearance,
  groupAppearanceStyle,
  type GroupAppearance,
  type GroupCategory,
  type GroupDisplayOption,
} from './types'

export function CategoryCard(props: {
  category: GroupCategory
  options: GroupDisplayOption[]
  available: GroupDisplayOption[]
  disabled: boolean
  first: boolean
  last: boolean
  onEdit: () => void
  onRemove: () => void
  onMove: (offset: number) => void
  onAdd: (groups: string[]) => void
  onChange: (group: string, appearance: GroupAppearance) => void
}) {
  const { t } = useTranslation()
  const heading = useId()
  const [adding, setAdding] = useState(false)
  const shouldReduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  return (
    <section
      aria-labelledby={heading}
      className='group-display-category bg-card min-w-0 rounded-xl border'
      style={groupAppearanceStyle({
        value: props.category.id,
        label: props.category.name,
        category: props.category,
      })}
    >
      <div className='group-display-category-header flex flex-wrap items-center justify-between gap-3 rounded-t-xl border-b p-4'>
        <h3
          id={heading}
          className='flex min-w-0 items-center gap-2.5 font-semibold'
        >
          <span className='group-display-icon' aria-hidden='true'>
            {props.category.icon ? (
              getLobeIcon(props.category.icon, 18)
            ) : (
              <Folder />
            )}
          </span>
          <span className='break-all'>{props.category.name}</span>
        </h3>
        <div className='flex flex-wrap items-center gap-1'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={props.disabled || props.available.length === 0}
            onClick={() => setAdding(true)}
          >
            <Plus aria-hidden='true' className='size-4' />
            {t('Add system groups')}
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='icon-sm'
            disabled={props.disabled}
            aria-label={t('Edit category {{name}}', {
              name: props.category.name,
            })}
            onClick={props.onEdit}
          >
            <Pencil aria-hidden='true' className='size-4' />
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='icon-sm'
            disabled={props.disabled || props.first}
            aria-label={t('Move {{name}} up', { name: props.category.name })}
            onClick={() => props.onMove(-1)}
          >
            <ArrowUp aria-hidden='true' className='size-4' />
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='icon-sm'
            disabled={props.disabled || props.last}
            aria-label={t('Move {{name}} down', { name: props.category.name })}
            onClick={() => props.onMove(1)}
          >
            <ArrowDown aria-hidden='true' className='size-4' />
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='icon-sm'
            disabled={props.disabled}
            aria-label={t('Remove category {{name}}', {
              name: props.category.name,
            })}
            onClick={props.onRemove}
          >
            <Trash2 aria-hidden='true' className='size-4' />
          </Button>
        </div>
      </div>
      {props.options.length === 0 ? (
        <p className='text-muted-foreground p-5 text-sm'>
          {t('No groups in this category. Add existing system groups above.')}
        </p>
      ) : (
        <Accordion className='gap-2 p-3' disabled={props.disabled}>
          {props.options.map((option) => (
            <AccordionItem
              key={option.value}
              value={option.value}
              className='rounded-lg border!'
            >
              <AccordionTrigger
                aria-label={t('Configure group {{group}}', {
                  group: option.value,
                })}
                className='group-display-frame items-center gap-3 rounded-lg p-3 hover:no-underline'
                style={groupAppearanceStyle(option)}
                data-featured={option.appearance?.featured || undefined}
                data-reduced-motion={shouldReduceMotion || undefined}
                data-border={option.appearance?.border || undefined}
                data-tinted={option.appearance?.background || undefined}
              >
                {option.appearance?.featured && (
                  <AutoGroupFlowBorder
                    shouldReduceMotion={shouldReduceMotion}
                    className='group-display-flow-border'
                  />
                )}
                <GroupOptionContents
                  option={option}
                  shouldReduceMotion={shouldReduceMotion}
                />
              </AccordionTrigger>
              <AccordionContent className='px-4 pt-3 pb-4'>
                <p className='text-muted-foreground mb-4 text-xs'>
                  {t('System group')}:{' '}
                  <span className='font-mono break-all'>{option.value}</span>
                </p>
                <AppearanceFields
                  value={option.appearance ?? emptyAppearance}
                  placeholder={option.value}
                  disabled={props.disabled}
                  onChange={(appearance) =>
                    props.onChange(option.value, appearance)
                  }
                />
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  className='text-muted-foreground mt-3'
                  disabled={props.disabled}
                  onClick={() =>
                    props.onChange(option.value, {
                      ...(option.appearance ?? emptyAppearance),
                      category: '',
                    })
                  }
                >
                  {t('Remove from category')}
                </Button>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
      {adding && (
        <AddCategoryGroupsDialog
          category={props.category}
          options={props.available}
          disabled={props.disabled}
          onClose={() => setAdding(false)}
          onAdd={(groups) => {
            props.onAdd(groups)
            setAdding(false)
          }}
        />
      )}
    </section>
  )
}

function AddCategoryGroupsDialog(props: {
  category: GroupCategory
  options: GroupDisplayOption[]
  disabled: boolean
  onClose: () => void
  onAdd: (groups: string[]) => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const [selected, setSelected] = useState<string[]>([])
  const available = new Set(props.options.map((option) => option.value))
  const valid = selected.filter((group) => available.has(group))
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t('Add groups to {{name}}', { name: props.category.name })}
      description={t(
        'Select existing system groups. Each group belongs to one category.'
      )}
      contentClassName='sm:max-w-lg'
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
            type='button'
            disabled={props.disabled || valid.length === 0}
            onClick={() => props.onAdd(valid)}
          >
            {t('Add selected groups')}
          </Button>
        </>
      }
    >
      <div className='space-y-2'>
        <Label htmlFor={id}>{t('System groups')}</Label>
        <MultiSelect
          id={id}
          aria-label={t('System groups')}
          allowCreate={false}
          disabled={props.disabled}
          options={props.options.map((option) => ({
            value: option.value,
            label: option.value,
          }))}
          selected={selected}
          onChange={setSelected}
          placeholder={t('Select system groups')}
          maxVisibleChips={4}
        />
      </div>
    </Dialog>
  )
}
