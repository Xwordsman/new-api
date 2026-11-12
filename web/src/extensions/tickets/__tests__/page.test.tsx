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
import type { QueryClient } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { useState } from 'react'
import { initReactI18next } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'

import { TicketCenter } from '../index'
import type { TicketSelection } from '../types'
import {
  api,
  clearTickets,
  emptyList,
  renderTickets,
  success,
  ticket,
  ticketFixtureRequests,
} from './fixtures'

let client: QueryClient
afterEach(() => clearTickets(client))

function Center(props: { initial?: TicketSelection }) {
  const [selection, setSelection] = useState<TicketSelection>(
    props.initial ?? { view: 'mine' }
  )
  return <TicketCenter selection={selection} onNavigate={setSelection} />
}

it('scopes ordinary users to their own tickets even when the URL selects the team view', async () => {
  const get = vi
    .spyOn(api, 'get')
    .mockImplementation(async (url) => ticketFixtureRequests(url))
  ;({ client } = renderTickets(<Center initial={{ view: 'team' }} />))
  expect(
    await screen.findByRole('button', { name: /Request returned an error/ })
  ).toBeVisible()
  expect(
    screen.queryByRole('tab', { name: 'Team tickets' })
  ).not.toBeInTheDocument()
  expect(get).toHaveBeenCalledWith(
    '/api/extensions/tickets',
    expect.objectContaining({
      params: { page: 1, search: '', status: '', unread: false },
    })
  )
  expect(get.mock.calls.every(([url]) => !url.includes('/admin'))).toBe(true)
})

it('lets administrators switch to the shared support queue and resets list filters', async () => {
  const user = userEvent.setup()
  const get = vi
    .spyOn(api, 'get')
    .mockImplementation(async (url) => ticketFixtureRequests(url))
  ;({ client } = renderTickets(<Center />, { admin: true }))
  await screen.findByRole('button', { name: /Request returned an error/ })
  await user.type(
    screen.getByRole('textbox', { name: 'Search ticket subjects' }),
    'draft filter'
  )
  await user.click(screen.getByRole('tab', { name: 'Team tickets' }))
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith(
      '/api/extensions/tickets/admin',
      expect.objectContaining({
        params: { page: 1, search: '', status: '', unread: false },
      })
    )
  )
  expect(screen.getByRole('tab', { name: 'Team tickets' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(
    screen.getByRole('textbox', { name: 'Search ticket subjects' })
  ).toHaveValue('')
})

it('paginates tickets and resets the page when status, unread or subject filters change', async () => {
  const user = userEvent.setup()
  const get = vi.spyOn(api, 'get').mockImplementation(async (_url, config) => {
    const params = config?.params as { page: number }
    return success({
      ...emptyList,
      total: 21,
      page: params.page,
      items: [{ ...ticket, subject: `Ticket page ${params.page}` }],
    })
  })
  ;({ client } = renderTickets(<Center />))
  await screen.findByRole('button', { name: /Ticket page 1/ })
  expect(
    screen.getByRole('button', { name: 'Go to previous page' })
  ).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Go to next page' }))
  expect(
    await screen.findByRole('button', { name: /Ticket page 2/ })
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Go to next page' })).toBeDisabled()
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Ticket status' }),
    'waiting_user'
  )
  await screen.findByRole('button', { name: /Ticket page 1/ })
  await user.click(screen.getByRole('button', { name: 'Unread only' }))
  expect(screen.getByRole('button', { name: 'Unread only' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await user.type(
    screen.getByRole('textbox', { name: 'Search ticket subjects' }),
    '  refund %_!  '
  )
  await user.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(get).toHaveBeenLastCalledWith(
      '/api/extensions/tickets',
      expect.objectContaining({
        params: {
          page: 1,
          search: 'refund %_!',
          status: 'waiting_user',
          unread: true,
        },
      })
    )
  )
})

it('opens the selected conversation and returns to the list on narrow screens', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockImplementation(async (url) =>
    ticketFixtureRequests(url)
  )
  ;({ client } = renderTickets(<Center />))
  expect(screen.getByText('Select a ticket')).toBeInTheDocument()
  await user.click(
    await screen.findByRole('button', { name: /Request returned an error/ })
  )
  expect(
    await screen.findByRole('region', { name: 'Ticket conversation' })
  ).toBeVisible()
  expect(
    screen.getByRole('button', { name: /Request returned an error/ })
  ).toHaveAttribute('aria-current', 'true')
  // CSS controls which pane is visible below md; preserve both the list and
  // detail visibility contracts without depending on jsdom layout geometry.
  const list = screen.getByRole('region', { name: 'My tickets' })
  expect(list.parentElement).toHaveClass('hidden', 'md:block')
  expect(list.parentElement?.parentElement).toHaveClass(
    'md:grid-cols-[44%_56%]'
  )
  await user.click(screen.getByRole('button', { name: 'Back to tickets' }))
  expect(
    screen.queryByRole('region', { name: 'Ticket conversation' })
  ).not.toBeInTheDocument()
  expect(list.parentElement).not.toHaveClass('hidden')
})

it('translates the ticket page and updates labels when the interface language changes', async () => {
  const translations = i18next.createInstance()
  await translations.use(initReactI18next).init({
    lng: 'zh',
    fallbackLng: 'en',
    keySeparator: false,
    nsSeparator: false,
    resources: { en, zh },
  })
  vi.spyOn(api, 'get').mockResolvedValue(success(emptyList))
  ;({ client } = renderTickets(<Center />, { translations }))
  expect(await screen.findByRole('heading', { name: '工单中心' })).toBeVisible()
  expect(await screen.findByText('这里还没有工单')).toBeVisible()
  await act(() => translations.changeLanguage('en'))
  expect(screen.getByRole('heading', { name: 'Ticket center' })).toBeVisible()
  expect(screen.getByText('No tickets here yet')).toBeVisible()
})
