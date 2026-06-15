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
  const res = await api.get<{ success: boolean; data: CustomNavItem[] }>(
    `/api/custom_nav${onlyEnabled ? '/enabled?enabled=true' : ''}`
  )
  return res.data
}

export async function getEnabledCustomNavItems() {
  const res = await api.get<{ success: boolean; data: CustomNavItem[] }>(
    '/api/custom_nav/enabled?enabled=true'
  )
  return res.data
}

export async function getCustomNavItem(id: number) {
  const res = await api.get<{ success: boolean; data: CustomNavItem }>(
    `/api/custom_nav/${id}`
  )
  return res.data
}

export async function createCustomNavItem(data: CustomNavItemInput) {
  const res = await api.post<{ success: boolean; data: CustomNavItem }>(
    '/api/custom_nav',
    data
  )
  return res.data
}

export async function updateCustomNavItem(data: CustomNavItem) {
  const res = await api.put<{ success: boolean; data: CustomNavItem }>(
    '/api/custom_nav',
    data
  )
  return res.data
}

export async function deleteCustomNavItem(id: number) {
  const res = await api.delete<{ success: boolean }>(`/api/custom_nav/${id}`)
  return res.data
}

export async function toggleCustomNavItem(id: number, enabled: boolean) {
  const res = await api.put<{ success: boolean }>(
    `/api/custom_nav/${id}/toggle`,
    { enabled }
  )
  return res.data
}

export async function updateCustomNavItemSort(id: number, sort: number) {
  const res = await api.put<{ success: boolean }>(
    `/api/custom_nav/${id}/sort`,
    { sort }
  )
  return res.data
}
