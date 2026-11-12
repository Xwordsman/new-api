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
import type { TFunction } from 'i18next'

const EXTENSION_NAV_ITEMS = [
  {
    titleKey: 'Daily Check-in',
    url: '/system-settings/checkin',
  },
  {
    titleKey: 'Documentation center',
    url: '/system-settings/documentation',
  },
  {
    titleKey: 'Concurrency management',
    url: '/system-settings/concurrency',
  },
  {
    titleKey: 'Email templates',
    url: '/system-settings/email-templates',
  },
  {
    titleKey: 'Request protection',
    url: '/system-settings/request-protection',
  },
  {
    titleKey: 'Key price protection',
    url: '/system-settings/key-price-protection',
  },
  {
    titleKey: 'Registration protection',
    url: '/system-settings/registration-risk',
  },
  {
    titleKey: 'Community leaderboard',
    url: '/system-settings/leaderboard',
  },
  {
    titleKey: 'Model benchmark',
    url: '/system-settings/benchmark',
  },
  {
    titleKey: 'Channel monitor',
    url: '/system-settings/channel-monitor',
  },
  {
    titleKey: 'Referral program',
    url: '/system-settings/referrals',
  },
  {
    titleKey: 'Invitation Management',
    url: '/system-settings/invitation/settings',
    activeUrls: ['/system-settings/invitation/codes'],
  },
] as const

export function getExtensionNavItems(t: TFunction) {
  return EXTENSION_NAV_ITEMS.map((item) => ({
    title: t(item.titleKey),
    url: item.url,
    ...('activeUrls' in item ? { activeUrls: [...item.activeUrls] } : {}),
  }))
}
