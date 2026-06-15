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
import { request } from '@/lib/request'

export type CustomNavItem = {
  id: number
  name: string
  url: string
  enabled: boolean
  sort: number
  open_new_tab: boolean
  created_time: number
}

export type CustomNavItemInput = Omit<CustomNavItem, 'id' | 'created_time'>

export async function getCustomNavItems(onlyEnabled = false) {
  return request<{ success: boolean; data: CustomNavItem[] }>(
    `/api/custom_nav${onlyEnabled ? '/enabled?enabled=true' : ''}`
  )
}

export async function getEnabledCustomNavItems() {
  return request<{ success: boolean; data: CustomNavItem[] }>(
    '/api/custom_nav/enabled?enabled=true'
  )
}

export async function getCustomNavItem(id: number) {
  return request<{ success: boolean; data: CustomNavItem }>(
    `/api/custom_nav/${id}`
  )
}

export async function createCustomNavItem(data: CustomNavItemInput) {
  return request<{ success: boolean; data: CustomNavItem }>(
    '/api/custom_nav',
    {
      method: 'POST',
      body: JSON.stringify(data),
    }
  )
}

export async function updateCustomNavItem(data: CustomNavItem) {
  return request<{ success: boolean; data: CustomNavItem }>(
    '/api/custom_nav',
    {
      method: 'PUT',
      body: JSON.stringify(data),
    }
  )
}

export async function deleteCustomNavItem(id: number) {
  return request<{ success: boolean }>(`/api/custom_nav/${id}`, {
    method: 'DELETE',
  })
}

export async function toggleCustomNavItem(id: number, enabled: boolean) {
  return request<{ success: boolean }>(`/api/custom_nav/${id}/toggle`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  })
}

export async function updateCustomNavItemSort(id: number, sort: number) {
  return request<{ success: boolean }>(`/api/custom_nav/${id}/sort`, {
    method: 'PUT',
    body: JSON.stringify({ sort }),
  })
}
