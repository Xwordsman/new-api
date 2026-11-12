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
  PriceDetail,
  PriceEvent,
  PriceQuote,
  PriceSettings,
  PriceState,
  PriceStatuses,
} from './types'

type Envelope<T> = { success: boolean; message: string; data: T }
const base = '/api/extensions/key-price'

export async function getPriceSettings(): Promise<PriceSettings> {
  return requireServerSuccess(
    (await api.get<Envelope<PriceSettings>>(`${base}/admin/settings`)).data
  ).data
}
export async function savePriceSettings(
  settings: PriceSettings
): Promise<PriceSettings> {
  return requireServerSuccess(
    (await api.put<Envelope<PriceSettings>>(`${base}/admin/settings`, settings))
      .data
  ).data
}
export async function getPriceStatuses(ids: number[]): Promise<PriceStatuses> {
  const batches: number[][] = []
  for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100))
  const responses = await Promise.all(
    batches.map(
      async (batch) =>
        requireServerSuccess(
          (
            await api.get<Envelope<PriceStatuses>>(`${base}/status`, {
              params: { ids: batch.join(',') },
            })
          ).data
        ).data
    )
  )
  return {
    settings: responses[0].settings,
    states: responses.flatMap((response) => response.states),
  }
}
export async function getPriceDetail(id: number): Promise<PriceDetail> {
  return requireServerSuccess(
    (await api.get<Envelope<PriceDetail>>(`${base}/keys/${id}`)).data
  ).data
}
export async function getPriceQuote(id: number): Promise<PriceQuote> {
  return requireServerSuccess(
    (await api.post<Envelope<PriceQuote>>(`${base}/keys/${id}/quote`)).data
  ).data
}
export async function acceptPriceQuote(
  id: number,
  quote: string,
  protectedKey: boolean
): Promise<PriceState> {
  return requireServerSuccess(
    (
      await api.post<Envelope<PriceState>>(`${base}/keys/${id}/accept`, {
        quote,
        protected: protectedKey,
      })
    ).data
  ).data
}
export async function getPriceEvents(
  page: number
): Promise<{ items: PriceEvent[]; total: number; page: number }> {
  return requireServerSuccess(
    (
      await api.get<
        Envelope<{ items: PriceEvent[]; total: number; page: number }>
      >(`${base}/admin/events`, { params: { page } })
    ).data
  ).data
}
