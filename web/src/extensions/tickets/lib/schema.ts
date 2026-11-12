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

export const ticketSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(2, 'Use a subject between 2 and 160 characters.')
    .max(160, 'Use a subject between 2 and 160 characters.'),
  category: z.enum([
    'quota',
    'platform',
    'interface',
    'api',
    'refund',
    'account',
    'other',
  ]),
  body: z
    .string()
    .trim()
    .min(1, 'Please describe your issue.')
    .max(10000, 'Use no more than 10,000 characters.'),
})

export const ticketReplySchema = z.object({
  body: z.string().trim().max(10000, 'Use no more than 10,000 characters.'),
})

export const ticketSearchSchema = z.object({
  view: z.enum(['mine', 'team']).catch('mine'),
  compose: z.boolean().optional().catch(undefined),
  id: z.number().int().positive().optional().catch(undefined),
})
