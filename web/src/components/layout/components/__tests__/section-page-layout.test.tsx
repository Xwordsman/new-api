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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Wallet } from 'lucide-react'
import { expect, test, vi } from 'vitest'

import { PageFooterPortal } from '../page-footer'
import { SectionPageLayout } from '../section-page-layout'

test('a console page presents its icon, English label, localized title and description together', async () => {
  const refresh = vi.fn()
  const user = userEvent.setup()
  render(
    <SectionPageLayout>
      <SectionPageLayout.Title
        icon={Wallet}
        eyebrow='WALLET'
        description='管理余额、充值和订阅。'
      >
        钱包
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <button type='button' onClick={refresh}>
          刷新
        </button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>账户余额</SectionPageLayout.Content>
    </SectionPageLayout>
  )

  const introduction = screen
    .getByRole('heading', { level: 1, name: '钱包' })
    .closest('header')
  if (!introduction) throw new Error('Expected a page introduction')
  expect(
    within(introduction).getByRole('heading', { level: 1, name: '钱包' })
  ).toBeVisible()
  expect(within(introduction).getByText('WALLET')).toBeVisible()
  expect(within(introduction).getByText('管理余额、充值和订阅。')).toBeVisible()
  expect(introduction.querySelector('svg')).toHaveAttribute(
    'aria-hidden',
    'true'
  )
  const headerCard = introduction.querySelector('[data-slot="card"]')
  expect(headerCard).toHaveClass(
    'console-page-header-ambient',
    'border-0',
    'ring-0'
  )
  expect(headerCard).toHaveAttribute('data-card-hover', 'false')
  expect(headerCard).toHaveAttribute('data-console-surface', 'false')
  expect(
    within(introduction)
      .getByRole('heading', { level: 1, name: '钱包' })
      .closest('[data-slot="console-page-introduction"]')
  ).toHaveClass('basis-80', 'grow', 'min-w-0')
  await user.click(within(introduction).getByRole('button', { name: '刷新' }))
  expect(refresh).toHaveBeenCalledOnce()
})

test.each([false, true])(
  'fixed content %s preserves the page scrolling and footer contract',
  (fixedContent) => {
    render(
      <SectionPageLayout fixedContent={fixedContent}>
        <SectionPageLayout.Title
          icon={Wallet}
          eyebrow='WALLET'
          description='Manage your balance.'
        >
          Wallet
        </SectionPageLayout.Title>
        <SectionPageLayout.Breadcrumb>
          <nav aria-label='Breadcrumb'>Account / Wallet</nav>
        </SectionPageLayout.Breadcrumb>
        <SectionPageLayout.Content>
          <div>Balance details</div>
          <PageFooterPortal>
            <button type='button'>Next page</button>
          </PageFooterPortal>
        </SectionPageLayout.Content>
      </SectionPageLayout>
    )

    const content = screen.getByText('Balance details').parentElement
    expect(content).toHaveClass(
      'min-h-0',
      'flex-1',
      fixedContent ? 'overflow-hidden' : 'overflow-auto'
    )
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Next page' }).closest('main')
    ).toBe(screen.getByRole('main'))
    expect(
      screen
        .getByRole('heading', { level: 1, name: 'Wallet' })
        .closest('header')
    ).not.toContainElement(screen.getByText('Balance details'))
  }
)

test('an ambient page header keeps edge insets compact and centers its icon while preserving long introductions and actions', async () => {
  const refresh = vi.fn()
  const user = userEvent.setup()
  const description =
    'Manage your balance, usage and service status across all connected providers.'
  render(
    <SectionPageLayout stackActionsOnMobile>
      <SectionPageLayout.Title
        icon={Wallet}
        eyebrow='WALLET'
        description={description}
        variant='ambient'
      >
        Wallet and account activity
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <button type='button' onClick={refresh}>
          Refresh
        </button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>Balance details</SectionPageLayout.Content>
    </SectionPageLayout>
  )

  const header = screen
    .getByRole('heading', {
      level: 1,
      name: 'Wallet and account activity',
    })
    .closest('header')
  if (!header) throw new Error('Expected a page introduction')
  expect(header).toHaveClass('px-2', 'pt-2', 'sm:px-2', 'sm:pt-2', 'lg:px-2')
  expect(header.querySelector('[data-slot="card"]')).toHaveClass(
    'ring-0',
    'border-0'
  )
  expect(header.querySelector('[data-slot="card-content"]')).toHaveClass(
    'px-2',
    'sm:px-4',
    'lg:px-6'
  )
  expect(within(header).getByText(description)).toBeVisible()
  expect(
    header.querySelector('[data-slot="console-page-introduction"]')
  ).toHaveClass('min-w-0', 'max-sm:basis-full', 'items-center')
  await user.tab()
  expect(screen.getByRole('button', { name: 'Refresh' })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(refresh).toHaveBeenCalledOnce()
})
