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

import type {
  EmailTemplate,
  EmailTemplateConfiguration,
  EmailTemplateSettings,
  TemplateDefinition,
} from '../types'

const templateSchema = z.object({
  type: z.string(),
  language: z.enum(['zh-CN', 'zh-TW', 'en']),
  subject: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .regex(/^[^\p{Cc}]+$/u),
  html: z
    .string()
    .trim()
    .min(1)
    .refine((value) => new TextEncoder().encode(value).length <= 48 * 1024),
})

export const settingsSchema = z.object({
  revision: z.number().int().nonnegative(),
  enabled: z.boolean(),
  templates: z.record(z.string(), templateSchema),
})

export type EmailTemplateFormValues = z.infer<typeof settingsSchema>

export function templateKey(
  template: Pick<EmailTemplate, 'type' | 'language'>
): string {
  return `${template.type}:${template.language}`
}

export function createFormValues(
  configuration: EmailTemplateConfiguration
): EmailTemplateFormValues {
  const templates: EmailTemplateFormValues['templates'] = {}
  for (const definition of configuration.catalog) {
    for (const template of Object.values(definition.defaults)) {
      templates[templateKey(template)] = templateSchema.parse(template)
    }
  }
  for (const template of configuration.settings.templates) {
    templates[templateKey(template)] = templateSchema.parse(template)
  }
  return { ...configuration.settings, templates }
}

// Store only differences so future bundled defaults can improve untouched mail.
export function settingsFromForm(
  values: EmailTemplateFormValues,
  catalog: TemplateDefinition[]
): EmailTemplateSettings {
  const overrides: EmailTemplate[] = []
  for (const definition of catalog) {
    for (const bundled of Object.values(definition.defaults)) {
      const current = values.templates[templateKey(bundled)]
      if (
        current &&
        (current.subject !== bundled.subject || current.html !== bundled.html)
      ) {
        overrides.push(current)
      }
    }
  }
  return {
    revision: values.revision,
    enabled: values.enabled,
    templates: overrides,
  }
}
