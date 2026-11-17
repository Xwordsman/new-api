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
import { expect, it } from 'vitest'

import { HistoryStrip } from '../components/history-strip'

it('keeps history to one tab stop and lets arrow keys inspect adjacent periods', async () => {
  const user = userEvent.setup()
  render(
    <HistoryStrip
      buckets={[
        {
          start: 1700000000,
          end: 1700000100,
          status: 'healthy',
          outcomes: 2,
          successes: 2,
          success_rate: 100,
        },
        {
          start: 1700000100,
          end: 1700000200,
          status: 'unknown',
          outcomes: 0,
          successes: 0,
          success_rate: null,
        },
      ]}
    />
  )
  const periods = screen.getAllByRole('button')
  expect(periods.filter((period) => period.tabIndex === 0)).toHaveLength(1)
  await user.tab()
  expect(periods[0]).toHaveFocus()
  await user.keyboard('{ArrowRight}')
  expect(periods[1]).toHaveFocus()
  expect(periods[1]).toHaveAccessibleName(/Unknown/)
  await user.keyboard('{Home}')
  expect(periods[0]).toHaveFocus()
})

it('keeps all 48 compact history bars visible without transparent button borders consuming their width', () => {
  render(
    <HistoryStrip
      buckets={Array.from({ length: 48 }, (_, index) => ({
        start: 1700000000 + index * 1800,
        end: 1700000000 + (index + 1) * 1800,
        status: 'unknown' as const,
        outcomes: 0,
        successes: 0,
        success_rate: null,
      }))}
    />
  )
  expect(screen.getByRole('group', { name: 'Observed history' })).toHaveClass(
    'gap-px'
  )
  const periods = screen.getAllByRole('button')
  expect(periods).toHaveLength(48)
  for (const period of periods) {
    expect(period).toHaveClass('border-0')
  }
})

it('shows one bucket timestamp, request count and success rate on one line when hovering a period', async () => {
  const user = userEvent.setup()
  const start = new Date(2026, 10, 17, 12, 0).getTime() / 1000
  render(
    <HistoryStrip
      buckets={[
        {
          start,
          end: start + 1800,
          status: 'healthy',
          outcomes: 2,
          successes: 2,
          success_rate: 100,
        },
      ]}
    />
  )

  await user.hover(screen.getByRole('button'))

  const tooltip = await screen.findByText(
    /^2026-11-17 12:00 · Requests: 2 · Success rate: 100%$/
  )
  expect(tooltip).toHaveClass('max-w-none', 'whitespace-nowrap')
})

it('shows an unknown success rate for an unobserved period instead of implying success', async () => {
  const user = userEvent.setup()
  const start = new Date(2026, 10, 17, 12, 30).getTime() / 1000
  render(
    <HistoryStrip
      buckets={[
        {
          start,
          end: start + 1800,
          status: 'unknown',
          outcomes: 0,
          successes: 0,
          success_rate: null,
        },
      ]}
    />
  )

  await user.hover(screen.getByRole('button'))

  expect(
    await screen.findByText(
      /^2026-11-17 12:30 · Requests: 0 · Success rate: —$/
    )
  ).toBeVisible()
})
