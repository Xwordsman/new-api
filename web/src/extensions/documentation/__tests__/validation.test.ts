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
import { expect, it } from 'vitest'

import { documentationSettingsSchema } from '../lib/schema'
import type { DocumentationSettings } from '../types'

function settings(): DocumentationSettings {
  return {
    revision: 1,
    enabled: true,
    title: 'Developer guides',
    description: '',
    categories: [
      { id: 'start', title: 'Getting started', description: '', sort_order: 0 },
    ],
    articles: [
      {
        id: 'first',
        category_id: 'start',
        slug: 'first',
        title: 'First guide',
        description: '',
        content: '# First guide',
        status: 'published',
        sort_order: 0,
        updated_at: 0,
      },
    ],
  }
}

it('allows saving an empty draft but requires nonblank content before publishing', () => {
  const value = settings()
  value.articles[0].status = 'draft'
  value.articles[0].content = ''
  expect(documentationSettingsSchema.safeParse(value).success).toBe(true)
  value.articles[0].status = 'published'
  value.articles[0].content = ' \n\t '
  const result = documentationSettingsSchema.safeParse(value)
  expect(result.success).toBe(false)
  if (!result.success) {
    expect(result.error.issues[0].path).toEqual(['articles', 0, 'content'])
  }
})

it('applies the article limit to UTF-8 bytes rather than JavaScript string length', () => {
  const value = settings()
  value.articles[0].content = '中'.repeat(43690)
  expect(documentationSettingsSchema.safeParse(value).success).toBe(true)
  value.articles[0].content += '中'
  expect(documentationSettingsSchema.safeParse(value).success).toBe(false)
})

it('counts title limits in Unicode characters for settings, categories and articles', () => {
  const value = settings()
  value.title = '📖'.repeat(120)
  value.categories[0].title = '中'.repeat(120)
  value.articles[0].title = '📖'.repeat(160)
  expect(documentationSettingsSchema.safeParse(value).success).toBe(true)
  value.title += 'x'
  value.categories[0].title += 'x'
  value.articles[0].title += 'x'
  const result = documentationSettingsSchema.safeParse(value)
  expect(result.success).toBe(false)
  if (!result.success) {
    expect(result.error.issues.map((issue) => issue.path)).toEqual([
      ['title'],
      ['categories', 0, 'title'],
      ['articles', 0, 'title'],
    ])
  }
})

it('rejects descriptions beyond the server limit', () => {
  const value = settings()
  value.description = '中'.repeat(600)
  expect(documentationSettingsSchema.safeParse(value).success).toBe(true)
  value.description += '中'
  expect(documentationSettingsSchema.safeParse(value).success).toBe(false)
})

it('accepts server-supported addresses and rejects duplicate addresses or missing categories', () => {
  const value = settings()
  value.articles[0].slug = 'first--guide-'
  expect(documentationSettingsSchema.safeParse(value).success).toBe(true)
  value.articles.push({
    ...value.articles[0],
    id: 'second',
    category_id: 'missing',
  })
  const result = documentationSettingsSchema.safeParse(value)
  expect(result.success).toBe(false)
  if (!result.success) {
    expect(result.error.issues.map((issue) => issue.path)).toEqual([
      ['articles', 1, 'category_id'],
      ['articles', 1, 'slug'],
    ])
  }
})

it('limits the catalog to 64 categories', () => {
  const value = settings()
  value.categories.push(
    ...Array.from({ length: 63 }, (_, index) => ({
      id: `extra-${index}`,
      title: 'Extra category',
      description: '',
      sort_order: index + 1,
    }))
  )
  expect(documentationSettingsSchema.safeParse(value).success).toBe(true)
  value.categories.push({
    id: 'overflow',
    title: 'Overflow',
    description: '',
    sort_order: 64,
  })
  expect(documentationSettingsSchema.safeParse(value).success).toBe(false)
})

it('rejects a catalog whose server-encoded JSON exceeds 4 MB including escaped HTML', () => {
  const value = settings()
  const article = value.articles[0]
  value.articles = Array.from({ length: 18 }, (_, index) => ({
    ...article,
    id: `guide-${index}`,
    slug: `guide-${index}`,
    content: '<'.repeat(40000),
  }))
  expect(documentationSettingsSchema.safeParse(value).success).toBe(false)
  value.articles = value.articles.slice(0, 17)
  expect(documentationSettingsSchema.safeParse(value).success).toBe(true)
})
