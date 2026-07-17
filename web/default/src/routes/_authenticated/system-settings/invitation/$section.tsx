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

import { InvitationExtension } from '@/extensions/invitation'
import {
  INVITATION_DEFAULT_SECTION,
  INVITATION_SECTION_IDS,
} from '@/extensions/invitation/section-registry'

export const Route = createFileRoute(
  '/_authenticated/system-settings/invitation/$section'
)({
  beforeLoad: ({ params }) => {
    if (
      !(INVITATION_SECTION_IDS as readonly string[]).includes(params.section)
    ) {
      throw redirect({
        to: '/system-settings/invitation/$section',
        params: { section: INVITATION_DEFAULT_SECTION },
      })
    }
  },
  component: InvitationExtension,
})
