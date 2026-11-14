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
import { dotColorMap, StatusBadge } from '@/components/status-badge'
import { cn } from '@/lib/utils'

import { useMonitorStatuses } from '../hooks/use-monitor-statuses'
import type { MonitorStatus } from '../types'

export function MonitorStatusBadge(props: { status: MonitorStatus }) {
  const statuses = useMonitorStatuses()
  return (
    <span className='inline-flex items-center gap-2 whitespace-nowrap'>
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0',
          dotColorMap[statuses[props.status].variant]
        )}
      />
      <StatusBadge
        {...statuses[props.status]}
        className='text-sm'
        type='text'
        copyable={false}
      />
    </span>
  )
}
