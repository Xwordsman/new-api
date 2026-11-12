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
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'

import { KeyPriceDialog } from '../components/key-price-dialog'
import { RatesTable } from '../components/rates-table'
import type { PriceDetail, PriceQuote } from '../types'

const detail: PriceDetail = {
  settings: {
    revision: 4,
    enabled: true,
    default_protect: true,
    allow_opt_out: true,
    legacy_mode: 'ignore',
    increase_percent: 0,
    quote_ttl_seconds: 300,
  },
  state: {
    token_id: 7,
    user_id: 42,
    version: 2,
    protected: true,
    paused: true,
    accepted_at: 1700000000,
    paused_at: 1700000100,
    reason: 'ratio_increased',
    group: 'default',
    previous_ratio: 0.8,
    current_ratio: 1.2,
  },
  tracked: true,
  accepted: { default: 0.8 },
  current: { default: 1.2 },
  events: [],
}
let client: QueryClient

beforeEach(() => {
  client = createAppQueryClient()
  client.setDefaultOptions({
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: detail },
  })
})
afterEach(() => {
  client.clear()
  vi.restoreAllMocks()
})

function renderConsent(data = detail) {
  vi.mocked(api.get).mockResolvedValue({ data: { success: true, data } })
  const onClose = vi.fn()
  const onAccepted = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <KeyPriceDialog
        tokenId={7}
        name='production'
        onClose={onClose}
        onAccepted={onAccepted}
      />
    </QueryClientProvider>
  )
  return { onClose, onAccepted }
}

function quote(data = detail): PriceQuote {
  return {
    quote: 'owner-bound-quote',
    rates: data.current,
    expires_at: Math.floor(Date.now() / 1000) + 300,
    settings: data.settings,
    protected: data.state.protected,
  }
}

it('reviews effective multipliers before explicitly accepting the single-use quote', async () => {
  const user = userEvent.setup()
  const issued = quote()
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValueOnce({ data: { success: true, data: issued } })
    .mockResolvedValueOnce({
      data: { success: true, data: { ...detail.state, paused: false } },
    })
  const callbacks = renderConsent()
  const review = await screen.findByRole('button', {
    name: 'Review current multipliers',
  })
  await waitFor(() => expect(review).toBeEnabled())
  expect(screen.getByRole('cell', { name: '×0.8' })).toBeInTheDocument()
  expect(screen.getByRole('cell', { name: '×1.2' })).toBeInTheDocument()
  expect(post).not.toHaveBeenCalled()
  await user.click(review)
  expect(post).toHaveBeenCalledExactlyOnceWith(
    '/api/extensions/key-price/keys/7/quote'
  )
  const protection = screen.getByRole('switch', {
    name: 'Protect this Key from multiplier increases',
  })
  act(() => protection.focus())
  await user.keyboard(' ')
  expect(protection).not.toBeChecked()
  await user.click(
    await screen.findByRole('button', { name: 'Accept multipliers and resume' })
  )
  await waitFor(() => expect(callbacks.onAccepted).toHaveBeenCalledOnce())
  expect(post).toHaveBeenLastCalledWith(
    '/api/extensions/key-price/keys/7/accept',
    { quote: issued.quote, protected: false }
  )
  expect(callbacks.onClose).toHaveBeenCalledOnce()
})

it('requires a fresh review after the server rejects a stale confirmation', async () => {
  const user = userEvent.setup()
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValueOnce({ data: { success: true, data: quote() } })
    .mockResolvedValueOnce({
      data: {
        success: false,
        message: 'Key price protection changed. Reload and confirm again.',
      },
    })
  const callbacks = renderConsent()
  const review = await screen.findByRole('button', {
    name: 'Review current multipliers',
  })
  await waitFor(() => expect(review).toBeEnabled())
  await user.click(review)
  await user.click(
    await screen.findByRole('button', { name: 'Accept multipliers and resume' })
  )
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Review current multipliers' })
    ).toBeEnabled()
  )
  expect(
    screen.queryByRole('button', { name: 'Accept multipliers and resume' })
  ).not.toBeInTheDocument()
  expect(post).toHaveBeenCalledTimes(2)
  expect(callbacks.onClose).not.toHaveBeenCalled()
  expect(callbacks.onAccepted).not.toHaveBeenCalled()
})

it('disables opt-out when the administrator requires protection', async () => {
  const user = userEvent.setup()
  const mandatory = {
    ...detail,
    settings: { ...detail.settings, allow_opt_out: false },
    state: { ...detail.state, protected: false },
  }
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { ...quote(mandatory), protected: true } },
  })
  renderConsent(mandatory)
  const protection = await screen.findByRole('switch', {
    name: 'Protect this Key from multiplier increases',
  })
  expect(protection).toBeChecked()
  expect(protection).toHaveAttribute('aria-disabled', 'true')
  await user.click(protection)
  expect(protection).toBeChecked()
  await user.click(
    screen.getByRole('button', { name: 'Review current multipliers' })
  )
  await user.click(
    await screen.findByRole('button', { name: 'Accept multipliers and resume' })
  )
  await waitFor(() =>
    expect(post).toHaveBeenLastCalledWith(
      '/api/extensions/key-price/keys/7/accept',
      { quote: 'owner-bound-quote', protected: true }
    )
  )
})

it('requires another review when a quote has expired', async () => {
  const user = userEvent.setup()
  const issued = { ...quote(), expires_at: Math.floor(Date.now() / 1000) - 1 }
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: issued } })
  renderConsent()
  const review = await screen.findByRole('button', {
    name: 'Review current multipliers',
  })
  await waitFor(() => expect(review).toBeEnabled())
  await user.click(review)
  await screen.findByText(
    'The price quote expired. Review the current multipliers again.'
  )
  expect(
    screen.getByRole('button', { name: 'Review current multipliers' })
  ).toBeEnabled()
  expect(post).toHaveBeenCalledExactlyOnceWith(
    '/api/extensions/key-price/keys/7/quote'
  )
})

it('shows disabled policy without allowing a quote or preference change', async () => {
  const post = vi.spyOn(api, 'post')
  renderConsent({ ...detail, settings: { ...detail.settings, enabled: false } })
  await screen.findByText('Price protection is disabled by the administrator.')
  expect(
    screen.getByRole('button', { name: 'Review current multipliers' })
  ).toBeDisabled()
  expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
  expect(post).not.toHaveBeenCalled()
})

it.each(['zhCN', 'zhTW', 'en', 'fr', 'ru', 'ja', 'vi', 'invalid_locale'])(
  'renders precise multipliers with interface locale %s',
  async (language) => {
    const i18n = createInstance()
    await i18n.init({
      lng: language,
      fallbackLng: 'en',
      resources: { en: { translation: {} } },
      initAsync: false,
    })
    render(
      <I18nextProvider i18n={i18n}>
        <RatesTable
          accepted={{ default: 0.12345678 }}
          current={{ default: 1.23456789 }}
        />
      </I18nextProvider>
    )
    const comma = ['fr', 'ru', 'vi'].includes(language)
    expect(
      screen.getByRole('cell', { name: comma ? '×0,12345678' : '×0.12345678' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('cell', { name: comma ? '×1,23456789' : '×1.23456789' })
    ).toBeInTheDocument()
    if (language === 'en') {
      await act(() => i18n.changeLanguage('fr'))
      expect(
        screen.getByRole('cell', { name: '×1,23456789' })
      ).toBeInTheDocument()
    }
  }
)
