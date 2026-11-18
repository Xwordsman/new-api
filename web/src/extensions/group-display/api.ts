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

import { displaySettingsSchema } from './schema'
import type { GroupDisplaySettings } from './types'

const endpoint = '/api/extensions/group-display/admin/settings'
type Envelope = {
  success: boolean
  message: string
  data: GroupDisplaySettings
}

export async function getGroupDisplay(): Promise<GroupDisplaySettings> {
  const response = requireServerSuccess(
    (await api.get<Envelope>(endpoint)).data
  )
  return displaySettingsSchema.parse(response.data)
}

export async function saveGroupDisplay(
  settings: GroupDisplaySettings
): Promise<GroupDisplaySettings> {
  const response = requireServerSuccess(
    (await api.put<Envelope>(endpoint, settings)).data
  )
  return displaySettingsSchema.parse(response.data)
}
