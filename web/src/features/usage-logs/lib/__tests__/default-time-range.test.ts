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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  buildApiParams,
  getDefaultCommonLogsTimeRange,
  getDefaultTimeRange,
} from '../utils'

describe('usage logs default time range', () => {
  test('starts at local midnight and ends at the current time', () => {
    const before = Date.now()
    const { start, end } = getDefaultTimeRange()
    const after = Date.now()

    assert.equal(start.getHours(), 0)
    assert.equal(start.getMinutes(), 0)
    assert.equal(start.getSeconds(), 0)
    assert.equal(start.getMilliseconds(), 0)
    assert.ok(end.getTime() >= before)
    assert.ok(end.getTime() <= after)
  })

  test('common logs start at local midnight without a fixed end time', () => {
    const { start, end } = getDefaultCommonLogsTimeRange()

    assert.equal(start.getHours(), 0)
    assert.equal(start.getMinutes(), 0)
    assert.equal(start.getSeconds(), 0)
    assert.equal(start.getMilliseconds(), 0)
    assert.equal(end, undefined)
  })

  test('common log API params preserve an open-ended range', () => {
    const startTime = new Date(2026, 7, 11, 0, 0, 0, 0).getTime()
    const params = buildApiParams({
      page: 1,
      pageSize: 100,
      searchParams: { startTime },
      isAdmin: true,
    })

    assert.equal(params.start_timestamp, Math.floor(startTime / 1000))
    assert.equal(params.end_timestamp, undefined)
  })
})
