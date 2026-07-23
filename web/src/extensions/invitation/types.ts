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
export type InvitationSettings = {
  enabled: boolean
}

export type InvitationCode = {
  id: number
  code: string
  name: string
  status: 0 | 1
  max_uses: number
  used_count: number
  expires_at: string | null
  created_at: string
  updated_at: string
}

export type InvitationCodePage = {
  page: number
  page_size: number
  total: number
  items: InvitationCode[]
}

export type CreateInvitationCodesPayload = {
  name: string
  code?: string
  prefix?: string
  count: number
  max_uses: number
  expires_at: string | null
}

export type UpdateInvitationCodePayload = {
  name: string
  status: 0 | 1
  max_uses: number
  expires_at: string | null
}

export type ApiResponse<T> = {
  success: boolean
  message: string
  data: T
}
