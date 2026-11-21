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

import type { ProtectionSettings } from '../types'

export function lines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

const encoder = new TextEncoder()
const list = (max: number, length = 191) =>
  z
    .string()
    .refine(
      (value) =>
        lines(value).length <= max &&
        lines(value).every((line) => encoder.encode(line).length <= length)
    )
const integer = (min: number, max: number) => z.number().int().min(min).max(max)
export const protectionSchema = z
  .object({
    keywords: z.object({
      enabled: z.boolean(),
      combinations: z.boolean(),
      block: list(2000, 1000),
      suspend: list(2000, 1000),
    }),
    suspend_until_review: z.boolean(),
    revision: integer(0, Number.MAX_SAFE_INTEGER),
    enabled: z.boolean(),
    channel_ids: z.array(integer(1, Number.MAX_SAFE_INTEGER)).max(100),
    categories: z.object({
      jailbreak: z.boolean(),
      theft: z.boolean(),
      attack: z.boolean(),
      sexual: z.boolean(),
    }),
    reviewer: z.object({
      enabled: z.boolean(),
      channel_id: integer(0, Number.MAX_SAFE_INTEGER),
      model: z.string().trim().max(191),
      timeout_seconds: integer(1, 60),
      failure_action: z.enum(['observe', 'block']),
    }),
    store_evidence: z.boolean(),
    automatic_suspend: z.boolean(),
    mode: z.enum(['observe', 'enforce']),
    groups: list(100),
    models: list(100),
    protocols: list(30),
    exempt_user_ids: list(100).refine((value) =>
      lines(value).every(
        (line) => /^[1-9]\d*$/.test(line) && Number.isSafeInteger(Number(line))
      )
    ),
    max_body_bytes: integer(1024, 33554432),
    max_text_bytes: integer(256, 8388608),
    uninspected_action: z.enum(['allow', 'observe', 'block']),
    require_complete_text: z.boolean(),
    upstream_action: z.enum(['observe', 'hold_user']),
    fail_closed: z.boolean(),
    rules: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
            name: z
              .string()
              .trim()
              .min(1)
              .refine((value) => encoder.encode(value).length <= 120),
            enabled: z.boolean(),
            kind: z.enum(['any', 'all', 'regex']),
            patterns: list(20, 1000).refine((value) => lines(value).length > 0),
            sources: z
              .array(z.enum(['current', 'history', 'system', 'tool']))
              .min(1)
              .max(4)
              .refine((value) => new Set(value).size === value.length),
            action: z.enum(['observe', 'block']),
            high_confidence: z.boolean(),
            count_penalty: z.boolean(),
          })
          .refine(
            (rule) =>
              !rule.count_penalty ||
              (rule.high_confidence && rule.action === 'block'),
            { path: ['count_penalty'] }
          )
      )
      .max(100),
    window_minutes: integer(1, 1440),
    key_threshold: integer(0, 10000),
    key_suspend_minutes: integer(1, 43200),
    user_threshold: integer(0, 10000),
    user_suspend_minutes: integer(1, 43200),
    duplicate_seconds: integer(1, 86400),
    retention_days: integer(2, 365),
    upstream_codes: list(30),
    alert_enabled: z.boolean(),
    alert_emails: list(10, 254).refine((value) =>
      lines(value).every((line) => z.email().safeParse(line).success)
    ),
    alert_minutes: integer(1, 1440),
    alert_threshold: integer(1, 100000),
  })
  .superRefine((value, ctx) => {
    const keywords = [
      ...lines(value.keywords.block),
      ...lines(value.keywords.suspend),
    ]
    const normalized = keywords.map((word) =>
      word
        .normalize('NFKC')
        .replaceAll(/\p{Cf}/gu, '')
        .toLowerCase()
        .replaceAll(/\s+/gu, ' ')
        .trim()
    )
    if (
      keywords.length > 2000 ||
      encoder.encode(keywords.join('')).length > 128000 ||
      normalized.some((word) => !word) ||
      new Set(normalized).size !== normalized.length
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['keywords', 'block'],
        message:
          'Use unique keywords, at most 2000 entries and 128000 bytes in total',
      })
    }
    if (
      value.reviewer.enabled &&
      (value.reviewer.channel_id === 0 ||
        value.channel_ids.includes(value.reviewer.channel_id))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['reviewer', 'channel_id'],
        message: 'Select a separate review channel',
      })
    }
    if (value.reviewer.enabled && !value.reviewer.model) {
      ctx.addIssue({
        code: 'custom',
        path: ['reviewer', 'model'],
        message: 'Select a review model',
      })
    }
    if (value.max_text_bytes > value.max_body_bytes) {
      ctx.addIssue({
        code: 'custom',
        path: ['max_text_bytes'],
        message: 'Check this value and the permitted limits',
      })
    }
    if (value.alert_enabled && lines(value.alert_emails).length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['alert_emails'],
        message: 'Check this value and the permitted limits',
      })
    }
    const ids = new Set<string>()
    let count = 0
    let bytes = 0
    for (const [index, rule] of value.rules.entries()) {
      if (ids.has(rule.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['rules', index, 'id'],
          message: 'Rule IDs must be unique',
        })
      }
      ids.add(rule.id)
      count += lines(rule.patterns).length
      for (const pattern of lines(rule.patterns)) {
        bytes += encoder.encode(pattern).length
      }
    }
    if (count > 200 || bytes > 32000) {
      ctx.addIssue({
        code: 'custom',
        path: ['rules'],
        message: 'Use at most 200 patterns and 32000 pattern bytes in total',
      })
    }
  })
export type ProtectionForm = z.infer<typeof protectionSchema>

export function toForm(settings: ProtectionSettings): ProtectionForm {
  return {
    ...settings,
    keywords: {
      ...settings.keywords,
      block: settings.keywords.block.join('\n'),
      suspend: settings.keywords.suspend.join('\n'),
    },
    groups: settings.groups.join('\n'),
    models: settings.models.join('\n'),
    protocols: settings.protocols.join('\n'),
    exempt_user_ids: settings.exempt_user_ids.join('\n'),
    upstream_codes: settings.upstream_codes.join('\n'),
    alert_emails: settings.alert_emails.join('\n'),
    rules: settings.rules.map((rule) => ({
      ...rule,
      patterns: rule.patterns.join('\n'),
      sources: rule.sources as ProtectionForm['rules'][number]['sources'],
    })),
  }
}
export function toSettings(form: ProtectionForm): ProtectionSettings {
  return {
    ...form,
    keywords: {
      ...form.keywords,
      block: lines(form.keywords.block),
      suspend: lines(form.keywords.suspend),
    },
    groups: lines(form.groups),
    models: lines(form.models),
    protocols: lines(form.protocols),
    exempt_user_ids: lines(form.exempt_user_ids).map(Number),
    upstream_codes: lines(form.upstream_codes),
    alert_emails: lines(form.alert_emails),
    rules: form.rules.map((rule) => ({
      ...rule,
      patterns: lines(rule.patterns),
    })),
  }
}
