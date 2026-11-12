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
import { readFileSync } from 'node:fs'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import postcss from 'postcss'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { TitledCard } from '@/components/ui/titled-card'
import { WalletStatsCard } from '@/features/wallet/components/wallet-stats-card'

let stylesheet: HTMLStyleElement

beforeEach(() => {
  const css = postcss.parse(readFileSync('src/styles/gateway.css', 'utf8'))
  // jsdom does not apply cascade layers. Keep the real rules and selectors.
  css.walkAtRules('layer', (layer) => {
    layer.replaceWith(...(layer.nodes ?? []))
  })
  stylesheet = document.createElement('style')
  stylesheet.textContent = css.toString()
  document.head.append(stylesheet)
})

afterEach(() => stylesheet.remove())

it('keeps ordinary console cards, lists and forms plain while hovering or focusing their controls', async () => {
  const user = userEvent.setup()
  render(
    <main className='console-page'>
      <Card aria-label='API keys' data-console-tone='success'>
        <Button>Add key</Button>
      </Card>
      <section
        aria-label='Usage chart'
        className='console-surface'
        data-console-tone='info'
      >
        <Button>Refresh chart</Button>
      </section>
      <TitledCard title='Settings' iconTone='warning'>
        <Button>Save settings</Button>
      </TitledCard>
    </main>
  )

  for (const name of ['Add key', 'Refresh chart', 'Save settings']) {
    const control = screen.getByRole('button', { name })
    const surface = control.closest('[data-slot="card"], .console-surface')
    if (!surface) throw new Error('Expected a console surface')
    const normal = getComputedStyle(surface)
    expect(normal.backgroundColor).toBe('var(--card)')
    expect(normal.backgroundImage).toBe('none')

    await user.hover(control)
    control.focus()
    const active = getComputedStyle(surface)
    expect(active.backgroundImage).toBe('none')
    expect(active.backgroundColor).toBe(normal.backgroundColor)
    expect(active.borderColor).toBe(normal.borderColor)
    expect(active.boxShadow).toBe(normal.boxShadow)
    await user.unhover(control)
    control.blur()
  }
})

it('preserves statistic accents and keeps the enclosing module plain when a wallet statistic is hovered', async () => {
  const user = userEvent.setup()
  render(
    <main className='console-page'>
      <Card aria-label='Wallet details'>
        <WalletStatsCard user={null} />
      </Card>
    </main>
  )
  const frame = screen.getByLabelText('Wallet details')
  const stats = ['Current Balance', 'Total Usage', 'API Requests'].map(
    (name) => {
      const surface = screen.getByText(name).closest('.console-surface')
      if (!surface) throw new Error('Expected a statistic surface')
      return surface
    }
  )

  for (const stat of stats) {
    expect(getComputedStyle(stat).backgroundImage).toContain('radial-gradient')
    await user.hover(stat)
    expect(getComputedStyle(stat).backgroundImage).toContain('radial-gradient')
    expect(getComputedStyle(frame).backgroundImage).toBe('none')
    expect(getComputedStyle(frame).boxShadow).toBe('')
    await user.unhover(stat)
    expect(getComputedStyle(frame).backgroundImage).toBe('none')
  }
})
