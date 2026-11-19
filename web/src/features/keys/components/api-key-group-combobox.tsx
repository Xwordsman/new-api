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
import { Check, ChevronsUpDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { GroupOptionContents } from '@/extensions/group-display/group-option'
import {
  groupAppearanceStyle,
  groupOptionSections,
  type GroupDisplayOption,
} from '@/extensions/group-display/types'
import { useMediaQuery } from '@/hooks'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import {
  AUTO_GROUP_FRAME_CLASS_NAME,
  AutoGroupFlowBorder,
} from './auto-group-visuals'

export type ApiKeyGroupOption = GroupDisplayOption

type ApiKeyGroupComboboxProps = {
  options: ApiKeyGroupOption[]
  value?: string
  onValueChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}

export function ApiKeyGroupCombobox({
  options,
  value,
  onValueChange,
  placeholder,
  disabled,
}: ApiKeyGroupComboboxProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const shouldReduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const selectedOption = options.find((option) => option.value === value)
  const isAutoSelected = selectedOption?.value === 'auto'

  const handleSelect = (selectedValue: string) => {
    onValueChange(selectedValue)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type='button'
            variant='outline'
            role='combobox'
            aria-expanded={open}
            data-auto-group-effect={isAutoSelected ? 'trigger' : undefined}
            disabled={disabled}
            style={groupAppearanceStyle(selectedOption)}
            data-border={selectedOption?.appearance?.border || undefined}
            data-tinted={selectedOption?.appearance?.background || undefined}
            data-featured={selectedOption?.appearance?.featured || undefined}
            data-reduced-motion={shouldReduceMotion || undefined}
            className={cn(
              'group-display-trigger relative h-auto min-h-18 w-full justify-between gap-2 rounded-xl px-3.5 py-3 text-start shadow-none sm:gap-3 sm:px-4',
              isAutoSelected &&
                cn(
                  AUTO_GROUP_FRAME_CLASS_NAME,
                  'hover:border-primary/55 data-popup-open:border-primary/55 data-popup-open:ring-primary/20'
                )
            )}
          />
        }
      >
        {(isAutoSelected || selectedOption?.appearance?.featured) && (
          <AutoGroupFlowBorder
            shouldReduceMotion={shouldReduceMotion}
            className={
              selectedOption?.appearance?.featured
                ? 'group-display-flow-border'
                : undefined
            }
          />
        )}
        <span className='flex min-w-0 flex-1 items-center gap-2.5'>
          {selectedOption ? (
            <GroupOptionContents
              option={selectedOption}
              shouldReduceMotion={shouldReduceMotion}
            />
          ) : (
            <span>{placeholder || t('Select a group')}</span>
          )}
        </span>
        <ChevronsUpDown
          aria-hidden='true'
          className='size-4 shrink-0 opacity-50'
        />
      </PopoverTrigger>
      <PopoverContent
        className='data-closed:zoom-out-100 data-open:zoom-in-100 data-[side=bottom]:slide-in-from-top-0 data-[side=left]:slide-in-from-right-0 data-[side=right]:slide-in-from-left-0 data-[side=top]:slide-in-from-bottom-0 w-[var(--anchor-width)] max-w-[var(--available-width)] overflow-hidden rounded-2xl p-0 shadow-lg data-closed:duration-75 data-open:duration-100'
        onWheel={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <ApiKeyGroupOptions
          options={options}
          value={value}
          onValueChange={handleSelect}
        />
      </PopoverContent>
    </Popover>
  )
}

// Both the administrator preview and the real selector use this list.
export function ApiKeyGroupOptions(
  props: Pick<ApiKeyGroupComboboxProps, 'options' | 'value' | 'onValueChange'>
) {
  const { t } = useTranslation()
  const [searchValue, setSearchValue] = useState('')
  const shouldReduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const sections = useMemo(() => {
    const search = searchValue.trim().toLowerCase()
    const filtered = props.options.filter((option) =>
      [
        option.value,
        option.label,
        option.desc,
        String(option.ratio ?? ''),
        option.category?.name,
        ...(option.appearance?.tags.map((tag) => tag.label) ?? []),
      ].some((text) => text?.toLowerCase().includes(search))
    )
    return groupOptionSections(filtered)
  }, [props.options, searchValue])
  const hasCategories = props.options.some((option) => option.category)
  return (
    <Command
      className='group-display-menu'
      label={t('Search groups')}
      shouldFilter={false}
      defaultValue={props.value}
    >
      <CommandInput
        placeholder={t('Search...')}
        aria-label={t('Search groups')}
        value={searchValue}
        onValueChange={setSearchValue}
      />
      <CommandList className='group-display-list'>
        <CommandEmpty>{t('No group found.')}</CommandEmpty>
        {sections.map((section) => {
          let heading
          if (section.category) {
            heading = (
              <span
                className='group-display-heading'
                style={groupAppearanceStyle({
                  value: section.id,
                  label: section.category.name,
                  category: section.category,
                })}
              >
                <span
                  aria-hidden='true'
                  className='group-display-category-icon'
                >
                  {section.category.icon ? (
                    getLobeIcon(section.category.icon, 16)
                  ) : (
                    <span className='size-1.5 rounded-full bg-current' />
                  )}
                </span>
                <span>{section.category.name}</span>
                <span className='bg-border h-px flex-1' aria-hidden='true' />
              </span>
            )
          } else if (hasCategories && section.id === '__other') {
            heading = (
              <span className='group-display-heading'>
                <span
                  aria-hidden='true'
                  className='bg-muted-foreground/60 size-1.5 rounded-full'
                />
                <span>{t('Other groups')}</span>
                <span className='bg-border h-px flex-1' aria-hidden='true' />
              </span>
            )
          }
          return (
            <CommandGroup
              key={section.id}
              heading={heading}
              className='group-display-section'
            >
              {section.options.map((option) => {
                const isAutoOption = option.value === 'auto'

                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    data-checked={props.value === option.value}
                    data-border={option.appearance?.border || undefined}
                    data-tinted={option.appearance?.background || undefined}
                    data-featured={option.appearance?.featured || undefined}
                    data-reduced-motion={shouldReduceMotion || undefined}
                    style={groupAppearanceStyle(option)}
                    data-auto-group-effect={isAutoOption ? 'option' : undefined}
                    onSelect={() => {
                      props.onValueChange(option.value)
                      setSearchValue('')
                    }}
                    className={cn(
                      'group-display-row group-display-frame items-center gap-2.5 rounded-[10px] [&>svg:last-child]:hidden',
                      isAutoOption &&
                        cn(
                          AUTO_GROUP_FRAME_CLASS_NAME,
                          'border-primary/35 data-[selected=true]:border-primary/55'
                        )
                    )}
                  >
                    {(isAutoOption || option.appearance?.featured) && (
                      <AutoGroupFlowBorder
                        shouldReduceMotion={shouldReduceMotion}
                        className={
                          option.appearance?.featured
                            ? 'group-display-flow-border'
                            : undefined
                        }
                      />
                    )}
                    <Check
                      aria-hidden='true'
                      className={cn(
                        'group-display-check pointer-events-none absolute left-2 size-3.5',
                        props.value === option.value
                          ? 'opacity-100'
                          : 'opacity-0'
                      )}
                    />
                    <GroupOptionContents
                      option={option}
                      shouldReduceMotion={shouldReduceMotion}
                    />
                  </CommandItem>
                )
              })}
            </CommandGroup>
          )
        })}
      </CommandList>
    </Command>
  )
}
