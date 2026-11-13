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
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'

import { CheckinAccountAction } from '../components/account-action'
import { CheckinAdminLedgers } from '../components/admin-ledgers'
import {
  CheckinReconcileDialog,
  CheckinRefundDialog,
} from '../components/payment-actions'
import type { CheckinAccount } from '../types'
import { checkinPayment } from './fixtures'

let client: QueryClient

beforeEach(() => {
  client = createAppQueryClient()
  client.setDefaultOptions({
    queries: { retry: false, gcTime: 0, staleTime: Infinity },
    mutations: { retry: false },
  })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { items: [], total: 0, page: 1, page_size: 10 },
    },
  })
  vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true, data: {} } })
  vi.spyOn(toast, 'error').mockImplementation(() => 'error-toast')
  vi.spyOn(toast, 'success').mockImplementation(() => 'success-toast')
})

afterEach(() => {
  cleanup()
  client.clear()
  vi.restoreAllMocks()
})

test.each(['paused', 'active'] as const)(
  'changing an account to %s requires a reason and retains the dialog after failure',
  async (state) => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { success: false, message: 'Check-in is temporarily unavailable' },
    })
    render(
      <QueryClientProvider client={client}>
        <CheckinAccountAction userId={7} state={state} onClose={onClose} />
      </QueryClientProvider>
    )
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    expect(
      await screen.findByText('Enter a reason with at least 3 characters')
    ).toBeVisible()
    expect(api.post).not.toHaveBeenCalled()
    const reason = within(dialog).getByRole('textbox', {
      name: 'Review reason',
    })
    await user.click(reason)
    await user.paste('📋📋')
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    expect(
      screen.getByText('Enter a reason with at least 3 characters')
    ).toBeVisible()
    expect(api.post).not.toHaveBeenCalled()
    await user.clear(reason)
    await user.type(reason, '  Reviewed payment ownership  ')
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
    expect(reason).toHaveValue('  Reviewed payment ownership  ')
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: 'Confirm' })
      ).toBeEnabled()
    )
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledExactlyOnceWith())
    expect(api.post).toHaveBeenLastCalledWith(
      '/api/extensions/checkin/accounts/7',
      { state, reason: 'Reviewed payment ownership' }
    )
  }
)

test('reconciliation preserves exact payment decimals and keeps edits when the server rejects ownership', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  vi.mocked(api.post).mockResolvedValueOnce({
    data: { success: false, message: 'Check-in payment facts conflict' },
  })
  render(
    <QueryClientProvider client={client}>
      <CheckinReconcileDialog payment={checkinPayment} onClose={onClose} />
    </QueryClientProvider>
  )
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Reconcile check-in payment',
  })
  expect(
    within(dialog).getByRole('spinbutton', { name: 'User ID' })
  ).toBeDisabled()
  expect(
    within(dialog).getByRole('textbox', { name: 'Payment order' })
  ).toBeDisabled()
  const reference = within(dialog).getByRole('textbox', {
    name: 'Payment reference (optional)',
  })
  expect(reference).toBeDisabled()
  expect(reference).toHaveValue(checkinPayment.reference)
  expect(
    within(dialog).getByText(
      'The recorded payment reference cannot be changed.'
    )
  ).toBeVisible()
  expect(
    within(dialog).getByRole('combobox', { name: 'Payment source' })
  ).toBeDisabled()
  await user.type(
    within(dialog).getByRole('textbox', { name: 'Review reason' }),
    'Verified external receipt'
  )
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirm reconciliation' })
  )
  await waitFor(() => expect(toast.error).toHaveBeenCalled())
  expect(dialog).toBeVisible()
  expect(onClose).not.toHaveBeenCalled()
  expect(
    within(dialog).getByRole('textbox', { name: 'Actual paid amount' })
  ).toHaveValue('50.123456')
  await waitFor(() =>
    expect(
      within(dialog).getByRole('button', { name: 'Confirm reconciliation' })
    ).toBeEnabled()
  )
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirm reconciliation' })
  )
  await waitFor(() => expect(onClose).toHaveBeenCalledExactlyOnceWith())
  expect(api.post).toHaveBeenLastCalledWith(
    '/api/extensions/checkin/reconcile',
    {
      user_id: 7,
      source: 'topup',
      trade_no: 'payment-order-7',
      reference: checkinPayment.reference,
      amount: '50.123456',
      currency: 'CNY',
      usd_per_unit: undefined,
      reason: 'Verified external receipt',
    }
  )
})

