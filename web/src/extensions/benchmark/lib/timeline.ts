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
import type { RunSummary } from '../types'

export type TimelineSlot = { start: number; runs: RunSummary[] }

// Display range is independent of how often a group is checked.
// Preserve every retest in its window so a later pass cannot hide a failure.
export function buildTimeline(
  runs: RunSummary[],
  intervalSeconds: number,
  nextAt: number,
  now: number,
  historyHours = 48
): TimelineSlot[] {
  const interval = Math.max(60, intervalSeconds || 3600)
  const rangeSeconds = historyHours * 3600
  const count = Math.max(1, Math.ceil(rangeSeconds / interval))
  const anchor = nextAt > 0 ? nextAt : now
  const latestStart = anchor + Math.floor((now - anchor) / interval) * interval
  const firstStart = latestStart - (count - 1) * interval
  const slots: TimelineSlot[] = Array.from({ length: count }, (_, i) => ({
    start: firstStart + i * interval,
    runs: [],
  }))
  for (const run of runs) {
    if (run.created_at <= now - rangeSeconds || run.created_at > now) continue
    const index = Math.min(
      count - 1,
      Math.max(0, Math.floor((run.created_at - firstStart) / interval))
    )
    slots[index].runs.push(run)
  }
  for (const slot of slots) {
    slot.runs.sort((a, b) => b.created_at - a.created_at || b.id - a.id)
  }
  return slots
}
