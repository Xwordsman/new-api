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
import type { HomepageSettings } from './types'

export function parseHomepageSettings(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const settings = value as Partial<HomepageSettings>
  if (
    typeof settings.enabled !== 'boolean' ||
    (settings.mode !== 'showcase' && settings.mode !== 'not_found')
  ) {
    return null
  }
  const buttonURL =
    typeof settings.button_url === 'string'
      ? settings.button_url.slice(0, 2048)
      : ''
  const safeButtonURL =
    buttonURL === '' ||
    (/^\/(?!\/)/.test(buttonURL) && !/[\r\n]/.test(buttonURL)) ||
    /^https?:\/\/[^\s]+$/i.test(buttonURL)

  return {
    enabled: settings.enabled,
    mode: settings.mode,
    title:
      typeof settings.title === 'string' ? settings.title.slice(0, 120) : '',
    description:
      typeof settings.description === 'string'
        ? settings.description.slice(0, 500)
        : '',
    button_text:
      typeof settings.button_text === 'string'
        ? settings.button_text.slice(0, 50)
        : '',
    button_url: safeButtonURL ? buttonURL : '',
  } satisfies HomepageSettings
}
