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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { PromotionalCreditCard } from '../components/promotional-credit-card'

afterEach(() => {
  useAuthStore.getState().auth.reset()
  vi.restoreAllMocks()
})

it('keeps a card background when credits fail to load and supports retrying', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  useAuthStore.getState().auth.setUser({ id: 1, username: 'root', role: 100 })
  vi.spyOn(api, 'get')
    .mockRejectedValueOnce(new Error('Credit service unavailable'))
    .mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          enabled: true,
          grant: { created_at: 1, state: 'active', total: 100, remaining: 100 },
        },
      },
    })
  const user = userEvent.setup()
  const view = render(
    <QueryClientProvider client={client}>
      <PromotionalCreditCard />
    </QueryClientProvider>
  )
  try {
    const retry = await screen.findByRole('button', { name: 'Retry' })
    expect(retry.closest('[data-slot="empty"]')).toHaveClass(
      'bg-card',
      'border',
      'rounded-xl'
    )
    await user.click(retry)
    expect(await screen.findByText('Promotional credits')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Retry' })
    ).not.toBeInTheDocument()
  } finally {
    view.unmount()
    client.clear()
  }
})
