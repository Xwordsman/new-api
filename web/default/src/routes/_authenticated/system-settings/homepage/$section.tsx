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
import { createFileRoute, redirect } from '@tanstack/react-router'

import { HomepageExtension } from '@/extensions/homepage'
import {
  HOMEPAGE_DEFAULT_SECTION,
  HOMEPAGE_SECTION_IDS,
} from '@/extensions/homepage/section-registry'

export const Route = createFileRoute(
  '/_authenticated/system-settings/homepage/$section'
)({
  beforeLoad: ({ params }) => {
    if (!(HOMEPAGE_SECTION_IDS as readonly string[]).includes(params.section)) {
      throw redirect({
        to: '/system-settings/homepage/$section',
        params: { section: HOMEPAGE_DEFAULT_SECTION },
      })
    }
  },
  component: HomepageExtension,
})
