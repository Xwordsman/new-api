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

import { isHttpUrl } from '@/lib/content-format'

export const redemptionStoreSchema = z.object({
  revision: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1),
  enabled: z.boolean(),
  stores: z
    .array(
      z.object({
        id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
        name: z.string().trim().min(1).max(80),
        url: z
          .string()
          .trim()
          .max(2048)
          .refine((value) => {
            if (
              !/^https?:\/\//.test(value) ||
              !isHttpUrl(value) ||
              /[\\\s]/.test(value)
            ) {
              return false
            }
            const url = new URL(value)
            return (
              url.hostname !== '' &&
              !value
                .slice(value.indexOf('://') + 3)
                .split(/[/?#]/, 1)[0]
                .includes('@')
            )
          }, 'Enter a valid HTTP or HTTPS store URL without embedded credentials'),
        description: z.string().trim().max(300),
        enabled: z.boolean(),
      })
    )
    .max(32),
})
