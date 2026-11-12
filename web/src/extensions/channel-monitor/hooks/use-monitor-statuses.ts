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

export function useMonitorStatuses() {
  const { t } = useTranslation()
  return {
    healthy: { label: t('Operating normally'), variant: 'success' },
    degraded: { label: t('Fluctuating'), variant: 'warning' },
    unhealthy: { label: t('Abnormal'), variant: 'danger' },
    idle: { label: t('No recent traffic'), variant: 'neutral' },
    unknown: { label: t('Unknown'), variant: 'neutral' },
    disabled: { label: t('No enabled routes'), variant: 'neutral' },
  } as const
}
