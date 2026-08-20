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
import { getRouteApi } from '@tanstack/react-router'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

import {
  getInvitationSectionNavItems,
  INVITATION_SECTION_IDS,
  type InvitationSectionId,
} from './section-registry'

const route = getRouteApi('/_authenticated/system-settings/invitation/$section')

function isInvitationSectionId(value: string): value is InvitationSectionId {
  return (INVITATION_SECTION_IDS as readonly string[]).includes(value)
}

export function InvitationSectionTabs() {
  const { t } = useTranslation()
  const navigate = route.useNavigate()
  const { section } = route.useParams()

  const handleSectionChange = useCallback(
    (nextSection: string) => {
      if (!isInvitationSectionId(nextSection)) return

      void navigate({
        to: '/system-settings/invitation/$section',
        params: { section: nextSection },
      })
    },
    [navigate]
  )

  return (
    <Tabs value={section} onValueChange={handleSectionChange}>
      <TabsList
        aria-label={t('Invitation Management')}
        className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto'
      >
        {getInvitationSectionNavItems(t).map((item) => (
          <TabsTrigger key={item.section} value={item.section}>
            {item.title}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
