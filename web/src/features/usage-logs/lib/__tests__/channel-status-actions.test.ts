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

import { CHANNEL_STATUS } from '@/features/channels/constants'

import { getChannelStatusActionAvailability } from '../channel-status-actions'

describe('usage log channel status actions', () => {
  test('shows disable for an enabled channel', () => {
    assert.deepEqual(
      getChannelStatusActionAvailability(true, 12, CHANNEL_STATUS.ENABLED),
      { canEnableChannel: false, canDisableChannel: true }
    )
  })

  test('shows enable for a manually disabled channel', () => {
    assert.deepEqual(
      getChannelStatusActionAvailability(
        true,
        12,
        CHANNEL_STATUS.MANUAL_DISABLED
      ),
      { canEnableChannel: true, canDisableChannel: false }
    )
  })

  test('allows recovery or manual disable for an auto-disabled channel', () => {
    assert.deepEqual(
      getChannelStatusActionAvailability(
        true,
        12,
        CHANNEL_STATUS.AUTO_DISABLED
      ),
      { canEnableChannel: true, canDisableChannel: true }
    )
  })

  test('hides channel actions without permission or a valid channel', () => {
    assert.deepEqual(
      getChannelStatusActionAvailability(false, 12, CHANNEL_STATUS.ENABLED),
      { canEnableChannel: false, canDisableChannel: false }
    )
    assert.deepEqual(
      getChannelStatusActionAvailability(true, 0, CHANNEL_STATUS.ENABLED),
      { canEnableChannel: false, canDisableChannel: false }
    )
    assert.deepEqual(
      getChannelStatusActionAvailability(true, 12, CHANNEL_STATUS.UNKNOWN),
      { canEnableChannel: false, canDisableChannel: false }
    )
    assert.deepEqual(getChannelStatusActionAvailability(true, 12, 99), {
      canEnableChannel: false,
      canDisableChannel: false,
    })
  })
})
