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

const limit = z.number().int().min(0).max(100000)
const identifier = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

export const concurrencySchema = z
  .object({
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    enabled: z.boolean(),
    default_user_limit: limit,
    default_channel_limit: limit,
    default_key_limit: limit,
    queue_timeout_ms: z.number().int().min(0).max(30000),
    max_queued_per_user: z.number().int().min(0).max(100),
    lease_seconds: z.number().int().min(30).max(600),
    users: z.array(z.object({ user_id: identifier, limit })).max(200),
    groups: z
      .array(
        z.object({
          group: z
            .string()
            .min(1)
            .refine(
              (value) =>
                value === value.trim() &&
                new TextEncoder().encode(value).length <= 64
            ),
          limit,
        })
      )
      .max(200),
    channels: z
      .array(z.object({ channel_id: identifier, limit, key_limit: limit }))
      .max(200),
  })
  .superRefine((values, ctx) => {
    if (
      (values.queue_timeout_ms === 0) !==
      (values.max_queued_per_user === 0)
    ) {
      for (const field of ['queue_timeout_ms', 'max_queued_per_user']) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: 'Set both queue limits to zero or both above zero',
        })
      }
    }
    const scopes = [
      {
        name: 'users',
        field: 'user_id',
        ids: values.users.map((rule) => rule.user_id),
      },
      {
        name: 'groups',
        field: 'group',
        ids: values.groups.map((rule) => rule.group),
      },
      {
        name: 'channels',
        field: 'channel_id',
        ids: values.channels.map((rule) => rule.channel_id),
      },
    ]
    for (const scope of scopes) {
      const seen = new Set<string | number>()
      scope.ids.forEach((id, index) => {
        if (seen.has(id)) {
          ctx.addIssue({
            code: 'custom',
            path: [scope.name, index, scope.field],
            message: 'Duplicate concurrency rule',
          })
        }
        seen.add(id)
      })
    }
  })

export type SettingsFormValues = z.infer<typeof concurrencySchema>
