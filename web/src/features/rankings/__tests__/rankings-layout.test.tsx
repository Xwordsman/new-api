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
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import { ModelLeaderboard } from '../components/model-leaderboard'
import { RankingsContent } from '../components/rankings-content'
import { RankingsHero } from '../components/rankings-hero'
import { TopModels } from '../components/top-models'
import type { ModelRanking, RankingsSnapshot } from '../types'

// Only the chart library's canvas boundary is replaced. The real feature
// components, table, links, period selector and state handling are exercised.
vi.mock('@visactor/react-vchart', () => ({ VChart: () => <canvas /> }))

const models: ModelRanking[] = [
  {
    rank: 1,
    model_name: 'GPT Example',
    vendor: 'OpenAI',
    category: 'all',
    total_tokens: 2_000_000,
    share: 0.5,
    growth_pct: 12.5,
  },
  {
    rank: 2,
    model_name: 'Claude Example',
    vendor: 'Anthropic',
    category: 'all',
    total_tokens: 1_000_000,
    share: 0.25,
    growth_pct: -4.2,
  },
  {
    rank: 3,
    model_name: 'Gemini Example',
    vendor: 'Google',
    category: 'all',
    total_tokens: 600_000,
    share: 0.15,
    growth_pct: 0,
  },
  {
    rank: 4,
    model_name: 'provider/model with a very long name + version',
    vendor: 'Example & Company',
    category: 'all',
    total_tokens: 400_000,
    share: 0.1,
    growth_pct: 2.1,
  },
]

function emptySnapshot(): RankingsSnapshot {
  return {
    models: [],
    vendors: [],
    top_movers: [],
    top_droppers: [],
    models_history: { points: [], models: [], buckets: 0 },
    vendor_share_history: { points: [], vendors: [], buckets: 0 },
  }
}

async function renderWithRouter(children: ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => children }),
    history: createMemoryHistory({ initialEntries: ['/rankings'] }),
  })
  await router.load()
  return render(<RouterProvider router={router} />)
}

