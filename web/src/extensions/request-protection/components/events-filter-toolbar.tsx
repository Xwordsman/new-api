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
import type { Table } from '@tanstack/react-table'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  LogsFilterField,
  LogsFilterInput,
  LogsFilterToolbar,
} from '@/features/usage-logs/components/logs-filter-toolbar'

import type { EventFilters, ProtectionEvent } from '../types'

export function EventsFilterToolbar(props: {
  table: Table<ProtectionEvent>
  filters: EventFilters
  hasActiveFilters: boolean
  isFetching: boolean
  onChange: (filters: EventFilters) => void
  onSearch: () => void
  onReset: () => void
}) {
  const { t } = useTranslation()
  const form = useRef<HTMLFormElement>(null)
  return (
    <form
      ref={form}
      onSubmit={(event) => {
        event.preventDefault()
        if (!props.isFetching) props.onSearch()
      }}
    >
      <LogsFilterToolbar
        table={props.table}
        hasActiveFilters={props.hasActiveFilters}
        searchLoading={props.isFetching}
        onSearch={() => form.current?.requestSubmit()}
        onReset={props.onReset}
        primaryFilters={
          <>
            {(
              [
                { name: 'user_id', label: t('User ID') },
                { name: 'token_id', label: t('Key ID') },
              ] as const
            ).map((field) => (
              <LogsFilterField key={field.name}>
                <LogsFilterInput
                  aria-label={field.label}
                  placeholder={field.label}
                  type='number'
                  min={1}
                  step={1}
                  value={props.filters[field.name]}
                  onChange={(event) =>
                    props.onChange({
                      ...props.filters,
                      [field.name]: event.target.value,
                    })
                  }
                />
              </LogsFilterField>
            ))}
            <LogsFilterField>
              <NativeSelect
                aria-label={t('Decision')}
                className='w-full'
                value={props.filters.decision}
                onChange={(event) =>
                  props.onChange({
                    ...props.filters,
                    decision: event.target.value,
                  })
                }
              >
                <NativeSelectOption value=''>
                  {t('Decision')}: {t('All')}
                </NativeSelectOption>
                <NativeSelectOption value='observe'>
                  {t('Record only')}
                </NativeSelectOption>
                <NativeSelectOption value='block'>
                  {t('Block')}
                </NativeSelectOption>
                <NativeSelectOption value='hold'>
                  {t('Safety hold pending review')}
                </NativeSelectOption>
              </NativeSelect>
            </LogsFilterField>
            <LogsFilterField>
              <NativeSelect
                aria-label={t('Review status')}
                className='w-full'
                value={props.filters.review}
                onChange={(event) =>
                  props.onChange({
                    ...props.filters,
                    review: event.target.value,
                  })
                }
              >
                <NativeSelectOption value=''>
                  {t('Review status')}: {t('All')}
                </NativeSelectOption>
                <NativeSelectOption value='pending'>
                  {t('Pending review')}
                </NativeSelectOption>
                <NativeSelectOption value='confirmed'>
                  {t('Confirmed violation')}
                </NativeSelectOption>
                <NativeSelectOption value='false_positive'>
                  {t('False positive')}
                </NativeSelectOption>
              </NativeSelect>
            </LogsFilterField>
            <LogsFilterField>
              <NativeSelect
                aria-label={t('User status')}
                className='w-full'
                value={props.filters.suspended}
                onChange={(event) =>
                  props.onChange({
                    ...props.filters,
                    suspended: event.target.value,
                  })
                }
              >
                <NativeSelectOption value=''>
                  {t('User status')}: {t('All')}
                </NativeSelectOption>
                <NativeSelectOption value='true'>
                  {t('API access paused')}
                </NativeSelectOption>
              </NativeSelect>
            </LogsFilterField>
          </>
        }
      />
      <Button
        type='submit'
        hidden
        className='hidden'
        tabIndex={-1}
        disabled={props.isFetching}
      >
        {t('Search')}
      </Button>
    </form>
  )
}
