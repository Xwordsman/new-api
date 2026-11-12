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
import type { SystemStatus } from '@/features/auth/types'

export function getDocumentationLink(
  status: Pick<SystemStatus, 'docs_link' | 'extension_features'> | null
): { href: string; external: boolean } | null {
  if (status?.extension_features?.documentation) {
    return { href: '/docs', external: false }
  }

  const href = status?.docs_link?.trim()
  if (!href) return null
  // A disabled center must not leave a dead local entry in the navigation.
  if (/^\/docs(?:[/?#]|$)/.test(href)) return null
  if (/^https?:\/\//i.test(href)) return { href, external: true }
  if (href.startsWith('/') && !href.startsWith('//')) {
    return { href, external: false }
  }
  return null
}
