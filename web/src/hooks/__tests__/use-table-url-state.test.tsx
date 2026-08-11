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
import { after, describe, test } from 'node:test'

import { Window } from 'happy-dom'
import { useEffect } from 'react'

const domWindow = new Window()
const domGlobals = [
  'window',
  'document',
  'localStorage',
  'HTMLElement',
] as const

for (const key of domGlobals) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: domWindow[key],
  })
}

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { useTableUrlState } = await import('../use-table-url-state')

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

type TableState = ReturnType<typeof useTableUrlState>

describe('local table state', () => {
  after(() => {
    domWindow.close()
  })

  test('updates filters and pagination without navigating', async () => {
    const navigateCalls: unknown[] = []
    let state: TableState | undefined

    function Harness() {
      const current = useTableUrlState({
        search: {},
        navigate: (options) => navigateCalls.push(options),
        syncToUrl: false,
        pagination: { defaultPage: 1, defaultPageSize: 20 },
        globalFilter: { enabled: false },
        columnFilters: [
          { columnId: 'model_name', searchKey: 'model', type: 'string' },
        ],
      })

      useEffect(() => {
        state = current
      }, [current])
      return null
    }

    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => root.render(<Harness />))
    assert.ok(state)

    await act(async () => {
      state?.onPaginationChange({ pageIndex: 2, pageSize: 50 })
      state?.onColumnFiltersChange([{ id: 'model_name', value: 'gpt-5' }])
    })

    assert.equal(navigateCalls.length, 0)
    assert.deepEqual(state?.pagination, { pageIndex: 2, pageSize: 50 })
    assert.deepEqual(state?.columnFilters, [
      { id: 'model_name', value: 'gpt-5' },
    ])

    await act(async () => root.unmount())
  })
})
