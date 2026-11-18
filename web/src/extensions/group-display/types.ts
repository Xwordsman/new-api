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
import type { CSSProperties } from 'react'

export type GroupCategory = {
  id: string
  name: string
  icon: string
  color: string
}

export type GroupAppearance = {
  category: string
  display_name: string
  description: string
  icon: string
  color: string
  tags: { label: string; color: string }[]
  featured: boolean
  background: boolean
  border: '' | 'solid' | 'gradient'
  gradient_to: string
  sort_order: number
}

export type GroupDisplaySettings = {
  revision: number
  categories: GroupCategory[]
  groups: Record<string, GroupAppearance>
}

export type GroupDisplayOption = {
  value: string
  label: string
  desc?: string
  ratio?: number | string
  appearance?: GroupAppearance
  category?: GroupCategory
  categoryOrder?: number
}

export const emptyAppearance: GroupAppearance = {
  category: '',
  display_name: '',
  description: '',
  icon: '',
  color: '',
  tags: [],
  featured: false,
  background: false,
  border: '',
  gradient_to: '',
  sort_order: 0,
}

export function groupAppearanceStyle(
  option?: GroupDisplayOption
): CSSProperties {
  return {
    '--group-color':
      option?.appearance?.color || option?.category?.color || 'var(--primary)',
    '--group-gradient-to': option?.appearance?.gradient_to || 'var(--primary)',
  } as CSSProperties
}

export function applyGroupAppearance(
  options: GroupDisplayOption[],
  settings?: GroupDisplaySettings
): GroupDisplayOption[] {
  if (!settings) return options
  const categories = new Map(
    settings.categories.map((category, index) => [
      category.id,
      { category, index },
    ])
  )
  return options.map((option) => {
    const appearance = Object.hasOwn(settings.groups, option.value)
      ? settings.groups[option.value]
      : undefined
    if (!appearance) return option
    const entry = categories.get(appearance.category)
    return {
      ...option,
      label: appearance.display_name || option.label,
      desc: appearance.description || option.desc,
      appearance,
      category: entry?.category,
      categoryOrder: entry?.index,
    }
  })
}

export function groupOptionSections(options: GroupDisplayOption[]) {
  const sections = new Map<
    string,
    { category?: GroupCategory; order: number; options: GroupDisplayOption[] }
  >()
  for (const option of options) {
    let id = '__other'
    if (option.category) id = `category:${option.category.id}`
    if (option.value === 'auto') id = '__auto'
    let section = sections.get(id)
    if (!section) {
      section = {
        category: option.value === 'auto' ? undefined : option.category,
        order:
          option.value === 'auto'
            ? -1
            : (option.categoryOrder ?? Number.MAX_SAFE_INTEGER),
        options: [],
      }
      sections.set(id, section)
    }
    section.options.push(option)
  }
  return [...sections.entries()]
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([id, section]) => ({
      id,
      ...section,
      options: [...section.options].sort(
        (a, b) =>
          (a.appearance?.sort_order ?? 0) - (b.appearance?.sort_order ?? 0)
      ),
    }))
}
