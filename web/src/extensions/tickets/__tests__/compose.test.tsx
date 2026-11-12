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
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { TicketCompose } from '../components/ticket-compose'
import { api, clearTickets, renderTickets, success, ticket } from './fixtures'

let client: QueryClient
afterEach(() => {
  clearTickets(client)
  vi.unstubAllGlobals()
})

it('validates a blank draft before sending any request and focuses the subject', async () => {
  const user = userEvent.setup()
  const post = vi.spyOn(api, 'post')
  ;({ client } = renderTickets(
    <TicketCompose onBack={vi.fn()} onCreated={vi.fn()} />
  ))
  await user.click(screen.getByRole('button', { name: 'Submit ticket' }))
  expect(
    await screen.findByText('Use a subject between 2 and 160 characters.')
  ).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'Ticket subject' })).toHaveFocus()
  expect(
    screen.getByRole('textbox', { name: 'Issue details' })
  ).toHaveAttribute('aria-invalid', 'true')
  expect(post).not.toHaveBeenCalled()
})

it('keeps draft fields and original files after a rejected submit and opens the created ticket on retry', async () => {
  const user = userEvent.setup()
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL() {
        return 'blob:test-ticket'
      }
      static revokeObjectURL() {}
    }
  )
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValueOnce({
      data: {
        success: false,
        message: 'Unable to load tickets. Please try again.',
      },
    })
    .mockResolvedValueOnce(success(ticket))
  const created = vi.fn()
  ;({ client } = renderTickets(
    <TicketCompose onBack={vi.fn()} onCreated={created} />
  ))
  await user.type(
    screen.getByRole('textbox', { name: 'Ticket subject' }),
    '  Refund review  '
  )
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Issue category' }),
    'refund'
  )
  await user.type(
    screen.getByRole('textbox', { name: 'Issue details' }),
    '  Please review order #42.  '
  )
  const image = new File(['image'], 'receipt.png', { type: 'image/png' })
  await user.upload(
    screen.getByLabelText('Image attachments', { selector: 'input' }),
    image
  )
  await user.click(screen.getByRole('button', { name: 'Submit ticket' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Submission failed. Your draft is still here; please try again.'
  )
  expect(screen.getByRole('textbox', { name: 'Ticket subject' })).toHaveValue(
    '  Refund review  '
  )
  expect(screen.getByRole('img', { name: 'receipt.png' })).toBeVisible()
  expect(created).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Submit ticket' }))
  await waitFor(() => expect(created).toHaveBeenCalledWith(41))
  const form = post.mock.calls[1][1] as FormData
  expect(form.get('subject')).toBe('Refund review')
  expect(form.get('category')).toBe('refund')
  expect(form.get('body')).toBe('Please review order #42.')
  expect(form.getAll('images')).toEqual([image])
})