test('historical reconciliation preserves an order needing a reference and validates reference UTF-8 byte boundaries', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  const tradeNo = 'A'.repeat(191)
  vi.mocked(api.post).mockResolvedValueOnce({
    data: {
      success: false,
      message:
        'Provide a payment reference for order numbers longer than 128 bytes',
    },
  })
  render(
    <QueryClientProvider client={client}>
      <CheckinReconcileDialog onClose={onClose} />
    </QueryClientProvider>
  )
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Reconcile check-in payment',
  })
  const submit = within(dialog).getByRole('button', {
    name: 'Confirm reconciliation',
  })
  const order = within(dialog).getByRole('textbox', { name: 'Payment order' })
  const reference = within(dialog).getByRole('textbox', {
    name: 'Payment reference (optional)',
  })
  await user.type(
    within(dialog).getByRole('spinbutton', { name: 'User ID' }),
    '7'
  )
  await user.click(order)
  await user.paste(tradeNo)
  await user.type(
    within(dialog).getByRole('textbox', { name: 'Actual paid amount' }),
    '10'
  )
  await user.type(
    within(dialog).getByRole('textbox', { name: 'Review reason' }),
    'Verified historical receipt'
  )
  await user.click(submit)
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      'Provide a payment reference for order numbers longer than 128 bytes'
    )
  )
  expect(order).toHaveValue(tradeNo)
  expect(reference).toHaveValue('')
  expect(onClose).not.toHaveBeenCalled()
  expect(api.post).toHaveBeenCalledExactlyOnceWith(
    '/api/extensions/checkin/reconcile',
    {
      user_id: 7,
      source: 'topup',
      trade_no: tradeNo,
      reference: undefined,
      amount: '10',
      currency: 'CNY',
      usd_per_unit: undefined,
      reason: 'Verified historical receipt',
    }
  )
  await waitFor(() => expect(submit).toBeEnabled())
  await user.click(reference)
  await user.paste('A'.repeat(129))
  await user.click(submit)
  expect(
    await screen.findByText('Payment reference must not exceed 128 bytes')
  ).toBeVisible()
  expect(api.post).toHaveBeenCalledTimes(1)
  await user.clear(reference)
  await user.paste('参'.repeat(43))
  await user.click(submit)
  expect(
    screen.getByText('Payment reference must not exceed 128 bytes')
  ).toBeVisible()
  expect(api.post).toHaveBeenCalledTimes(1)
  const paymentReference = `pi_${'参'.repeat(41)}AB`
  await user.clear(reference)
  await user.paste(`  ${paymentReference}  `)
  await user.click(submit)
  await waitFor(() => expect(onClose).toHaveBeenCalledExactlyOnceWith())
  expect(api.post).toHaveBeenLastCalledWith(
    '/api/extensions/checkin/reconcile',
    {
      user_id: 7,
      source: 'topup',
      trade_no: tradeNo,
      reference: paymentReference,
      amount: '10',
      currency: 'CNY',
      usd_per_unit: undefined,
      reason: 'Verified historical receipt',
    }
  )
})

test('reconciling another currency requires an exchange rate and allows selecting a subscription payment', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <CheckinReconcileDialog onClose={onClose} />
    </QueryClientProvider>
  )
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Reconcile check-in payment',
  })
  await user.type(
    within(dialog).getByRole('spinbutton', { name: 'User ID' }),
    '7'
  )
  await user.click(
    within(dialog).getByRole('combobox', { name: 'Payment source' })
  )
  await user.click(screen.getByRole('option', { name: 'Subscription payment' }))
  await user.type(
    within(dialog).getByRole('textbox', { name: 'Payment order' }),
    'subscription-7'
  )
  await user.type(
    within(dialog).getByRole('textbox', { name: 'Actual paid amount' }),
    '20.000001'
  )
  const currency = within(dialog).getByRole('textbox', {
    name: 'Payment currency',
  })
  await user.clear(currency)
  await user.type(currency, 'EUR')
  await user.type(
    within(dialog).getByRole('textbox', { name: 'Review reason' }),
    'Verified subscription receipt'
  )
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirm reconciliation' })
  )
  expect(
    await screen.findByText(
      'Other currencies require a positive USD exchange rate'
    )
  ).toBeVisible()
  expect(api.post).not.toHaveBeenCalled()
  await user.type(
    within(dialog).getByRole('textbox', {
      name: 'USD per currency unit (optional)',
    }),
    '1.012345'
  )
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirm reconciliation' })
  )
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/api/extensions/checkin/reconcile', {
      user_id: 7,
      source: 'subscription',
      trade_no: 'subscription-7',
      reference: undefined,
      amount: '20.000001',
      currency: 'EUR',
      usd_per_unit: '1.012345',
      reason: 'Verified subscription receipt',
    })
  )
})

