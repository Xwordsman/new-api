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
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, test } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { Footer } from '../footer'

const initialSystemConfig = useSystemConfigStore.getState()
let client: QueryClient
let language: ReturnType<typeof createInstance>

beforeEach(async () => {
  localStorage.clear()
  useAuthStore.getState().auth.reset()
  useSystemConfigStore.getState().setConfig({
    systemName: 'Gateway Preview',
    logo: '/site-logo.svg',
    footerHtml: '',
  })
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(['status'], {
    extension_features: { documentation: true },
  })
  language = createInstance()
  await language.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en, zh },
    interpolation: { escapeValue: false },
  })
})

afterEach(() => {
  cleanup()
  client.clear()
  useAuthStore.getState().auth.reset()
  useSystemConfigStore.setState(initialSystemConfig)
  localStorage.clear()
})

async function renderFooter() {
  const router = createRouter({
    routeTree: createRootRoute({ component: Footer }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(
    <I18nextProvider i18n={language}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  )
  await screen.findByRole('contentinfo')
  return router
}

test('the default footer uses the configured site brand and sends visitors to site features and the FAQ', async () => {
  const user = userEvent.setup()
  const router = await renderFooter()
  const navigation = within(
    screen.getByRole('navigation', { name: 'Footer navigation' })
  )

  expect(screen.getByRole('link', { name: 'Gateway Preview' })).toHaveAttribute(
    'href',
    '/'
  )
  for (const [name, href] of [
    ['Model Square', '/pricing'],
    ['Rankings', '/rankings'],
    ['Console', '/dashboard'],
    ['Documentation center', '/docs'],
    ['API Keys', '/keys'],
    ['Usage Logs', '/usage-logs'],
    ['Wallet', '/wallet'],
    ['Ticket center', '/tickets'],
    ['About', '/about'],
  ]) {
    expect(navigation.getByRole('link', { name })).toHaveAttribute('href', href)
  }
  await user.click(navigation.getByRole('link', { name: 'FAQ' }))
  expect(router.state.location.pathname).toBe('/')
  expect(router.state.location.hash).toBe('faq')
})

test('disabled site modules and disabled documentation do not leave links or empty columns in the footer', async () => {
  client.setQueryData(['status'], {
    extension_features: { documentation: false },
    docs_link: '/docs',
    HeaderNavModules: JSON.stringify({
      console: false,
      pricing: false,
      rankings: false,
      about: false,
    }),
    SidebarModulesAdmin: JSON.stringify({
      console: { enabled: false },
      personal: { enabled: false },
    }),
  })
  await renderFooter()
  const navigation = within(
    screen.getByRole('navigation', { name: 'Footer navigation' })
  )

  expect(navigation.getAllByRole('link')).toHaveLength(1)
  expect(navigation.getByRole('link', { name: 'FAQ' })).toHaveAttribute(
    'href',
    '/#faq'
  )
  expect(
    navigation.queryByRole('heading', { name: 'Platform' })
  ).not.toBeInTheDocument()
  expect(
    navigation.queryByRole('heading', { name: 'Developer resources' })
  ).not.toBeInTheDocument()
})

test('a configured external documentation destination opens safely in a separate tab', async () => {
  client.setQueryData(['status'], {
    docs_link: 'https://docs.example.test/guide',
  })
  await renderFooter()
  const documentation = screen.getByRole('link', {
    name: 'Documentation center',
  })

  expect(documentation).toHaveAttribute(
    'href',
    'https://docs.example.test/guide'
  )
  expect(documentation).toHaveAttribute('target', '_blank')
  expect(documentation).toHaveAttribute('rel', 'noopener noreferrer')
})

test('the footer shows project attribution without an optional resource menu', async () => {
  await renderFooter()

  expect(screen.getByRole('link', { name: 'New API' })).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Open-source resources' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: 'One API' })
  ).not.toBeInTheDocument()
})

test('custom footer HTML retains legal links and attribution instead of showing default navigation', async () => {
  useSystemConfigStore
    .getState()
    .setConfig({ footerHtml: '<p>Site contact information</p>' })
  client.setQueryData(['status'], {
    user_agreement_enabled: true,
    privacy_policy_enabled: true,
  })
  await renderFooter()

  expect(screen.getByText('Site contact information')).toBeVisible()
  expect(screen.getByRole('link', { name: 'User Agreement' })).toHaveAttribute(
    'href',
    '/user-agreement'
  )
  expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
    'href',
    '/privacy-policy'
  )
  expect(screen.getByRole('link', { name: 'New API' })).toBeVisible()
  expect(
    screen.queryByRole('navigation', { name: 'Footer navigation' })
  ).not.toBeInTheDocument()
})

test('switching the interface language updates the tagline and footer navigation immediately', async () => {
  await renderFooter()
  expect(screen.getByText('One connection. More possibilities.')).toBeVisible()

  await act(() => language.changeLanguage('zh'))

  expect(screen.getByText('一个连接，更多可能。')).toBeVisible()
  expect(screen.getByRole('navigation', { name: '页脚导航' })).toBeVisible()
  expect(screen.getByRole('link', { name: '文档中心' })).toHaveAttribute(
    'href',
    '/docs'
  )
  expect(
    screen.queryByRole('button', { name: '开源项目与资源' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText('One connection. More possibilities.')
  ).not.toBeInTheDocument()
})
