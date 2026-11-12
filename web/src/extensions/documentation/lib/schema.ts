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
import { z } from 'zod'

const identifier = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]{0,99}$/,
    'Use lowercase letters, numbers and hyphens.'
  )
const encoder = new TextEncoder()
const description = z
  .string()
  .refine(
    (value) => [...value].length <= 600,
    'Descriptions must be at most 600 characters.'
  )

function title(limit: number) {
  return z
    .string()
    .refine(
      (value) => value.trim().length > 0 && [...value].length <= limit,
      'A title is required and must be within the size limit.'
    )
}

export const documentationCategorySchema = z.object({
  id: identifier,
  title: title(120),
  description,
  sort_order: z.number().int().min(0).max(100000),
})

export const documentationArticleSchema = z
  .object({
    id: identifier,
    category_id: identifier,
    slug: identifier,
    title: title(160),
    description,
    content: z
      .string()
      .refine(
        (value) => encoder.encode(value).byteLength <= 128 * 1024,
        'Keep each article within 128 KB and add content before publishing.'
      ),
    status: z.enum(['draft', 'published']),
    sort_order: z.number().int().min(0).max(100000),
    updated_at: z.number().int().nonnegative(),
  })
  .refine(
    (article) =>
      article.status === 'draft' || article.content.trim().length > 0,
    {
      path: ['content'],
      message:
        'Keep each article within 128 KB and add content before publishing.',
    }
  )

export const documentationSettingsSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    enabled: z.boolean(),
    title: title(120),
    description,
    categories: z
      .array(documentationCategorySchema)
      .max(64, 'Use no more than 64 categories.'),
    articles: z
      .array(documentationArticleSchema)
      .max(500, 'Use no more than 500 articles.'),
  })
  .superRefine((value, context) => {
    const categoryIds = new Set<string>()
    value.categories.forEach((category, index) => {
      if (categoryIds.has(category.id)) {
        context.addIssue({
          code: 'custom',
          path: ['categories', index, 'id'],
          message: 'Category identifiers must be unique.',
        })
      }
      categoryIds.add(category.id)
    })
    const ids = new Set<string>()
    const slugs = new Set<string>()
    value.articles.forEach((article, index) => {
      if (!categoryIds.has(article.category_id)) {
        context.addIssue({
          code: 'custom',
          path: ['articles', index, 'category_id'],
          message: 'Select an existing category.',
        })
      }
      if (ids.has(article.id) || slugs.has(article.slug)) {
        context.addIssue({
          code: 'custom',
          path: ['articles', index, 'slug'],
          message: 'Article addresses must be unique.',
        })
      }
      ids.add(article.id)
      slugs.add(article.slug)
    })
    // Go's JSON encoder escapes HTML characters and Unicode line separators.
    const encoded = JSON.stringify(value).replaceAll(
      /[<>&\u2028\u2029]/g,
      (character) =>
        `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
    )
    if (encoder.encode(encoded).byteLength > 4 * 1024 * 1024) {
      context.addIssue({
        code: 'custom',
        path: ['articles'],
        message: 'Documentation content exceeds the total size limit.',
      })
    }
  })

export type DocumentationFormValues = z.infer<
  typeof documentationSettingsSchema
>
