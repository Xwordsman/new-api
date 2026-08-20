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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { TFunction } from 'i18next'

import { getExtensionNavItems } from '../../navigation-registry'
import {
  getInvitationSectionNavItems,
  INVITATION_SECTION_IDS,
} from '../section-registry'

const translate = ((key: string) => key) as TFunction

describe('invitation extension navigation', () => {
  test('exposes one plugin entry for all invitation sections', () => {
    const invitationItems = getExtensionNavItems(translate).filter((item) =>
      item.url.startsWith('/system-settings/invitation/')
    )

    assert.deepEqual(invitationItems, [
      {
        title: 'Invitation Management',
        url: '/system-settings/invitation/settings',
        activeUrls: ['/system-settings/invitation/codes'],
      },
    ])
  })

  test('keeps settings and code management available inside the entry', () => {
    const sections = getInvitationSectionNavItems(translate)

    assert.deepEqual(
      sections.map((item) => item.section),
      INVITATION_SECTION_IDS
    )
    assert.deepEqual(
      sections.map((item) => item.title),
      ['Invitation Settings', 'Code Management']
    )
  })
})
