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
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { AxiosAdapter } from 'axios'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { useTicketList } from '@/extensions/tickets/hooks'
import { api } from '@/lib/http-client'
import { createAppQueryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'

const originalAdapter = api.defaults.adapter
const ticketList = { items: [], total: 0, page: 1, page_size: 20 }
const adapter = vi.fn<AxiosAdapter>(async (config) => ({
  data: { success: true, message: '', data: ticketList },
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
}))

beforeEach(() => {
  useAuthStore.getState().auth.reset()
  api.defaults.adapter = adapter
})

afterEach(() => {
  cleanup()
  api.defaults.adapter = originalAdapter
  useAuthStore.getState().auth.reset()
})

it('starts a fresh GET when the previous caller aborts before the request is sent', async () => {
  const controller = new AbortController()
  const canceled = api.get('/api/extensions/tickets', {
    signal: controller.signal,
  })
  const cancellation = expect(canceled).rejects.toMatchObject({
    code: 'ERR_CANCELED',
  })
  controller.abort()
  const next = api.get('/api/extensions/tickets', {
    signal: new AbortController().signal,
  })

  await cancellation
  await expect(next).resolves.toMatchObject({ data: { data: ticketList } })
})

it('does not cancel another active caller when one of two signaled GETs aborts', async () => {
  const controller = new AbortController()
  const first = api.get('/api/extensions/tickets', {
    signal: controller.signal,
  })
  const second = api.get('/api/extensions/tickets', {
    signal: new AbortController().signal,
  })
  const cancellation = expect(first).rejects.toMatchObject({
    code: 'ERR_CANCELED',
  })
  const result = expect(second).resolves.toMatchObject({
    data: { data: ticketList },
  })
  controller.abort()

  await Promise.all([cancellation, result])
})

it.each([true, false])(
  'keeps cancellation independent of an unsignaled GET when the signaled caller starts first: %s',
  async (signaledFirst) => {
    const controller = new AbortController()
    const configs = [{ signal: controller.signal }, {}]
    if (!signaledFirst) configs.reverse()
    const requests = configs.map((config) =>
      api.get('/api/extensions/tickets', config)
    )
    const checks = requests.map((request, index) => {
      if (configs[index].signal) {
        return expect(request).rejects.toMatchObject({ code: 'ERR_CANCELED' })
      }
      return expect(request).resolves.toMatchObject({
        data: { data: ticketList },
      })
    })
    controller.abort()

    await Promise.all(checks)
  }
)

it('still deduplicates concurrent GETs without a caller-owned signal', async () => {
  const results = await Promise.all([
    api.get('/api/extensions/tickets'),
    api.get('/api/extensions/tickets'),
  ])

  expect(results.map((response) => response.data.data)).toEqual([
    ticketList,
    ticketList,
  ])
  expect(adapter).toHaveBeenCalledTimes(1)
})

it('loads the ticket query immediately after a StrictMode remount without a retry or polling', async () => {
  const client = createAppQueryClient()
  client.setDefaultOptions({ queries: { retry: false, gcTime: 0 } })
  useAuthStore.getState().auth.setUser({
    id: 7,
    username: 'ticket-owner',
    role: 1,
  })

  try {
    const hook = renderHook(
      () =>
        useTicketList('mine', {
          page: 1,
          search: '',
          status: '',
          unread: false,
        }),
      {
        reactStrictMode: true,
        wrapper: (props: { children: ReactNode }) => (
          <QueryClientProvider client={client}>
            {props.children}
          </QueryClientProvider>
        ),
      }
    )

    await waitFor(() => expect(hook.result.current.isPending).toBe(false))
    expect(hook.result.current.error).toBeNull()
    expect(hook.result.current.data).toEqual(ticketList)
  } finally {
    cleanup()
    client.clear()
  }
})
