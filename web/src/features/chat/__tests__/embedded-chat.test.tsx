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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { Route as ChatRoute } from '@/routes/_authenticated/chat/$chatId'
import { useAuthStore } from '@/stores/auth-store'

const initialRouteOptions = { ...ChatRoute.options }
let client: QueryClient

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  window.localStorage.clear()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  useAuthStore.getState().auth.setUser({
    id: 11,
    username: 'chat-user',
    role: 1,
  })
})

afterEach(() => {
  cleanup()
  client.clear()
  ChatRoute.options = { ...initialRouteOptions }
  useAuthStore.getState().auth.reset('idle')
  window.localStorage.clear()
  vi.restoreAllMocks()
})

async function renderChat(url: string) {
  client.setQueryData(STATUS_QUERY_KEY, {
    chats: [{ 'Preview client': url }],
    server_address: 'https://gateway.example',
  })
  const root = createRootRoute({ component: Outlet })
  const authenticated = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
    component: Outlet,
  })
  // File routes receive their parent and path from the generated route tree.
  Object.assign(ChatRoute.options, {
    id: '/chat/$chatId',
    path: '/chat/$chatId',
    getParentRoute: () => authenticated,
  })
  const router = createRouter({
    routeTree: root.addChildren([authenticated.addChildren([ChatRoute])]),
    history: createMemoryHistory({ initialEntries: ['/chat/0'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

test.each([
  'https://client.example/chat',
  `${window.location.origin}/chat-app`,
])(
  'a configured web chat at %s runs in an opaque sandbox without camera or microphone access',
  async (url) => {
    await renderChat(url)
    const frame = await screen.findByTitle('Chat preset: Preview client')

    expect(frame).toHaveAttribute('src', url)
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-forms')
    expect(frame).not.toHaveAttribute('allow')
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
  }
)

test('an embedded chat offers a keyboard-accessible standalone link without opener or referrer access', async () => {
  const user = userEvent.setup()
  await renderChat('https://client.example/chat')
  const link = await screen.findByRole('link', { name: 'Open in new tab' })
  const activate = vi.fn((event: Event) => event.preventDefault())
  link.addEventListener('click', activate)

  expect(link).toHaveAttribute('href', 'https://client.example/chat')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  expect(link).toHaveAttribute('referrerpolicy', 'no-referrer')
  expect(
    screen.getByText(
      'If the embedded chat does not work properly, open it in a new tab.'
    )
  ).toBeVisible()

  await user.tab()
  expect(link).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(activate).toHaveBeenCalledOnce()
})

test('a key-dependent chat withholds navigation until the enabled key resolves and uses the resolved URL for both destinations', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        items: [
          { id: 31, status: 2 },
          { id: 32, status: 1 },
        ],
      },
    },
  })
  let finishKeyLookup = (_response: {
    data: { success: boolean; data: { key: string } }
  }) => {}
  const keyResponse = new Promise<{
    data: { success: boolean; data: { key: string } }
  }>((resolve) => {
    finishKeyLookup = resolve
  })
  const post = vi.spyOn(api, 'post').mockReturnValue(keyResponse)
  await renderChat('https://client.example/chat?key={key}&server={address}')

  expect(await screen.findByText('Preparing your chat link…')).toBeVisible()
  expect(
    screen.queryByTitle('Chat preset: Preview client')
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: 'Open in new tab' })
  ).not.toBeInTheDocument()
  await waitFor(() => expect(post).toHaveBeenCalledWith('/api/token/32/key'))

  act(() =>
    finishKeyLookup({
      data: { success: true, data: { key: 'test-active-key' } },
    })
  )
  const frame = await screen.findByTitle('Chat preset: Preview client')
  const resolvedUrl =
    'https://client.example/chat?key=sk-test-active-key&server=https%3A%2F%2Fgateway.example'
  expect(frame).toHaveAttribute('src', resolvedUrl)
  expect(screen.getByRole('link', { name: 'Open in new tab' })).toHaveAttribute(
    'href',
    resolvedUrl
  )
})

test('a chat without an enabled API key keeps the error state and exposes no unresolved link', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { items: [{ id: 31, status: 2 }] } },
  })
  const post = vi.spyOn(api, 'post')
  await renderChat('https://client.example/chat?key={key}')

  expect(await screen.findByText('Unable to open chat')).toBeVisible()
  expect(
    screen.queryByTitle('Chat preset: Preview client')
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: 'Open in new tab' })
  ).not.toBeInTheDocument()
  expect(post).not.toHaveBeenCalled()
})