test('recording a refund submits the entered cumulative amount unchanged and keeps a rejected entry open', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  vi.mocked(api.post).mockResolvedValueOnce({
    data: { success: false, message: 'Invalid check-in payment parameters' },
  })
  render(
    <QueryClientProvider client={client}>
      <CheckinRefundDialog payment={checkinPayment} onClose={onClose} />
    </QueryClientProvider>
  )
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Record check-in payment refund',
  })
  const amount = within(dialog).getByRole('textbox', {
    name: 'Cumulative refunded amount',
  })
  expect(amount).toHaveValue('10.1')
  expect(
    within(dialog).getByRole('textbox', { name: 'Payment order' })
  ).toBeDisabled()
  await user.clear(amount)
  await user.type(amount, '20.123456')
  await user.type(
    within(dialog).getByRole('textbox', { name: 'Review reason' }),
    'Verified cumulative refund'
  )
  await user.click(
    within(dialog).getByRole('button', { name: 'Record refund' })
  )
  await waitFor(() => expect(toast.error).toHaveBeenCalled())
  expect(amount).toHaveValue('20.123456')
  expect(onClose).not.toHaveBeenCalled()
  await waitFor(() =>
    expect(
      within(dialog).getByRole('button', { name: 'Record refund' })
    ).toBeEnabled()
  )
  await user.click(
    within(dialog).getByRole('button', { name: 'Record refund' })
  )
  await waitFor(() => expect(onClose).toHaveBeenCalledExactlyOnceWith())
  expect(api.post).toHaveBeenLastCalledWith('/api/extensions/checkin/refund', {
    trade_no: 'payment-order-7',
    amount: '20.123456',
    reason: 'Verified cumulative refund',
  })
})

test('account pagination and user filters issue scoped requests and reset to the first page', async () => {
  const user = userEvent.setup()
  const account: CheckinAccount = {
    user_id: 7,
    username: 'alice',
    state: 'active',
    reason: '',
    updated_at: 0,
    updated_by: 0,
    total_checkins: 2,
    total_quota: 10000,
    last_checkin_at: 0,
  }
  vi.mocked(api.get).mockResolvedValue({
    data: {
      success: true,
      data: { items: [account], total: 11, page: 1, page_size: 10 },
    },
  })
  render(
    <QueryClientProvider client={client}>
      <CheckinAdminLedgers />
    </QueryClientProvider>
  )
  expect(await screen.findByText('alice')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Go to next page' }))
  await waitFor(() =>
    expect(api.get).toHaveBeenLastCalledWith(
      '/api/extensions/checkin/accounts',
      { params: { user_id: undefined, state: undefined, p: 2, page_size: 10 } }
    )
  )
  await user.type(
    screen.getByRole('textbox', { name: 'Filter by user ID' }),
    '7'
  )
  await user.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() =>
    expect(api.get).toHaveBeenLastCalledWith(
      '/api/extensions/checkin/accounts',
      { params: { user_id: 7, state: undefined, p: 1, page_size: 10 } }
    )
  )
  await user.click(screen.getByRole('button', { name: 'Pause this user' }))
  expect(
    await screen.findByRole('alertdialog', { name: 'Pause check-in rewards' })
  ).toHaveTextContent('user 7')
})

test('payment and audit tabs render their records and filter audit actions by stable server identifiers', async () => {
  const user = userEvent.setup()
  vi.mocked(api.get).mockImplementation(async (url) => {
    const auditItems = url.endsWith('/audit')
      ? [
          {
            id: 1,
            actor_id: 1,
            user_id: 7,
            action: 'payment_refund',
            detail: 'Cumulative payment refund recorded',
            reason: 'Verified receipt',
            created_at: 1794369600,
          },
        ]
      : []
    return {
      data: {
        success: true,
        data: {
          items: url.endsWith('/payments') ? [checkinPayment] : auditItems,
          total: 1,
          page: 1,
          page_size: 10,
        },
      },
    }
  })
  render(
    <QueryClientProvider client={client}>
      <CheckinAdminLedgers />
    </QueryClientProvider>
  )
  await user.click(screen.getByRole('tab', { name: 'Payment records' }))
  expect(await screen.findByText('payment-order-7')).toBeVisible()
  expect(screen.getByText('Verified payment')).toBeVisible()
  await user.click(screen.getByRole('tab', { name: 'Audit trail' }))
  expect(
    await screen.findByText('Cumulative payment refund recorded')
  ).toBeVisible()
  expect(screen.getByRole('cell', { name: 'Refund recorded' })).toBeVisible()
  await user.click(
    screen.getByRole('combobox', { name: 'Filter audit actions' })
  )
  await user.click(screen.getByRole('option', { name: 'Refund recorded' }))
  await waitFor(() =>
    expect(api.get).toHaveBeenLastCalledWith('/api/extensions/checkin/audit', {
      params: {
        user_id: undefined,
        action: 'payment_refund',
        p: 1,
        page_size: 10,
      },
    })
  )
})

