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
import { act, cleanup, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance, type i18n } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import ja from '@/i18n/locales/ja.json'
import ru from '@/i18n/locales/ru.json'
import viLocale from '@/i18n/locales/vi.json'
import zhTW from '@/i18n/locales/zh-TW.json'
import zhCN from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'

import { Comparison } from '../sections/comparison'
import { CTA } from '../sections/cta'
import { FAQ } from '../sections/faq'
import { Features } from '../sections/features'
import { Hero } from '../sections/hero'
import { HowItWorks } from '../sections/how-it-works'

const resources = { en, zhCN, zhTW, fr, ja, ru, vi: viLocale }
let client: QueryClient
let language: i18n
let missingKeys: string[]

beforeEach(async () => {
  window.localStorage.clear()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  missingKeys = []
  language = createInstance()
  language.on('missingKey', (_languages, _namespace, key) =>
    missingKeys.push(key)
  )
  await language.use(initReactI18next).init({
    resources,
    lng: 'en',
    fallbackLng: false,
    keySeparator: false,
    nsSeparator: false,
    saveMissing: true,
    interpolation: { escapeValue: false },
  })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { docs_link: 'https://docs.newapi.pro' } },
  })
})

afterEach(() => {
  cleanup()
  client.clear()
  language.off('missingKey')
  window.localStorage.clear()
})

async function renderHome(isAuthenticated = false) {
  function HomeSections() {
    return (
      <main>
        <Hero isAuthenticated={isAuthenticated} />
        <Features />
        <Comparison />
        <HowItWorks />
        <FAQ />
        <CTA isAuthenticated={isAuthenticated} />
      </main>
    )
  }
  const router = createRouter({
    routeTree: createRootRoute({ component: HomeSections }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(
    <I18nextProvider i18n={language}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

describe('homepage language and interactions', () => {
  it('opens the enabled documentation center locally from the hero', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { success: true, data: { docs_link: 'https://docs.newapi.pro', extension_features: { documentation: true } } },
    })
    await renderHome()
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Documentation' })).toHaveAttribute('href', '/docs')
    })
    expect(screen.getByRole('link', { name: 'Documentation' })).not.toHaveAttribute('target', '_blank')
  })
  it.each([
    ['en', 'One API.'],
    ['zhCN', '一个 API'],
    ['zhTW', '一個 API'],
    ['fr', 'Une seule API.'],
    ['ja', 'ひとつの API で。'],
    ['ru', 'Единый API.'],
    ['vi', 'Một API.'],
  ])(
    'renders all sections, capability panels and FAQ answers in %s without missing translations',
    async (locale, headline) => {
      const user = userEvent.setup()
      await language.changeLanguage(locale)
      await renderHome()

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        headline
      )
      for (const tab of screen.getAllByRole('tab')) {
        await user.click(tab)
        expect(tab).toHaveAttribute('aria-selected', 'true')
        expect(screen.getByRole('tabpanel')).toBeVisible()
      }
      for (const question of screen
        .getAllByRole('button')
        .filter((button) => button.hasAttribute('aria-expanded'))) {
        if (question.getAttribute('aria-expanded') === 'false') {
          await user.click(question)
        }
        expect(question).toHaveAttribute('aria-expanded', 'true')
        expect(
          document.getElementById(question.getAttribute('aria-controls') ?? '')
        ).toBeVisible()
      }
      expect(missingKeys).toEqual([])
    }
  )

  it('updates the entire homepage when switching from English to Simplified Chinese without reloading', async () => {
    await renderHome()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'One API.'
    )

    await act(async () => {
      await language.changeLanguage('zhCN')
    })

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '一个 API'
    )
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '接入全球顶尖 AI 模型'
    )
    expect(screen.getAllByRole('button', { name: '开始构建' })).toHaveLength(2)
    expect(screen.getByRole('tablist', { name: '核心功能' })).toBeVisible()
    expect(
      screen.getByRole('button', { name: '我可以用这个平台做什么？' })
    ).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.queryByText('Built for your next idea')
    ).not.toBeInTheDocument()
    expect(missingKeys).toEqual([])
  })

  it('moves focus with ArrowDown and selects the focused capability with Enter', async () => {
    const user = userEvent.setup()
    await renderHome()
    const tabs = screen.getAllByRole('tab')
    expect(screen.getByRole('tablist')).toHaveAttribute(
      'aria-orientation',
      'vertical'
    )
    await user.click(tabs[0])
    await user.keyboard('{ArrowDown}')

    expect(tabs[1]).toHaveFocus()
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false')
    expect(
      within(screen.getByRole('tabpanel')).getByText(
        'One place for usage and costs'
      )
    ).toBeVisible()
  })

  it('opens and closes FAQ answers using Enter and Space with matching accessible state', async () => {
    const user = userEvent.setup()
    await renderHome()
    const question = screen.getByRole('button', {
      name: 'Can I keep using my existing tools?',
    })
    expect(question).toHaveAttribute('aria-expanded', 'false')
    await user.click(question)
    expect(question).toHaveAttribute('aria-expanded', 'true')
    const answer = document.getElementById(
      question.getAttribute('aria-controls') ?? ''
    )
    expect(answer).toBeVisible()
    await user.keyboard('{Enter}')
    expect(question).toHaveAttribute('aria-expanded', 'false')
    expect(answer).not.toBeVisible()
    await user.keyboard(' ')
    expect(question).toHaveAttribute('aria-expanded', 'true')
    expect(question).toHaveFocus()
  })

  it.each([false, true])(
    'keeps both primary actions and routes them correctly when authenticated=%s',
    async (isAuthenticated) => {
      await renderHome(isAuthenticated)
      const buttons = screen.getAllByRole('button', {
        name: isAuthenticated ? 'Go to Dashboard' : 'Start building',
      })
      expect(buttons).toHaveLength(2)
      for (const button of buttons) {
        expect(button).toHaveAttribute(
          'href',
          isAuthenticated ? '/dashboard' : '/sign-up'
        )
      }
    }
  )
})
