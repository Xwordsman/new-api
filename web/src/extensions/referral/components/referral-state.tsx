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
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'

export function ReferralState(props: { state: string }) {
  const { t } = useTranslation()
  let label = t('Under review')
  let variant: 'outline' | 'secondary' | 'warning' | 'destructive' = 'warning'
  switch (props.state) {
    case 'active':
      label = t('Earning rewards')
      variant = 'outline'
      break
    case 'expired':
      label = t('Reward window ended')
      variant = 'secondary'
      break
    case 'capped':
      label = t('Reward cap reached')
      variant = 'secondary'
      break
    case 'historical':
      label = t('Historical invitation')
      break
    case 'ineligible':
      label = t('Not eligible')
      variant = 'destructive'
      break
    case 'pending':
      label = t('Ready to claim')
      variant = 'outline'
      break
    case 'cooling':
      label = t('Cooling down')
      variant = 'secondary'
      break
    case 'unpriced':
      label = t('Awaiting reconciliation')
      break
    case 'claimed':
      label = t('Claimed')
      variant = 'outline'
      break
    case 'refunded':
      label = t('Refunded')
      variant = 'secondary'
      break
    case 'empty':
      label = t('No reward')
      variant = 'secondary'
      break
  }
  return (
    <Badge variant={variant} className='rounded-md text-[11px]'>
      {label}
    </Badge>
  )
}
