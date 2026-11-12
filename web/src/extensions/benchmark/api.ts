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
  Artworks,
  BenchmarkRun,
  BenchmarkSettings,
  SettingsResponse,
  Snapshot,
} from './types'

type Envelope<T> = { success: boolean; message: string; data: T }
const base = '/api/extensions/benchmark'

export async function getBenchmarkSettings(): Promise<SettingsResponse> {
  return requireServerSuccess(
    (await api.get<Envelope<SettingsResponse>>(`${base}/admin/settings`)).data
  ).data
}

export async function saveBenchmarkSettings(
  settings: BenchmarkSettings
): Promise<BenchmarkSettings> {
  return requireServerSuccess(
    (
      await api.put<Envelope<BenchmarkSettings>>(
        `${base}/admin/settings`,
        settings
      )
    ).data
  ).data
}

export async function getBenchmarkSnapshot(): Promise<Snapshot> {
  return requireServerSuccess(
    (await api.get<Envelope<Snapshot>>(`${base}/snapshot`)).data
  ).data
}

export async function getBenchmarkRun(id: number): Promise<BenchmarkRun> {
  return requireServerSuccess(
    (await api.get<Envelope<BenchmarkRun>>(`${base}/runs/${id}`)).data
  ).data
}

export async function getBenchmarkArtworks(
  page: number,
  group: string
): Promise<Artworks> {
  return requireServerSuccess(
    (
      await api.get<Envelope<Artworks>>(`${base}/artworks`, {
        params: { page, group },
      })
    ).data
  ).data
}

export async function runBenchmark(
  group: string
): Promise<{ queued: boolean }> {
  return requireServerSuccess(
    (
      await api.post<Envelope<{ queued: boolean }>>(`${base}/admin/run`, {
        group,
      })
    ).data
  ).data
}
