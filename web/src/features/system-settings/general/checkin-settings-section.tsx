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
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import { SettingsSection } from '../components/settings-section'

export function CheckinSettingsSection() {
  const { t } = useTranslation()
  return (
    <SettingsSection title={t('Check-in Settings')}>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Check-in settings are managed in the Daily Check-in plugin, including recharge requirements, reward limits and account review.'
        )}
      </p>
      <Button variant='outline' render={<Link to='/system-settings/checkin' />}>
        {t('Open check-in plugin settings')}
      </Button>
    </SettingsSection>
  )
}
