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

import type {
  ApiResponse,
  CreateInvitationCodesPayload,
  InvitationCode,
  InvitationCodePage,
  InvitationSettings,
  UpdateInvitationCodePayload,
} from './types'

const basePath = '/api/extensions/invitation/admin'

function unwrap<T>(response: ApiResponse<T>): T {
  if (!response.success) {
    throw new Error(response.message)
  }
  return response.data
}

export async function getInvitationSettings() {
  const response = await api.get<ApiResponse<InvitationSettings>>(
    `${basePath}/settings`
  )
  return unwrap(response.data)
}

export async function updateInvitationSettings(enabled: boolean) {
  const response = await api.put<ApiResponse<InvitationSettings>>(
    `${basePath}/settings`,
    { enabled }
  )
  return unwrap(response.data)
}

export async function getInvitationCodes(params: {
  page: number
  pageSize: number
  keyword: string
}) {
  const response = await api.get<ApiResponse<InvitationCodePage>>(
    `${basePath}/codes`,
    {
      params: {
        p: params.page,
        page_size: params.pageSize,
        keyword: params.keyword || undefined,
      },
    }
  )
  return unwrap(response.data)
}

export async function createInvitationCodes(
  payload: CreateInvitationCodesPayload
) {
  const response = await api.post<ApiResponse<InvitationCode[]>>(
    `${basePath}/codes`,
    payload
  )
  return unwrap(response.data)
}

export async function updateInvitationCode(
  id: number,
  payload: UpdateInvitationCodePayload
) {
  const response = await api.put<ApiResponse<InvitationCode>>(
    `${basePath}/codes/${id}`,
    payload
  )
  return unwrap(response.data)
}

export async function deleteInvitationCode(id: number) {
  const response = await api.delete<ApiResponse<unknown>>(
    `${basePath}/codes/${id}`
  )
  unwrap(response.data)
}
