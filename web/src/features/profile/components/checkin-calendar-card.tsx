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
import { CalendarCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'

export function CheckinEntryCard() {
  const { t } = useTranslation()
  return (
    <Card data-card-hover='false'>
      <CardHeader className='flex flex-row items-center gap-3'>
        <IconBadge tone='primary' size='title'>
          <CalendarCheck />
        </IconBadge>
        <div className='space-y-1'>
          <CardTitle>{t('Daily Check-in')}</CardTitle>
          <CardDescription>
            {t('View recharge qualification and claim daily check-in rewards.')}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Button className='w-full' render={<Link to='/checkin' />}>
          {t('Open daily check-in')}
        </Button>
      </CardContent>
    </Card>
  )
}
