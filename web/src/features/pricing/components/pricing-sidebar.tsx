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
import { ChevronDown, RotateCcw } from 'lucide-react'
import { memo, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import {
  ENDPOINT_TYPES,
  FILTER_ALL,
  QUOTA_TYPES,
  getEndpointTypeLabels,
  getQuotaTypeLabels,
} from '../constants'
import { getModelQuotaType, parseTags } from '../lib/filters'
import type { PricingModel, PricingVendor } from '../types'

type FilterOption = {
  value: string
  label: string
  count?: number
  suffix?: string
  icon?: ReactNode
}

type FilterSectionProps = {
  title: string
  value: string
  options: FilterOption[]
  onChange: (value: string) => void
}

export interface PricingSidebarProps {
  quotaTypeFilter: string
  endpointTypeFilter: string
  vendorFilter: string
  groupFilter: string
  tagFilter: string
  onQuotaTypeChange: (value: string) => void
  onEndpointTypeChange: (value: string) => void
  onVendorChange: (value: string) => void
  onGroupChange: (value: string) => void
  onTagChange: (value: string) => void
  vendors: PricingVendor[]
  groups: string[]
  groupRatios?: Record<string, number>
  tags: string[]
  models: PricingModel[]
  hasActiveFilters: boolean
  onClearFilters: () => void
  className?: string
}

function formatGroupRatio(ratio: number | undefined): string | undefined {
  if (ratio == null) return undefined
  const formatted = Number.isInteger(ratio)
    ? ratio.toString()
    : ratio.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  return `×${formatted}`
}

function FilterRow(props: {
  option: FilterOption
  active: boolean
  onClick: () => void
}) {
  const { i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  return (
    <Button
      type='button'
      variant='ghost'
      size='sm'
      onClick={props.onClick}
      aria-pressed={props.active}
      className='pricing-filter-row h-auto w-full justify-start gap-2.5 px-3 py-2.5 text-sm'
      title={props.option.label}
    >
      {props.option.icon && (
        <span className='shrink-0'>{props.option.icon}</span>
      )}
      <span className='min-w-0 truncate'>{props.option.label}</span>
      <span className='ml-auto flex shrink-0 items-center gap-2 text-xs tabular-nums'>
        {props.option.suffix && (
          <span className='pricing-filter-ratio'>{props.option.suffix}</span>
        )}
        {props.option.count != null && (
          <span className='pricing-filter-count'>
            {formatNumber(props.option.count, locale)}
          </span>
        )}
      </span>
    </Button>
  )
}

function FilterSection(props: FilterSectionProps) {
  return (
    <Collapsible
      defaultOpen
      className='border-border/60 border-b pb-4 last:border-b-0'
    >
      <CollapsibleTrigger className='group focus-visible:outline-ring flex w-full items-center justify-between gap-2 rounded-sm px-3 py-3 text-left focus-visible:outline-2'>
        <span className='text-foreground/80 text-xs font-semibold'>
          {props.title}
        </span>
        <ChevronDown
          aria-hidden
          className='text-muted-foreground/60 size-3.5 transition-transform group-data-[panel-open]:rotate-180'
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className='flex flex-col gap-1'>
          {props.options.map((option) => (
            <FilterRow
              key={option.value}
              option={option}
              active={props.value === option.value}
              onClick={() => props.onChange(option.value)}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export const PricingSidebar = memo(function PricingSidebar(
  props: PricingSidebarProps
) {
  const { t } = useTranslation()
  const counts = useMemo(() => {
    const vendors = new Map<string, number>()
    const tags = new Map<string, number>()
    const endpoints = new Map<string, number>()
    const groups = new Map<string, number>()
    const quotas = { token: 0, request: 0, task: 0 }
    for (const model of props.models) {
      if (model.vendor_name) {
        vendors.set(
          model.vendor_name,
          (vendors.get(model.vendor_name) ?? 0) + 1
        )
      }
      for (const tag of new Set(
        parseTags(model.tags).map((tag) => tag.toLowerCase())
      )) {
        tags.set(tag, (tags.get(tag) ?? 0) + 1)
      }
      for (const endpoint of new Set(model.supported_endpoint_types ?? [])) {
        endpoints.set(endpoint, (endpoints.get(endpoint) ?? 0) + 1)
      }
      for (const group of new Set(model.enable_groups ?? [])) {
        groups.set(group, (groups.get(group) ?? 0) + 1)
      }
      const quotaType = getModelQuotaType(model)
      if (quotaType) quotas[quotaType]++
    }
    return { vendors, tags, endpoints, groups, quotas }
  }, [props.models])
  const quotaTypeLabels = getQuotaTypeLabels(t)
  const endpointTypeLabels = getEndpointTypeLabels(t)

  const vendorOptions: FilterOption[] = [
    {
      value: FILTER_ALL,
      label: t('All Vendors'),
      count: props.models.length,
    },
    ...props.vendors
      .map((vendor) => ({
        value: vendor.name,
        label: vendor.name,
        count: counts.vendors.get(vendor.name) ?? 0,
        icon: vendor.icon ? getLobeIcon(vendor.icon, 17) : undefined,
      }))
      .filter((vendor) => vendor.count > 0),
  ]

  const groupOptions: FilterOption[] = [
    {
      value: FILTER_ALL,
      label: t('All Groups'),
      count: props.models.length,
    },
    ...props.groups.map((group) => ({
      value: group,
      label: group,
      suffix: formatGroupRatio(props.groupRatios?.[group]),
      count: counts.groups.get(group) ?? 0,
    })),
  ]

  const quotaOptions: FilterOption[] = [
    {
      value: QUOTA_TYPES.ALL,
      label: quotaTypeLabels[QUOTA_TYPES.ALL],
      count: props.models.length,
    },
    {
      value: QUOTA_TYPES.TOKEN,
      label: quotaTypeLabels[QUOTA_TYPES.TOKEN],
      count: counts.quotas.token,
    },
    {
      value: QUOTA_TYPES.REQUEST,
      label: quotaTypeLabels[QUOTA_TYPES.REQUEST],
      count: counts.quotas.request,
    },
    {
      value: QUOTA_TYPES.TASK,
      label: quotaTypeLabels[QUOTA_TYPES.TASK],
      count: counts.quotas.task,
    },
  ]

  const tagOptions: FilterOption[] = [
    {
      value: FILTER_ALL,
      label: t('All Tags'),
      count: props.models.length,
    },
    ...props.tags.map((tag) => ({
      value: tag,
      label: tag,
      count: counts.tags.get(tag.toLowerCase()) ?? 0,
    })),
  ]

  const endpointOptions: FilterOption[] = [
    {
      value: ENDPOINT_TYPES.ALL,
      label: endpointTypeLabels[ENDPOINT_TYPES.ALL],
      count: props.models.length,
    },
    ...Object.entries(endpointTypeLabels)
      .filter(([value]) => value !== ENDPOINT_TYPES.ALL)
      .map(([value, label]) => ({
        value,
        label,
        count: counts.endpoints.get(value) ?? 0,
      })),
  ]

  return (
    <aside className={cn('pricing-sidebar min-w-0', props.className)}>
      <div className='mb-1 flex items-center justify-between gap-2 px-3'>
        <h2 className='text-foreground text-sm font-semibold'>{t('Filter')}</h2>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={props.onClearFilters}
          disabled={!props.hasActiveFilters}
          className='h-7 gap-1.5 px-2 text-xs'
        >
          <RotateCcw className='size-3' aria-hidden />
          {t('Reset')}
        </Button>
      </div>

      <div className='space-y-2'>
        <FilterSection
          title={t('Groups')}
          value={props.groupFilter}
          options={groupOptions}
          onChange={props.onGroupChange}
        />
        <FilterSection
          title={t('Model providers')}
          value={props.vendorFilter}
          options={vendorOptions}
          onChange={props.onVendorChange}
        />
        <FilterSection
          title={t('Model Tags')}
          value={props.tagFilter}
          options={tagOptions}
          onChange={props.onTagChange}
        />
        <FilterSection
          title={t('Pricing Type')}
          value={props.quotaTypeFilter}
          options={quotaOptions}
          onChange={props.onQuotaTypeChange}
        />
        <FilterSection
          title={t('Endpoint Type')}
          value={props.endpointTypeFilter}
          options={endpointOptions}
          onChange={props.onEndpointTypeChange}
        />
      </div>
    </aside>
  )
})
