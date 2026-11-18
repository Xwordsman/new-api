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

const color = z
  .string()
  .regex(/^$|^#[0-9a-fA-F]{6}$/, 'Use a hex color such as #16a34a.')
export const appearanceSchema = z.object({
  category: z.string(),
  display_name: z.string().max(120),
  description: z.string().max(600),
  icon: z.string().max(128),
  color,
  tags: z
    .array(z.object({ label: z.string().trim().min(1).max(32), color }))
    .max(6)
    .refine(
      (tags) => new Set(tags.map((tag) => tag.label)).size === tags.length,
      'Tag labels must be unique.'
    ),
  featured: z.boolean(),
  background: z.boolean(),
  border: z.enum(['', 'solid', 'gradient']),
  gradient_to: color,
  sort_order: z.number().int().min(0).max(100000),
})
export const displaySettingsSchema = z
  .object({
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    categories: z
      .array(
        z.object({
          id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
          name: z.string().trim().min(1).max(80),
          icon: z.string().max(128),
          color,
        })
      )
      .max(64),
    groups: z
      .record(
        z
          .string()
          .min(1)
          .max(128)
          .refine((key) => key.trim() === key),
        appearanceSchema
      )
      .refine((groups) => Object.keys(groups).length <= 1024),
  })
  .superRefine((settings, context) => {
    const categories = new Set(
      settings.categories.map((category) => category.id)
    )
    if (categories.size !== settings.categories.length) {
      context.addIssue({
        code: 'custom',
        path: ['categories'],
        message: 'Category identifiers must be unique.',
      })
    }
    for (const [key, group] of Object.entries(settings.groups)) {
      if (group.category && !categories.has(group.category)) {
        context.addIssue({
          code: 'custom',
          path: ['groups', key, 'category'],
          message: 'Select an existing category.',
        })
      }
    }
  })
