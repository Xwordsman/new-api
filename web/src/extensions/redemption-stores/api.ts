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

import type { RedemptionStoreSettings } from './types'

type Envelope<T> = { success: boolean; message: string; data: T }
const base = '/api/extensions/redemption-stores/admin/settings'
export const redemptionStoreSettingsKey = [
  'redemption-stores',
  'settings',
] as const

export async function getSettings(): Promise<RedemptionStoreSettings> {
  return requireServerSuccess(
    (await api.get<Envelope<RedemptionStoreSettings>>(base)).data
  ).data
}

export async function saveSettings(
  settings: RedemptionStoreSettings
): Promise<RedemptionStoreSettings> {
  return requireServerSuccess(
    (await api.put<Envelope<RedemptionStoreSettings>>(base, settings)).data
  ).data
}
