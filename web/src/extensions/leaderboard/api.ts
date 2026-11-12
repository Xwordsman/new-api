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
  LeaderboardSettings,
  LeaderboardSnapshot,
  SettingsResponse,
} from './types'

type Envelope<T> = { success: boolean; message: string; data: T }
export const leaderboardQueryKey = ['leaderboard-extension'] as const
const base = '/api/extensions/leaderboard'

export async function getLeaderboard(
  signal?: AbortSignal
): Promise<LeaderboardSnapshot> {
  return requireServerSuccess(
    (
      await api.get<Envelope<LeaderboardSnapshot>>(`${base}/snapshot`, {
        signal,
      })
    ).data
  ).data
}

export async function getLeaderboardSettings(
  signal?: AbortSignal
): Promise<SettingsResponse> {
  return requireServerSuccess(
    (
      await api.get<Envelope<SettingsResponse>>(`${base}/admin/settings`, {
        signal,
      })
    ).data
  ).data
}

export async function saveLeaderboardSettings(
  settings: LeaderboardSettings
): Promise<LeaderboardSettings> {
  return requireServerSuccess(
    (
      await api.put<Envelope<LeaderboardSettings>>(
        `${base}/admin/settings`,
        settings
      )
    ).data
  ).data
}

export async function refreshLeaderboard(): Promise<{ queued: boolean }> {
  return requireServerSuccess(
    (await api.post<Envelope<{ queued: boolean }>>(`${base}/admin/refresh`))
      .data
  ).data
}
