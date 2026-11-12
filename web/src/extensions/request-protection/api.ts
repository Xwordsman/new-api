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
  EventFilters,
  ProtectionAudit,
  ProtectionEvent,
  ProtectionPage,
  ProtectionRestriction,
  ProtectionSettings,
  ProtectionVerdict,
} from './types'

type Envelope<T> = { success: boolean; message: string; data: T }
const base = '/api/extensions/request-protection/admin'

export async function getSettings(): Promise<ProtectionSettings> {
  return requireServerSuccess(
    (await api.get<Envelope<ProtectionSettings>>(`${base}/settings`)).data
  ).data
}
export async function saveSettings(
  settings: ProtectionSettings
): Promise<ProtectionSettings> {
  return requireServerSuccess(
    (await api.put<Envelope<ProtectionSettings>>(`${base}/settings`, settings))
      .data
  ).data
}
export async function dryRun(input: {
  settings: ProtectionSettings
  body: string
  model: string
  group: string
  protocol: string
}): Promise<ProtectionVerdict> {
  return requireServerSuccess(
    (await api.post<Envelope<ProtectionVerdict>>(`${base}/dry-run`, input)).data
  ).data
}
export async function getEvents(
  page: number,
  filters: EventFilters
): Promise<ProtectionPage<ProtectionEvent>> {
  return requireServerSuccess(
    (
      await api.get<Envelope<ProtectionPage<ProtectionEvent>>>(
        `${base}/events`,
        { params: { page, ...filters } }
      )
    ).data
  ).data
}
export async function getRestrictions(
  page: number
): Promise<ProtectionPage<ProtectionRestriction>> {
  return requireServerSuccess(
    (
      await api.get<Envelope<ProtectionPage<ProtectionRestriction>>>(
        `${base}/restrictions`,
        { params: { page } }
      )
    ).data
  ).data
}
export async function getAudit(
  page: number
): Promise<ProtectionPage<ProtectionAudit>> {
  return requireServerSuccess(
    (
      await api.get<Envelope<ProtectionPage<ProtectionAudit>>>(
        `${base}/audit`,
        { params: { page } }
      )
    ).data
  ).data
}
export async function reviewEvent(input: {
  event_id: number
  verdict: string
  note: string
}): Promise<void> {
  requireServerSuccess(
    (await api.post<Envelope<null>>(`${base}/review`, input)).data
  )
}
export async function releaseSubject(input: {
  subject_id: string
  note: string
}): Promise<void> {
  requireServerSuccess(
    (await api.post<Envelope<null>>(`${base}/release`, input)).data
  )
}
export async function checkAlerts(): Promise<void> {
  requireServerSuccess(
    (await api.post<Envelope<null>>(`${base}/check-alerts`)).data
  )
}
