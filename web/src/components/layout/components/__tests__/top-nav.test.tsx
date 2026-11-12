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
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'

import type { TopNavLink } from '../../types'
import { TopNav } from '../top-nav'

const links: TopNavLink[] = [
  { title: 'Home', href: '/' },
  { title: 'Console', href: '/dashboard' },
  { title: 'Models', href: '/pricing' },
  {
    title: 'Unavailable docs',
    href: 'https://example.com/docs',
    external: true,
    disabled: true,
  },
]

async function renderNavigation() {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <TopNav links={links} />,
    }),
    history: createMemoryHistory({
      initialEntries: ['/dashboard/overview'],
    }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
  return router
}

test('a nested console page keeps its top navigation entry active', async () => {
  await renderNavigation()
  const navigation = await screen.findByRole('navigation')

  expect(
    within(navigation).getByRole('link', { name: 'Console' })
  ).toHaveAttribute('aria-current', 'page')
  expect(
    within(navigation).getByRole('link', { name: 'Home' })
  ).not.toHaveAttribute('aria-current')
  expect(
    within(navigation).getByRole('link', { name: 'Unavailable docs' })
  ).toHaveAttribute('aria-disabled', 'true')
})

test('the compact navigation supports keyboard selection and keeps disabled entries unavailable', async () => {
  const user = userEvent.setup()
  const router = await renderNavigation()
  const trigger = await screen.findByRole('button', {
    name: 'Toggle navigation menu',
  })
  await user.click(trigger)
  const models = await screen.findByRole('menuitem', { name: 'Models' })

  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(
    screen.getByRole('menuitem', { name: 'Unavailable docs' })
  ).toHaveAttribute('aria-disabled', 'true')

  models.focus()
  await user.keyboard('{Enter}')

  await waitFor(() => expect(router.state.location.pathname).toBe('/pricing'))
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
})
