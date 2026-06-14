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

export interface MonitorLogItem {
  channel_id: number
  channel_name: string
  status: number
  response_time: number
  error_message?: string
  tested_at: number
}

export interface ChannelStats {
  channel_id: number
  channel_name: string
  total_tests: number
  success_tests: number
  uptime_percent: number
}

export interface MonitorStatusResponse {
  start_time: number
  end_time: number
  hours: number
  model_groups: Record<string, MonitorLogItem[]>
  channel_stats: Record<number, ChannelStats>
  total_logs: number
}
