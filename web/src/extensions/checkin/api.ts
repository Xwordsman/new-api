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
  CheckinDashboard,
  CheckinListParams,
  CheckinPage,
  CheckinRecord,
  CheckinSettings,
} from './types'

type Envelope<T> = { success: boolean; message: string; data: T }
const base = '/api/extensions/checkin'
export const CHECKIN_QUERY_KEY = ['checkin-extension'] as const

export async function getCheckinDashboard(month?: string) {
  const result = await api.get<Envelope<CheckinDashboard>>(
    `${base}/dashboard`,
    {
      params: month ? { month } : undefined,
    }
  )
  return requireServerSuccess(result.data).data
}

export async function claimCheckin(token?: string) {
  const result = await api.post<Envelope<CheckinRecord>>(
    `${base}/claim`,
    undefined,
    { params: token ? { turnstile: token } : undefined }
  )
  return requireServerSuccess(result.data).data
}

export async function getCheckinSettings() {
  const result = await api.get<Envelope<CheckinSettings>>(`${base}/settings`)
  return requireServerSuccess(result.data).data
}

export async function saveCheckinSettings(settings: CheckinSettings) {
  const result = await api.put<Envelope<CheckinSettings>>(
    `${base}/settings`,
    settings
  )
  return requireServerSuccess(result.data).data
}

export async function getCheckinList<T>(
  resource: 'accounts' | 'payments' | 'audit',
  params: CheckinListParams
) {
  const result = await api.get<Envelope<CheckinPage<T>>>(
    `${base}/${resource}`,
    { params }
  )
  return requireServerSuccess(result.data).data
}

export async function updateCheckinAccount(
  userId: number,
  payload: { state: 'active' | 'paused'; reason: string }
) {
  const result = await api.post<Envelope<unknown>>(
    `${base}/accounts/${userId}`,
    payload
  )
  return requireServerSuccess(result.data).data
}

export async function reconcileCheckinPayment(payload: {
  user_id: number
  source: 'topup' | 'subscription'
  trade_no: string
  reference?: string
  amount: string
  currency: string
  usd_per_unit?: string
  reason: string
}) {
  const result = await api.post<Envelope<unknown>>(`${base}/reconcile`, payload)
  return requireServerSuccess(result.data).data
}

export async function refundCheckinPayment(payload: {
  trade_no: string
  amount: string
  reason: string
}) {
  const result = await api.post<Envelope<unknown>>(`${base}/refund`, payload)
  return requireServerSuccess(result.data).data
}
