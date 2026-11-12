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
  DocumentationDetail,
  DocumentationIndex,
  DocumentationSearchResult,
  DocumentationSettings,
} from './types'

type Envelope<T> = { success: boolean; message: string; data: T }
export const documentationKey = ['documentation'] as const
export const documentationSettingsKey = [
  ...documentationKey,
  'settings',
] as const
const base = '/api/extensions/docs'

export async function getDocumentation(): Promise<DocumentationIndex> {
  return requireServerSuccess(
    (await api.get<Envelope<DocumentationIndex>>(base)).data
  ).data
}

export async function getDocumentationArticle(
  slug: string
): Promise<DocumentationDetail> {
  return requireServerSuccess(
    (
      await api.get<Envelope<DocumentationDetail>>(
        `${base}/articles/${encodeURIComponent(slug)}`
      )
    ).data
  ).data
}

export async function searchDocumentation(
  query: string,
  signal?: AbortSignal
): Promise<DocumentationSearchResult[]> {
  return requireServerSuccess(
    (
      await api.get<Envelope<DocumentationSearchResult[]>>(`${base}/search`, {
        params: { q: query },
        signal,
      })
    ).data
  ).data
}

export async function getDocumentationSettings(): Promise<DocumentationSettings> {
  return requireServerSuccess(
    (await api.get<Envelope<DocumentationSettings>>(`${base}/admin/settings`))
      .data
  ).data
}

export async function saveDocumentationSettings(
  settings: DocumentationSettings
): Promise<DocumentationSettings> {
  return requireServerSuccess(
    (
      await api.put<Envelope<DocumentationSettings>>(
        `${base}/admin/settings`,
        settings
      )
    ).data
  ).data
}

export function documentationDownloadUrl(slug: string): string {
  return `${base}/articles/${encodeURIComponent(slug)}/markdown`
}
