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
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'

import { SettingsPage } from '../settings-page'
import { SettingsPageFormActions } from '../settings-page-context'

afterEach(() => {
  vi.restoreAllMocks()
})

test('settings retain a full-width card after a failed load and retry without losing header actions', async () => {
  const save = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  vi.spyOn(api, 'get')
    .mockRejectedValueOnce(new Error('Settings service unavailable'))
    .mockResolvedValueOnce({
      data: {
        success: true,
        data: [{ key: 'SystemName', value: 'New API' }],
      },
    })
  const root = createRootRoute()
  const route = createRoute({
    getParentRoute: () => root,
    path: '/settings/$section',
    component: () => (
      <SettingsPage
        routePath='/settings/$section'
        defaultSettings={{ SystemName: '' }}
        defaultSection='site'
        getSectionMeta={() => ({ titleKey: 'System Settings' })}
        getSectionContent={(_section, settings) => (
          <>
            <Input
              aria-label='System Name'
              value={settings.SystemName}
              readOnly
            />
            <SettingsPageFormActions onSave={save} />
          </>
        )}
      />
    ),
  })
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/settings/site'] }),
  })
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  const user = userEvent.setup()

  try {
    const retry = await screen.findByRole('button', { name: 'Retry' })
    expect(retry.closest('[data-slot="card"]')).toHaveClass('bg-card', 'w-full')
    await user.click(retry)
    const name = await screen.findByRole('textbox', { name: 'System Name' })
    expect(name).toHaveValue('New API')
    expect(name.closest('[data-slot="card"]')).toHaveClass('bg-card', 'w-full')
    const header = screen
      .getByRole('heading', { name: 'System Settings' })
      .closest('header')
    if (!header) throw new Error('Expected settings page introduction')
    await user.click(
      within(header).getByRole('button', { name: 'Save Changes' })
    )
    expect(save).toHaveBeenCalledOnce()
  } finally {
    view.unmount()
    client.clear()
  }
})