describe('rankings presentation', () => {
  it('shows real aggregate counts and unknown counts while loading', () => {
    const snapshot = { ...emptySnapshot(), models }
    const { rerender } = render(
      <RankingsHero
        snapshot={snapshot}
        period='week'
        onPeriodChange={vi.fn()}
      />
    )
    expect(screen.getByText('Token volume').parentElement).toHaveTextContent(
      '4.00M'
    )
    expect(screen.getByText('Ranked models').parentElement).toHaveTextContent(
      '4'
    )
    expect(screen.getByText('Model providers').parentElement).toHaveTextContent(
      '0'
    )
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)

    rerender(<RankingsHero period='week' pending onPeriodChange={vi.fn()} />)
    expect(screen.getAllByText('—')).toHaveLength(3)
    expect(screen.getByText('Ranked models').closest('dl')).toHaveAttribute(
      'aria-busy',
      'true'
    )
  })

  it('supports period selection by pointer and keyboard without clearing the current period', async () => {
    const onPeriodChange = vi.fn()
    const user = userEvent.setup()
    render(<RankingsHero period='week' onPeriodChange={onPeriodChange} />)
    const period = screen.getByRole('group', { name: 'Period' })
    const week = within(period).getByRole('button', { name: 'Week' })
    expect(week).toHaveAttribute('aria-pressed', 'true')

    await user.click(week)
    expect(onPeriodChange).not.toHaveBeenCalled()
    await user.click(within(period).getByRole('button', { name: 'Month' }))
    expect(onPeriodChange).toHaveBeenLastCalledWith('month')

    week.focus()
    await user.keyboard('{ArrowRight}{Enter}')
    expect(within(period).getByRole('button', { name: 'Month' })).toHaveFocus()
    expect(onPeriodChange).toHaveBeenLastCalledWith('month')
  })

  it('updates hero copy and numeric formatting after a language switch', async () => {
    const i18n = createInstance()
    await i18n.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: { translation: {} },
        fr: { translation: { 'Ranked models': 'Modèles classés' } },
      },
    })
    const snapshot = {
      ...emptySnapshot(),
      models: Array<ModelRanking>(12345).fill(models[0]),
    }
    render(
      <I18nextProvider i18n={i18n}>
        <RankingsHero
          snapshot={snapshot}
          period='week'
          onPeriodChange={vi.fn()}
        />
      </I18nextProvider>
    )
    expect(screen.getByText('12,345')).toBeVisible()
    await act(() => i18n.changeLanguage('fr'))
    expect(screen.getByText('Modèles classés')).toBeVisible()
    expect(screen.getByText(/^12\s345$/)).toBeVisible()
  })

  it('spotlights only the first three supplied models and does not invent missing leaders', async () => {
    const view = await renderWithRouter(<TopModels rows={models} />)
    const leaders = screen.getByRole('region', { name: 'Leading models' })
    expect(
      within(leaders).getByRole('link', { name: 'GPT Example' })
    ).toBeVisible()
    expect(
      within(leaders).getByRole('link', { name: 'Gemini Example' })
    ).toBeVisible()
    expect(
      within(leaders).queryByRole('link', { name: models[3].model_name })
    ).not.toBeInTheDocument()
    expect(within(leaders).getByText('2.00M')).toBeVisible()
    expect(within(leaders).getByText('50.0%')).toBeVisible()
    view.unmount()

    await renderWithRouter(<TopModels rows={models.slice(0, 1)} />)
    expect(screen.getAllByText(/Rank \d/)).toHaveLength(1)
    expect(
      screen.queryByRole('link', { name: 'Claude Example' })
    ).not.toBeInTheDocument()
  })

  it('preserves the full leaderboard, growth and encoded model and vendor destinations', async () => {
    await renderWithRouter(<ModelLeaderboard rows={models} />)
    const table = screen.getByRole('table', { name: 'LLM Leaderboard' })
    expect(within(table).getAllByRole('row')).toHaveLength(5)
    const last = within(table).getAllByRole('row')[4]
    const model = within(last).getByRole('link', { name: models[3].model_name })
    expect(model).toHaveAttribute('title', models[3].model_name)
    expect(model).toHaveAttribute(
      'href',
      '/pricing/provider%2Fmodel%20with%20a%20very%20long%20name%20%2B%20version'
    )
    expect(
      within(last).getByRole('link', { name: models[3].vendor })
    ).toHaveAttribute('href', '/pricing?vendor=Example+%26+Company')
    expect(within(last).getByText('400K')).toBeVisible()
    expect(within(last).getByText('10.0%')).toBeVisible()
    expect(within(last).getAllByText('↑2.1%')).toHaveLength(2)
  })

  it('shows an accessible loading state without a premature empty result', () => {
    render(<RankingsContent period='week' pending onRetry={vi.fn()} />)
    expect(
      screen.getByRole('status', { name: 'Loading...' })
    ).toBeInTheDocument()
    expect(
      screen.queryByText('No ranking data for this period')
    ).not.toBeInTheDocument()
  })

  it('offers a working retry when ranking data fails to load', async () => {
    const retry = vi.fn()
    const user = userEvent.setup()
    render(<RankingsContent period='week' pending={false} onRetry={retry} />)
    expect(screen.getByText('Unable to load rankings')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('replaces all empty panels with one empty state and a model catalog link', async () => {
    await renderWithRouter(
      <RankingsContent
        snapshot={emptySnapshot()}
        period='week'
        pending={false}
        onRetry={vi.fn()}
      />
    )
    expect(screen.getByText('No ranking data for this period')).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'Explore models' })
    ).toHaveAttribute('href', '/pricing')
    expect(
      screen.queryByText('No history data available')
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('keeps partial ranking data visible when only vendor totals are available', async () => {
    const snapshot: RankingsSnapshot = {
      ...emptySnapshot(),
      vendors: [
        {
          rank: 1,
          vendor: 'OpenAI',
          total_tokens: 1000,
          share: 1,
          growth_pct: 0,
          models_count: 1,
          top_model: 'GPT Example',
        },
      ],
    }
    await renderWithRouter(
      <RankingsContent
        snapshot={snapshot}
        period='week'
        pending={false}
        onRetry={vi.fn()}
      />
    )
    expect(
      screen.queryByText('No ranking data for this period')
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'OpenAI' })).toHaveAttribute(
      'href',
      '/pricing?vendor=OpenAI'
    )
    expect(screen.getByText('100.0%')).toBeVisible()
    expect(screen.getByText('No notable climbers right now')).toBeVisible()
  })
})
