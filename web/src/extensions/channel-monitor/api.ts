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
  MonitorSettings,
  MonitorSettingsResponse,
  MonitorSnapshot,
} from './types'

type Envelope<T> = { success: boolean; message: string; data: T }
const base = '/api/extensions/channel-monitor'

export async function getMonitorSnapshot(
  window: string
): Promise<MonitorSnapshot> {
  const response = await api.get<Envelope<MonitorSnapshot>>(
    `${base}/snapshot`,
    { params: { window } }
  )
  return requireServerSuccess(response.data).data
}

export async function getMonitorSettings(): Promise<MonitorSettingsResponse> {
  return requireServerSuccess(
    (await api.get<Envelope<MonitorSettingsResponse>>(`${base}/admin/settings`))
      .data
  ).data
}

export async function saveMonitorSettings(
  settings: MonitorSettings
): Promise<MonitorSettings> {
  return requireServerSuccess(
    (
      await api.put<Envelope<MonitorSettings>>(
        `${base}/admin/settings`,
        settings
      )
    ).data
  ).data
}
