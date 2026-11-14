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
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type { PromotionForm } from './schema'

export type PricingSnapshot = {
  options: Record<string, string>
  promotions: {
    revision: number
    groups: {
      group: string
      promotion:
        | (Omit<
            NonNullable<PromotionForm['groups'][number]['promotion']>,
            'ratio'
          > & { ratio?: number; factor?: number })
        | null
    }[]
  }
}
export type PricingUpdate = {
  options: Record<string, string>
  baseline: Record<string, string>
  promotions: PromotionForm
  renames: Record<string, string>
}
type Envelope = { success: boolean; message: string; data: PricingSnapshot }
const endpoint = '/api/extensions/group-pricing/admin/settings'
export async function getGroupPricing(): Promise<PricingSnapshot> {
  return requireServerSuccess((await api.get<Envelope>(endpoint)).data).data
}
export async function saveGroupPricing(
  update: PricingUpdate
): Promise<PricingSnapshot> {
  return requireServerSuccess((await api.put<Envelope>(endpoint, update)).data)
    .data
}
