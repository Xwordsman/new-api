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
import { describe, expect, it } from 'vitest'

import { buildTimeline } from '../lib/timeline'
import type { RunSummary } from '../types'

const result: RunSummary = {
  id: 1,
  kind: 'candy',
  status: 'passed',
  created_at: 1800000000,
  latency_ms: 1000,
  prompt_name: '',
}

describe('benchmark history display range', () => {
  it.each([24, 48, 72])(
    'shows %i hours without changing the hourly detection interval',
    (hours) => {
      const older = {
        ...result,
        id: 2,
        created_at: result.created_at - 25 * 3600,
      }
      const slots = buildTimeline(
        [result, older],
        3600,
        1800003600,
        1800000000,
        hours
      )
      expect(slots).toHaveLength(hours)
      expect(slots[1].start - slots[0].start).toBe(3600)
      expect(slots.flatMap((slot) => slot.runs)).toEqual(
        hours === 24 ? [result] : [older, result]
      )
    }
  )

  it('defaults to 48 hours and excludes expired and future results', () => {
    const slots = buildTimeline(
      [
        result,
        { ...result, id: 2, created_at: result.created_at - 48 * 3600 },
        { ...result, id: 3, created_at: result.created_at + 1 },
      ],
      3600,
      1800003600,
      1800000000
    )
    expect(slots).toHaveLength(48)
    expect(slots.flatMap((slot) => slot.runs)).toEqual([result])
  })

  it('reserves 24 hourly slots with only the newest slot filled for one result', () => {
    const slots = buildTimeline([result], 3600, 1800003600, 1800000000, 24)
    expect(slots).toHaveLength(24)
    expect(slots.slice(0, 23).every((slot) => slot.runs.length === 0)).toBe(
      true
    )
    expect(slots[23].runs).toEqual([result])
  })

  it('uses each group frequency and keeps failures and manual retests within the same slot', () => {
    const failed = {
      ...result,
      id: 2,
      status: 'wrong_answer' as const,
      created_at: result.created_at - 60,
    }
    const slots = buildTimeline(
      [result, failed],
      1800,
      1800001800,
      1800000100,
      24
    )
    expect(slots).toHaveLength(48)
    expect(
      slots
        .flatMap((slot) => slot.runs)
        .map((run) => run.id)
        .sort()
    ).toEqual([1, 2])
  })

  it('excludes records outside the visible day and future records without shifting the schedule', () => {
    const slots = buildTimeline(
      [
        result,
        { ...result, id: 2, created_at: 1800000001 },
        { ...result, id: 3, created_at: 1799900000 },
      ],
      3600,
      1800003600,
      1800000000,
      24
    )
    expect(slots.flatMap((slot) => slot.runs)).toEqual([result])
  })
})
