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
import type { ComponentProps } from 'react'
import { expect, it, vi } from 'vitest'

import { RechargeFormCard } from '../recharge-form-card'

type RechargeCardFixtureProps = Omit<
  ComponentProps<typeof RechargeFormCard>,
  'topupInfo'
> & {
  topupInfo: NonNullable<ComponentProps<typeof RechargeFormCard>['topupInfo']>
}

function renderRechargeCard(overrides: Partial<RechargeCardFixtureProps> = {}) {
  const props: RechargeCardFixtureProps = {
    topupInfo: {
      enable_online_topup: false,
      enable_stripe_topup: false,
      enable_redemption: true,
      pay_methods: [],
      min_topup: 1,
      stripe_min_topup: 1,
      amount_options: [],
      discount: {},
      redemption_stores: [
        {
          id: 'first',
          name: 'Main store',
          url: 'https://store.example.com/product/1',
          description: 'Buy a code',
        },
      ],
    },
    presetAmounts: [],
    selectedPreset: null,
    onSelectPreset: vi.fn(),
    topupAmount: 1,
    onTopupAmountChange: vi.fn(),
    paymentAmount: 1,
    calculating: false,
    onPaymentMethodSelect: vi.fn(),
    paymentLoading: null,
    redemptionCode: '',
    onRedemptionCodeChange: vi.fn(),
    onRedeem: vi.fn(),
    redeeming: false,
    ...overrides,
  }
  return { ...render(<RechargeFormCard {...props} />), props }
}

it('shows the external store instead of the disabled top-up notice when only code purchases are configured', async () => {
  const user = userEvent.setup()
  renderRechargeCard()

  const purchase = screen.getByRole('link', {
    name: 'Visit Main store',
  })
  expect(purchase).toHaveAttribute(
    'href',
    'https://store.example.com/product/1'
  )
  expect(purchase).toHaveAttribute('target', '_blank')
  expect(purchase).toHaveAttribute('rel', 'noopener noreferrer')
  expect(
    screen.queryByText(
      'Online topup is not enabled. Please use redemption code or contact administrator.'
    )
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText('Choose an amount and payment method')
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  expect(
    screen.getByPlaceholderText('Enter your redemption code')
  ).toBeVisible()
  await user.tab()
  expect(purchase).toHaveFocus()
})

it('keeps code entry and redemption usable when online gateways are disabled', async () => {
  const user = userEvent.setup()
  const { props } = renderRechargeCard({
    topupLink: 'https://store.example.com',
  })
  await user.click(screen.getByPlaceholderText('Enter your redemption code'))
  await user.paste('purchased-code')
  expect(props.onRedemptionCodeChange).toHaveBeenCalledWith('purchased-code')
  await user.click(screen.getByRole('button', { name: 'Redeem' }))
  expect(props.onRedeem).toHaveBeenCalledOnce()
})

it.each([undefined, '', '   ', 'javascript:alert(1)', 'not-a-url'])(
  'retains the fallback notice and code entry when the external store URL is %s',
  (topupLink) => {
    const { props, rerender } = renderRechargeCard({ topupLink })
    rerender(
      <RechargeFormCard
        {...props}
        topupInfo={{ ...props.topupInfo, redemption_stores: [] }}
      />
    )
    expect(
      screen.queryByRole('link', { name: 'Visit Main store' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'Online topup is not enabled. Please use redemption code or contact administrator.'
      )
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Redeem' })).toBeVisible()
  }
)

it('hides the store and redemption controls while compliance has disabled redemption', () => {
  const { props, rerender } = renderRechargeCard({
    topupLink: 'https://store.example.com',
  })
  rerender(
    <RechargeFormCard
      {...props}
      topupInfo={{ ...props.topupInfo, enable_redemption: false }}
    />
  )
  expect(
    screen.queryByRole('link', { name: 'Visit Main store' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Redeem' })
  ).not.toBeInTheDocument()
  expect(
    screen.getByText(
      'Redemption codes are disabled until the administrator confirms compliance terms.'
    )
  ).toBeVisible()
})

it('keeps online payment controls alongside the external purchase link when both are configured', () => {
  const { props, rerender } = renderRechargeCard({
    topupLink: 'https://store.example.com',
  })
  rerender(
    <RechargeFormCard
      {...props}
      topupInfo={{
        ...props.topupInfo,
        enable_online_topup: true,
        pay_methods: [{ type: 'alipay', name: 'Alipay' }],
      }}
    />
  )
  expect(screen.getByLabelText('Custom Amount')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Alipay' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Visit Main store' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Redeem' })).toBeVisible()
})

it('hides purchase and redemption actions while the wallet configuration is loading', () => {
  renderRechargeCard({
    topupLink: 'https://store.example.com',
    loading: true,
  })
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Redeem' })
  ).not.toBeInTheDocument()
})

it('shows multiple store cards in configured order and suppresses the legacy link', () => {
  const { props, rerender } = renderRechargeCard({
    topupLink: 'https://legacy.example.com',
  })
  rerender(
    <RechargeFormCard
      {...props}
      topupInfo={{
        ...props.topupInfo,
        redemption_stores: [
          {
            id: 'second',
            name: 'Second store',
            url: 'https://second.example.com',
            description: '',
          },
          ...(props.topupInfo.redemption_stores ?? []),
        ],
      }}
    />
  )
  const links = screen.getAllByRole('link')
  expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
    'Visit Second store',
    'Visit Main store',
  ])
  expect(
    screen.queryByRole('link', { name: 'Get one here' })
  ).not.toBeInTheDocument()
})

it('retains a valid legacy purchase link when the plugin has no visible stores', () => {
  const { props, rerender } = renderRechargeCard({
    topupLink: ' https://legacy.example.com ',
  })
  rerender(
    <RechargeFormCard
      {...props}
      topupInfo={{ ...props.topupInfo, redemption_stores: [] }}
    />
  )
  expect(screen.getByRole('link', { name: 'Get one here' })).toHaveAttribute(
    'href',
    'https://legacy.example.com'
  )
  expect(
    screen.queryByText(
      'Online topup is not enabled. Please use redemption code or contact administrator.'
    )
  ).not.toBeInTheDocument()
})
