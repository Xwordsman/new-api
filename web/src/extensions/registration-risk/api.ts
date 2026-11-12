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

import type {
  Credit,
  RecordFilter,
  RegistrationSettings,
  RiskRecord,
} from './types'

type Envelope<T> = { success: boolean; message: string; data: T }
const base = '/api/extensions/registration-risk'
export const registrationQueryKey = ['registration-risk-extension'] as const
export async function getSettings(
  signal?: AbortSignal
): Promise<RegistrationSettings> {
  return requireServerSuccess(
    (
      await api.get<Envelope<RegistrationSettings>>(`${base}/admin/settings`, {
        signal,
      })
    ).data
  ).data
}
export async function saveSettings(
  settings: RegistrationSettings
): Promise<RegistrationSettings> {
  return requireServerSuccess(
    (
      await api.put<Envelope<RegistrationSettings>>(
        `${base}/admin/settings`,
        settings
      )
    ).data
  ).data
}
export async function getRecords(
  params: RecordFilter,
  signal?: AbortSignal
): Promise<{ items: RiskRecord[]; total: number; page: number }> {
  return requireServerSuccess(
    (
      await api.get<
        Envelope<{ items: RiskRecord[]; total: number; page: number }>
      >(`${base}/admin/records`, { params, signal })
    ).data
  ).data
}
export async function reviewCredit(body: {
  user_id: number
  approve: boolean
  reason: string
}): Promise<void> {
  requireServerSuccess(
    (await api.post<Envelope<null>>(`${base}/admin/review`, body)).data
  )
}
export async function checkAlerts(): Promise<void> {
  requireServerSuccess(
    (await api.post<Envelope<null>>(`${base}/admin/check-alerts`)).data
  )
}
export async function getCredit(signal?: AbortSignal): Promise<Credit> {
  return requireServerSuccess(
    (await api.get<Envelope<Credit>>(`${base}/credit`, { signal })).data
  ).data
}