test('sale-code records disclose declared value and allow refunds without gateway reconciliation', async () => {
  const user = userEvent.setup()
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: {
      success: true,
      data: {
        items: url.endsWith('/payments')
          ? [
              {
                ...checkinPayment,
                source: 'redemption',
                origin: 'redemption',
                trade_no: 'redemption:7',
                provider: 'redemption',
              },
            ]
          : [],
        total: 1,
        page: 1,
        page_size: 10,
      },
    },
  }))
  render(
    <QueryClientProvider client={client}>
      <CheckinAdminLedgers />
    </QueryClientProvider>
  )
  await user.click(screen.getByRole('tab', { name: 'Payment records' }))
  const row = await screen.findByRole('row', { name: /redemption:7/ })
  expect(within(row).getByText('Sale-code redemption')).toBeVisible()
  expect(within(row).getByText('Admin-declared sale value')).toBeVisible()
  expect(within(row).getByText('Recorded sale value')).toBeVisible()
  expect(within(row).queryByText('Verified payment')).not.toBeInTheDocument()
  expect(
    within(row).queryByRole('button', { name: 'Reconcile order' })
  ).not.toBeInTheDocument()
  await user.click(within(row).getByRole('button', { name: 'Record refund' }))
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Record check-in payment refund',
  })
  expect(
    within(dialog).getByRole('textbox', { name: 'Payment order' })
  ).toHaveValue('redemption:7')
})

test.each(['reconcile', 'refund'] as const)(
  '%s rejects payment order identifiers above the server byte limit before making a request',
  async (action) => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <QueryClientProvider client={client}>
        {action === 'reconcile' ? (
          <CheckinReconcileDialog onClose={onClose} />
        ) : (
          <CheckinRefundDialog onClose={onClose} />
        )}
      </QueryClientProvider>
    )
    const dialog = await screen.findByRole('alertdialog')
    const order = within(dialog).getByRole('textbox', { name: 'Payment order' })
    const submit = within(dialog).getByRole('button', {
      name: action === 'reconcile' ? 'Confirm reconciliation' : 'Record refund',
    })
    if (action === 'reconcile') {
      await user.type(
        within(dialog).getByRole('spinbutton', { name: 'User ID' }),
        '7'
      )
      await user.type(
        within(dialog).getByRole('textbox', {
          name: 'Payment reference (optional)',
        }),
        'pi_long_order'
      )
    }
    await user.type(
      within(dialog).getByRole('textbox', {
        name:
          action === 'reconcile'
            ? 'Actual paid amount'
            : 'Cumulative refunded amount',
      }),
      '10'
    )
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Review reason' }),
      'Verified payment receipt'
    )
    await user.click(order)
    await user.paste('A'.repeat(192))
    await user.click(submit)
    expect(
      await screen.findByText('Payment order must not exceed 191 bytes')
    ).toBeVisible()
    expect(api.post).not.toHaveBeenCalled()
    await user.clear(order)
    await user.paste('订单'.repeat(32))
    await user.click(submit)
    expect(
      screen.getByText('Payment order must not exceed 191 bytes')
    ).toBeVisible()
    expect(api.post).not.toHaveBeenCalled()
    await user.clear(order)
    await user.paste('A'.repeat(191))
    const reason = within(dialog).getByRole('textbox', {
      name: 'Review reason',
    })
    await user.clear(reason)
    await user.paste('核'.repeat(501))
    await user.click(submit)
    expect(
      await screen.findByText('Reason must not exceed 500 characters')
    ).toBeVisible()
    expect(api.post).not.toHaveBeenCalled()
    await user.clear(reason)
    await user.paste('核📋'.repeat(250))
    await user.click(submit)
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        `/api/extensions/checkin/${action}`,
        expect.objectContaining({
          trade_no: 'A'.repeat(191),
          amount: '10',
          reason: '核📋'.repeat(250),
        })
      )
    )
  }
)
