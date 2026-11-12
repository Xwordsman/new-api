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
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'

import { LeaderboardPage } from '../index'
import type { LeaderboardSnapshot, RankEntry } from '../types'

const today: RankEntry[] = [
  { rank: 1, name: 'A***', value: 120000, is_me: false },
  { rank: 2, name: 'My account', value: 90000, is_me: true },
  { rank: 3, name: 'C***', value: 80000, is_me: false },
  { rank: 4, name: 'D***', value: 70000, is_me: false },
  { rank: 5, name: 'E***', value: 60000, is_me: false },
]
const periods = {
  today,
  yesterday: [
    { rank: 1, name: 'Yesterday participant', value: 100, is_me: false },
  ],
  all: [{ rank: 1, name: 'All-time participant', value: 800000, is_me: false }],
}
const fixture: LeaderboardSnapshot = {
  enabled: true,
  pending: false,
  stale: false,
  updated_at: 1800000000,
  day_start: 1799942400,
  refresh_minutes: 30,
  top_n: 10,
  warning_retention_days: 90,
  invitation_paid_only: true,
  boards: { invitations: periods, tokens: periods },
}
let client: QueryClient

beforeEach(() => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'viewer', role: 1 })
  client = createAppQueryClient()
  client.setDefaultOptions({ queries: { retry: false, gcTime: 0 } })
})
afterEach(() => {
  client.clear()
  useAuthStore.getState().auth.reset()
  vi.restoreAllMocks()
})

function renderLeaderboard(data = fixture) {
  vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data } })
  render(
    <QueryClientProvider client={client}>
      <LeaderboardPage />
    </QueryClientProvider>
  )
}

it('changes all boards together while allowing an independent keyboard-operated period override', async () => {
  const user = userEvent.setup()
  renderLeaderboard()
  const invitations = await screen.findByRole('region', {
    name: 'Invitation leaders',
  })
  const tokens = screen.getByRole('region', { name: 'Token consumption' })
  const globalTabs = screen.getByRole('tablist', { name: 'All leaderboards' })
  await user.click(within(globalTabs).getByRole('tab', { name: 'Yesterday' }))
  expect(within(invitations).getByText('Yesterday participant')).toBeVisible()
  expect(within(tokens).getByText('Yesterday participant')).toBeVisible()
  within(invitations).getByRole('tab', { name: 'Yesterday' }).focus()
  await user.keyboard('{ArrowRight}{Enter}')
  await waitFor(() =>
    expect(
      within(invitations).getByRole('tab', { name: 'All time' })
    ).toHaveAttribute('aria-selected', 'true')
  )
  expect(within(invitations).getByText('All-time participant')).toBeVisible()
  expect(within(tokens).getByText('Yesterday participant')).toBeVisible()
  await user.click(within(globalTabs).getByRole('tab', { name: 'Today' }))
  expect(within(invitations).getByText('My account')).toBeVisible()
  expect(within(tokens).getByText('My account')).toBeVisible()
})

it('shows four entries initially, expands the full list and keeps the viewer recognizable', async () => {
  const user = userEvent.setup()
  renderLeaderboard()
  const board = await screen.findByRole('region', { name: 'Token consumption' })
  expect(within(board).getAllByRole('listitem')).toHaveLength(4)
  expect(within(board).getByText('Me')).toBeVisible()
  expect(within(board).queryByText('E***')).not.toBeInTheDocument()
  const expand = within(board).getByRole('button', { name: 'View top 5' })
  expect(expand).toHaveAttribute('aria-expanded', 'false')
  expand.focus()
  await user.keyboard('{Enter}')
  expect(expand).toHaveAttribute('aria-expanded', 'true')
  expect(within(board).getAllByRole('listitem')).toHaveLength(5)
  await user.click(
    within(board).getByRole('button', { name: 'Collapse rankings' })
  )
  expect(within(board).getAllByRole('listitem')).toHaveLength(4)
})

it('explains pending calculation and shows an empty board without invented rankings', async () => {
  renderLeaderboard({
    ...fixture,
    pending: true,
    updated_at: 0,
    boards: { invitations: { today: [], yesterday: [], all: [] } },
  })
  expect(
    await screen.findByText(
      'Leaderboard is being calculated. Results will appear automatically.'
    )
  ).toBeVisible()
  expect(screen.getByText('No rankings yet')).toBeVisible()
  expect(screen.getByText(/Last updated.*Awaiting first update/)).toBeVisible()
  expect(screen.queryByRole('list')).not.toBeInTheDocument()
})

it('hides ranking controls when publication is disabled', async () => {
  renderLeaderboard({ ...fixture, enabled: false, boards: {} })
  expect(await screen.findByText('Leaderboard is disabled')).toBeVisible()
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
})

it('recovers through retry after a rejected API result', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get')
    .mockResolvedValueOnce({
      data: { success: false, message: 'Unable to load leaderboard' },
    })
    .mockResolvedValue({
      data: { success: true, data: { ...fixture, stale: true } },
    })
  render(
    <QueryClientProvider client={client}>
      <LeaderboardPage />
    </QueryClientProvider>
  )
  await user.click(await screen.findByRole('button', { name: 'Retry' }))
  expect(
    await screen.findByRole('region', { name: 'Invitation leaders' })
  ).toBeVisible()
  expect(
    screen.getByText(
      'The latest update is delayed. Showing the last available results.'
    )
  ).toBeVisible()
})
