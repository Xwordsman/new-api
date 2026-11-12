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
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { SidebarProvider } from '@/components/ui/sidebar'
import { LayoutProvider } from '@/context/layout-provider'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { AppSidebar } from '../app-sidebar'
import { Header } from '../header'
import { SystemBrand } from '../system-brand'

const initialSystemConfig = useSystemConfigStore.getState()
let client: QueryClient

beforeEach(() => {
  for (const name of [
    'layout_collapsible',
    'layout_variant',
    'sidebar_state',
  ]) {
    document.cookie = `${name}=; path=/; max-age=0`
  }
  vi.stubGlobal('innerWidth', 1280)
  useAuthStore.getState().auth.setUser({ id: 1, username: 'alice', role: 1 })
  useSystemConfigStore.getState().setLoading(false)
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(['status'], { system_name: 'New API' })
})

afterEach(() => {
  cleanup()
  client.clear()
  useAuthStore.getState().auth.reset()
  useSystemConfigStore.setState(initialSystemConfig)
  vi.unstubAllGlobals()
  for (const name of [
    'layout_collapsible',
    'layout_variant',
    'sidebar_state',
  ]) {
    document.cookie = `${name}=; path=/; max-age=0`
  }
})

async function renderNavigation(
  brandProps: ComponentProps<typeof SystemBrand> = {}
) {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <LayoutProvider>
          <SidebarProvider>
            <Header>
              <SystemBrand variant='inline' {...brandProps} />
            </Header>
            <AppSidebar />
          </SidebarProvider>
        </LayoutProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ['/dashboard/overview'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

test('desktop navigation collapses and reopens from the sidebar without a control before the brand', async () => {
  const user = userEvent.setup()
  const { container } = await renderNavigation()
  const collapse = await screen.findByRole('button', { name: 'Collapse' })

  expect(collapse.closest('[data-slot="sidebar-footer"]')).not.toBeNull()
  expect(within(screen.getByRole('banner')).queryByRole('button')).toBeNull()

  await user.click(collapse)
  const expand = screen.getByRole('button', { name: 'Expand' })
  expect(expand).toHaveAttribute('aria-expanded', 'false')
  expect(container.querySelector('[data-slot="sidebar"]')).toHaveAttribute(
    'data-state',
    'collapsed'
  )

  expand.focus()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('button', { name: 'Collapse' })).toHaveAttribute(
    'aria-expanded',
    'true'
  )
})

test('mobile navigation opens after the brand and closes from inside the menu', async () => {
  vi.stubGlobal('innerWidth', 390)
  const user = userEvent.setup()
  await renderNavigation()
  const header = await screen.findByRole('banner')
  const open = await within(header).findByRole('button', { name: 'Open menu' })
  const brand = within(header).getByRole('link', { name: 'Go to home' })

  expect(
    brand.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(open).toHaveAttribute('aria-expanded', 'false')
  await user.click(open)
  const menu = await screen.findByRole('dialog')
  expect(open).toHaveAttribute('aria-expanded', 'true')

  await user.click(within(menu).getByRole('button', { name: 'Close menu' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(open).toHaveAttribute('aria-expanded', 'false')
})

test('offcanvas navigation can still be reopened from the end of the header', async () => {
  document.cookie = 'layout_collapsible=offcanvas; path=/'
  const user = userEvent.setup()
  await renderNavigation()
  const header = await screen.findByRole('banner')
  const toggle = within(header).getByRole('button', {
    name: 'Toggle navigation menu',
  })

  await user.click(screen.getByRole('button', { name: 'Collapse' }))
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
})

test('shared header branding preserves a custom site name, logo and home destination', async () => {
  await renderNavigation({
    name: 'New API Preview',
    logo: <img src='/custom-logo.svg' alt='Custom logo' />,
    homeUrl: '/pricing',
  })
  const brand = await screen.findByRole('link', { name: 'Go to home' })

  expect(brand).toHaveAttribute('href', '/pricing')
  expect(within(brand).getByText('New API Preview')).toBeInTheDocument()
  expect(
    within(brand).getByRole('img', { name: 'Custom logo' })
  ).toHaveAttribute('src', '/custom-logo.svg')
})
