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
import { expect, it, vi } from 'vitest'

import { EmptyState } from '../empty-state'
import { ErrorState } from '../error-state'
import { LoadingState } from '../loading-state'

it('gives an empty module a themed background and retains its action', () => {
  render(
    <EmptyState
      title='No published groups'
      action={<a href='/system-settings/channel-monitor'>Configure groups</a>}
    />
  )

  expect(
    screen.getByText('No published groups').closest('[data-slot="empty"]')
  ).toHaveClass('bg-card', 'rounded-xl')
  expect(screen.getByRole('link', { name: 'Configure groups' })).toBeVisible()
})

it('keeps a failed module on a themed background with a working retry', async () => {
  const retry = vi.fn()
  const user = userEvent.setup()
  render(<ErrorState title='Unable to load groups' onRetry={retry} />)

  expect(
    screen.getByText('Unable to load groups').closest('[data-slot="empty"]')
  ).toHaveClass('bg-card', 'rounded-xl')
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(retry).toHaveBeenCalledOnce()
})

it('keeps a loading module on a rounded themed background', () => {
  render(<LoadingState message='Loading groups' />)

  expect(screen.getByText('Loading groups').parentElement).toHaveClass(
    'bg-card',
    'rounded-xl',
    'min-h-[200px]'
  )
})

it('keeps an inline loading indicator compact without a module background', () => {
  render(<LoadingState inline message='Refreshing groups' />)

  const indicator = screen.getByText('Refreshing groups').parentElement
  expect(indicator).toHaveClass('inline-flex')
  expect(indicator).not.toHaveClass('bg-card', 'min-h-[200px]')
})
