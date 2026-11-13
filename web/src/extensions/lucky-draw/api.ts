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
  DrawDashboard,
  DrawResult,
  DrawSettings,
  DrawSummary,
} from './types'

const base = '/api/extensions/lucky-draw'
export const DRAW_QUERY_KEY = ['lucky-draw'] as const
type Envelope<T> = { success: boolean; message: string; data: T }

export async function getDrawData<T>(
  path: string,
  params?: Record<string, string | number>
) {
  const response = await api.get<Envelope<T>>(`${base}/${path}`, { params })
  return requireServerSuccess(response.data).data
}
export const getDrawDashboard = () => getDrawData<DrawDashboard>('dashboard')
export const getDrawSettings = () => getDrawData<DrawSettings>('settings')
export const getDrawSummary = () => getDrawData<DrawSummary>('summary')
export const recoverDraw = (key: string) =>
  getDrawData<DrawResult | null>(`result/${key}`)

export async function submitDraw(input: {
  request_key: string
  version: number
  turnstile?: string
}) {
  const response = await api.post<Envelope<DrawResult>>(`${base}/draw`, input)
  return requireServerSuccess(response.data).data
}
export async function saveDrawSettings(settings: DrawSettings) {
  const response = await api.put<Envelope<DrawSettings>>(
    `${base}/settings`,
    settings
  )
  return requireServerSuccess(response.data).data
}
export async function reviewDrawAccount(input: {
  user_id: number
  state: 'active' | 'paused'
  reason: string
}) {
  const response = await api.post<Envelope<DrawAccountResult>>(
    `${base}/accounts/${input.user_id}`,
    input
  )
  return requireServerSuccess(response.data).data
}
type DrawAccountResult = { user_id: number }
