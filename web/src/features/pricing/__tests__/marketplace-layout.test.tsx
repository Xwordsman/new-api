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
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import { EmptyState } from '../components/empty-state'
import { LoadingSkeleton } from '../components/loading-skeleton'
import { PricingHero } from '../components/pricing-hero'

describe('model marketplace presentation', () => {
  it('shows catalog counts and only the supplied provider brands', () => {
    render(
      <PricingHero
        modelCount={42}
        groupCount={3}
        vendors={[
          { id: 1, name: 'OpenAI' },
          { id: 2, name: 'Anthropic' },
        ]}
      />
    )
    expect(
      screen.getByText('Available Models').parentElement
    ).toHaveTextContent('42')
    expect(screen.getByText('Model providers').parentElement).toHaveTextContent(
      '2'
    )
    expect(
      screen.getByText('Available groups').parentElement
    ).toHaveTextContent('3')
    expect(screen.getByText('OpenAI')).toBeVisible()
    expect(screen.getByText('Anthropic')).toBeVisible()
    expect(screen.queryByText('Gemini')).not.toBeInTheDocument()
  })

  it('keeps one page heading and unknown counts while the catalog is loading', () => {
    const { container } = render(
      <>
        <PricingHero modelCount={0} groupCount={0} vendors={[]} pending />
        <LoadingSkeleton />
      </>
    )
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(container.querySelector('dl')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getAllByText('—')).toHaveLength(3)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Model providers')).not.toBeInTheDocument()
  })

  it('distinguishes an empty catalog from a filtered search and offers clearing only for filters', async () => {
    const clear = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <EmptyState hasActiveFilters={false} onClearFilters={clear} />
    )
    expect(screen.getByText('No models are available yet')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    rerender(
      <EmptyState
        searchQuery='unknown-model'
        hasActiveFilters={false}
        onClearFilters={clear}
      />
    )
    expect(screen.getByText('No models found')).toBeVisible()
    expect(screen.getByText(/unknown-model/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Clear all filters' }))
    expect(clear).toHaveBeenCalledOnce()
  })

  it('updates hero copy and number formatting when the interface language changes', async () => {
    const i18n = createInstance()
    await i18n.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: { translation: {} },
        fr: { translation: { 'Available Models': 'Modèles disponibles' } },
      },
    })
    render(
      <I18nextProvider i18n={i18n}>
        <PricingHero modelCount={12345} groupCount={0} vendors={[]} />
      </I18nextProvider>
    )
    expect(screen.getByText('12,345')).toBeVisible()
    await act(() => i18n.changeLanguage('fr'))
    expect(screen.getByText('Modèles disponibles')).toBeVisible()
    expect(screen.getByText(/^12\s345$/)).toBeVisible()
  })
})
