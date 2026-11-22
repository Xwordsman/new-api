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

export const defaultProbeSettings = {
  enabled: false,
  interval_minutes: 30,
  only_when_idle: true,
  daily_limit: 500,
}

export const monitorSettingsSchema = z
  .object({
    revision: z
      .number()
      .int('Invalid channel monitor settings')
      .nonnegative('Invalid channel monitor settings'),
    enabled: z.boolean(),
    probe: z
      .object({
        enabled: z.boolean(),
        interval_minutes: z
          .number({ error: 'Invalid channel monitor settings' })
          .int('Invalid channel monitor settings')
          .min(5, 'Invalid channel monitor settings')
          .max(1440, 'Invalid channel monitor settings'),
        only_when_idle: z.boolean(),
        daily_limit: z
          .number({ error: 'Invalid channel monitor settings' })
          .int('Invalid channel monitor settings')
          .min(1, 'Invalid channel monitor settings')
          .max(5000, 'Invalid channel monitor settings'),
      })
      .optional(),
    groups: z
      .array(
        z.object({
          group: z.string().min(1, 'Invalid channel monitor settings'),
          display_name: z
            .string()
            .trim()
            .max(80, 'Invalid channel monitor settings'),
          description: z
            .string()
            .trim()
            .max(240, 'Invalid channel monitor settings'),
          badge: z.string().trim().max(24, 'Invalid channel monitor settings'),
          icon: z
            .string()
            .trim()
            .max(128, 'Invalid channel monitor settings')
            .optional(),
          promotion: z.null(),
          probe_models: z
            .array(z.string().min(1).max(200))
            .max(8, 'Select up to 8 text models per group')
            .optional(),
        })
      )
      .max(24, 'Invalid channel monitor settings'),
  })
  .superRefine((settings, ctx) => {
    const targets = settings.groups.reduce(
      (count, group) => count + (group.probe_models?.length ?? 0),
      0
    )
    if (
      targets > 48 ||
      (settings.probe?.enabled && (!settings.enabled || targets === 0))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['probe', 'enabled'],
        message: 'Select probe models and enable channel monitor first',
      })
    }
  })
