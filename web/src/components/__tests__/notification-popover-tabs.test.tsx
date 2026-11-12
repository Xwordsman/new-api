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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { NotificationPopover } from '../notification-popover'

const animations = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'getAnimations'
)
beforeAll(() =>
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
)
afterAll(() => {
  if (animations) {
    Object.defineProperty(HTMLElement.prototype, 'getAnimations', animations)
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations')
  }
})

function Notifications(props: { extended?: boolean }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'notice' | 'announcements'>('notice')
  return (
    <NotificationPopover
      open={open}
      onOpenChange={setOpen}
      unreadCount={2}
      activeTab={tab}
      onTabChange={setTab}
      notice='Saved platform notice'
      announcements={[{ id: 1, content: 'Existing announcement' }]}
      loading={false}
      additionalTabs={
        props.extended
          ? [
              {
                value: 'tickets',
                label: 'Tickets',
                content: <p>A new support reply</p>,
              },
            ]
          : undefined
      }
    />
  )
}

it('keeps existing notice and timeline navigation working when a ticket tab is added', async () => {
  const user = userEvent.setup()
  render(<Notifications extended />)
  await user.click(screen.getByRole('button', { name: 'Notifications' }))
  expect(await screen.findByText('Saved platform notice')).toBeVisible()
  await user.click(screen.getByRole('tab', { name: 'Tickets' }))
  expect(screen.getByRole('tab', { name: 'Tickets' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(await screen.findByText('A new support reply')).toBeVisible()
  await user.click(screen.getByRole('tab', { name: 'Timeline' }))
  expect(await screen.findByText('Existing announcement')).toBeVisible()
  await user.click(screen.getByRole('tab', { name: 'Notice' }))
  expect(await screen.findByText('Saved platform notice')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('tab', { name: 'Tickets' })).not.toBeInTheDocument()
})

it('preserves the original two-tab popover for callers without extra tabs', async () => {
  const user = userEvent.setup()
  render(<Notifications />)
  await user.click(screen.getByRole('button', { name: 'Notifications' }))
  expect(await screen.findByText('System Announcements')).toBeVisible()
  expect(screen.getAllByRole('tab')).toHaveLength(2)
  await user.click(screen.getByRole('tab', { name: 'Timeline' }))
  expect(await screen.findByText('Existing announcement')).toBeVisible()
})
