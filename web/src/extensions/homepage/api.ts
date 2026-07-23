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

import type { ApiResponse, HomepageSettings } from './types'

const settingsPath = '/api/extensions/homepage/admin/settings'

function unwrap<T>(response: ApiResponse<T>): T {
  if (!response.success) {
    throw new Error(response.message)
  }
  return response.data
}

export async function getHomepageSettings() {
  const response = await api.get<ApiResponse<HomepageSettings>>(settingsPath)
  return unwrap(response.data)
}

export async function updateHomepageSettings(settings: HomepageSettings) {
  const response = await api.put<ApiResponse<HomepageSettings>>(
    settingsPath,
    settings
  )
  return unwrap(response.data)
}
