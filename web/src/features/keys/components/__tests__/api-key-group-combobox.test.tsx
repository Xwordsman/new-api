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
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'

import {
  applyGroupAppearance,
  emptyAppearance,
  type GroupDisplaySettings,
} from '@/extensions/group-display/types'

let shouldReduceMotion = false
const reducedMotionMediaQuery = window.matchMedia('(prefers-reduced-motion)')
Object.defineProperty(reducedMotionMediaQuery, 'matches', {
  configurable: true,
  get: () => shouldReduceMotion,
})
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: () => reducedMotionMediaQuery,
})

function setReducedMotion(value: boolean) {
  shouldReduceMotion = value
  reducedMotionMediaQuery.dispatchEvent(new Event('change'))
}

const { useState } = await import('react')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { ApiKeyGroupCombobox } = await import('../api-key-group-combobox')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        Auto: 'Auto',
        Ratio: 'Ratio',
        'Search...': 'Search...',
        'No group found.': 'No group found.',
        'Select a group': 'Select a group',
      },
    },
  },
})

const options = [
  {
    value: 'auto',
    label: 'auto',
    desc: 'Global automatic routing',
    ratio: '自动',
  },
  { value: 'default', label: 'default', desc: 'User group', ratio: 1 },
  { value: 'vip', label: 'vip', desc: 'Priority group', ratio: 3 },
]

function Harness(props: { initialValue: string }) {
  const [value, setValue] = useState(props.initialValue)

  return (
    <I18nextProvider i18n={i18n}>
      <ApiKeyGroupCombobox
        options={options}
        value={value}
        onValueChange={setValue}
      />
      <output data-testid='selected-group'>{value}</output>
    </I18nextProvider>
  )
}

function getTrigger(): HTMLButtonElement {
  return screen.getByRole('combobox')
}

function getCommandItem(label: string): HTMLElement {
  const item = [
    ...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]'),
  ].find((candidate) => candidate.textContent?.includes(label))
  if (!item) {
    throw new Error(`Expected command item containing "${label}"`)
  }
  return item
}

describe('API key group combobox Auto effect', () => {
  test('uses the compact table capsules in the selected group and dropdown options', () => {
    setReducedMotion(false)
    render(<Harness initialValue='auto' />)

    const trigger = getTrigger()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveAttribute('data-auto-group-effect', 'trigger')
    expect(trigger).not.toHaveClass('bg-linear-to-r', 'overflow-hidden')
    expect(trigger).toHaveClass('overflow-visible')

    const triggerFlowBorder = trigger.querySelector<HTMLElement>(
      '[data-auto-group-flow-border]'
    )
    expect(triggerFlowBorder).toHaveAttribute('aria-hidden', 'true')
    expect(triggerFlowBorder).toHaveClass(
      'pointer-events-none',
      'auto-group-flow-border'
    )

    const triggerRatio = within(trigger)
      .getByText('Auto')
      .closest('[data-slot="badge"]')
    expect(triggerRatio).toHaveTextContent('Auto')
    expect(triggerRatio).not.toHaveTextContent('Ratio')
    expect(triggerRatio).not.toHaveTextContent('x')
    expect(trigger).not.toHaveTextContent('自动')
    expect(triggerRatio).toHaveClass(
      'relative',
      'overflow-visible',
      'rounded-md',
      'h-5',
      'min-w-12'
    )
    expect(
      triggerRatio?.querySelector('[data-auto-group-flow-border]')
    ).toHaveClass('auto-group-flow-border-subtle')

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    const autoOption = getCommandItem('Global automatic routing')
    expect(autoOption).toHaveAttribute('data-auto-group-effect', 'option')
    expect(autoOption).toHaveAttribute('aria-selected', 'true')
    expect(autoOption).not.toHaveClass('bg-linear-to-r')
    expect(autoOption).toHaveClass('overflow-visible')
    expect(
      autoOption.querySelector('[data-auto-group-flow-border]')
    ).toBeInTheDocument()
    const optionRatio = within(autoOption)
      .getByText('Auto')
      .closest('[data-slot="badge"]')
    expect(optionRatio).toHaveTextContent('Auto')
    expect(optionRatio).not.toHaveTextContent('Ratio')
    expect(
      optionRatio?.querySelector('[data-auto-group-flow-border]')
    ).toHaveClass('auto-group-flow-border-subtle')

    const defaultOption = getCommandItem('User group')
    expect(defaultOption).not.toHaveAttribute('data-auto-group-effect')
    expect(defaultOption.querySelector('[data-auto-group-flow-border]')).toBe(
      null
    )
    const defaultRatio = within(defaultOption)
      .getByText('1x')
      .closest('[data-slot="badge"]')
    expect(defaultRatio).toHaveClass(
      'h-5',
      'min-w-12',
      'rounded-full',
      'tabular-nums',
      'border-muted-foreground/30'
    )
    expect(defaultRatio).not.toHaveTextContent('Ratio')
    expect(
      defaultOption.querySelector('[data-auto-group-effect="ratio"]')
    ).toBe(null)
  })

  test('keeps search and selection behavior while leaving normal groups unstyled', async () => {
    setReducedMotion(false)
    const { container } = render(<Harness initialValue='auto' />)

    const trigger = getTrigger()
    fireEvent.click(trigger)

    fireEvent.input(screen.getByPlaceholderText('Search...'), {
      target: { value: 'vip' },
    })

    const visibleOptions = [
      ...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]'),
    ]
    expect(
      visibleOptions.some((option) =>
        option.textContent?.includes('Global automatic routing')
      )
    ).toBe(false)
    const vipOption = getCommandItem('Priority group')
    fireEvent.click(vipOption)

    expect(within(container).getByTestId('selected-group')).toHaveTextContent(
      'vip'
    )
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).not.toHaveAttribute('data-auto-group-effect')
    expect(trigger.querySelector('[data-auto-group-flow-border]')).toBe(null)
  })

  test('preserves the static Auto treatment but omits moving layers for reduced motion', async () => {
    setReducedMotion(true)
    render(<Harness initialValue='auto' />)

    const trigger = getTrigger()
    expect(trigger).toHaveAttribute('data-auto-group-effect', 'trigger')
    expect(trigger.querySelector('[data-auto-group-flow-border]')).toBe(null)
    expect(within(trigger).getByText('Auto')).toBeInTheDocument()

    fireEvent.click(trigger)
    const autoOption = getCommandItem('Global automatic routing')
    expect(autoOption).toHaveAttribute('data-auto-group-effect', 'option')
    expect(autoOption.querySelector('[data-auto-group-flow-border]')).toBe(null)
    expect(within(autoOption).getByText('Auto')).toBeInTheDocument()
    setReducedMotion(false)
  })
})

describe('API key group appearance', () => {
  const settings: GroupDisplaySettings = {
    revision: 1,
    categories: [
      { id: '__other', name: 'OpenAI', icon: '', color: '#16a34a' },
      { id: 'anthropic', name: 'Anthropic', icon: '', color: '#e67e22' },
    ],
    groups: {
      default: {
        ...emptyAppearance,
        category: '__other',
        display_name: 'GPT standard',
        description: 'Stable conversations',
        tags: [{ label: 'Recommended', color: '' }],
        sort_order: 20,
        featured: true,
        border: 'gradient',
        gradient_to: '#38bdf8',
        background: true,
      },
      vip: {
        ...emptyAppearance,
        category: '__other',
        display_name: 'GPT priority',
        sort_order: 1,
      },
    },
  }

  test('orders categories and rows, searches tags, and selects the original routing key', async () => {
    const user = userEvent.setup()
    const selected: string[] = []
    render(
      <I18nextProvider i18n={i18n}>
        <ApiKeyGroupCombobox
          options={applyGroupAppearance(
            [...options, { value: 'other', label: 'Uncategorized' }],
            settings
          )}
          value='auto'
          onValueChange={(value) => selected.push(value)}
        />
      </I18nextProvider>
    )
    await user.click(getTrigger())
    const rows = screen.getAllByRole('option')
    expect(rows.map((row) => row.getAttribute('data-value'))).toEqual([
      'auto',
      'vip',
      'default',
      'other',
    ])
    expect(screen.getByRole('group', { name: 'OpenAI' })).toBeVisible()
    expect(screen.getByRole('group', { name: 'Other groups' })).toBeVisible()
    const search = screen.getByRole('combobox', { name: 'Search groups' })
    await user.type(search, 'recommended')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    const row = screen.getByRole('option')
    expect(row).toHaveTextContent('GPT standard')
    expect(row).toHaveTextContent('Stable conversations')
    expect(within(row).getByText('Featured')).toBeVisible()
    expect(row).toHaveAttribute('data-border', 'gradient')
    expect(row).toHaveAttribute('data-tinted', 'true')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(selected).toEqual(['default'])
    expect(getTrigger()).toHaveAttribute('aria-expanded', 'false')
  })

  test('shows the empty result and restores selection after clearing search', async () => {
    const user = userEvent.setup()
    render(<Harness initialValue='vip' />)
    await user.click(getTrigger())
    const search = screen.getByRole('combobox', { name: 'Search groups' })
    await user.type(search, 'nonexistent-group')
    expect(screen.getByText('No group found.')).toBeVisible()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    await user.clear(search)
    expect(getCommandItem('Priority group')).toHaveAttribute(
      'data-checked',
      'true'
    )
    await user.keyboard('{Escape}')
    expect(getTrigger()).toHaveAttribute('aria-expanded', 'false')
  })

  test('enables featured effects from one switch and preserves them without animation for reduced motion', async () => {
    setReducedMotion(true)
    const user = userEvent.setup()
    render(
      <I18nextProvider i18n={i18n}>
        <ApiKeyGroupCombobox
          options={applyGroupAppearance(options, {
            ...settings,
            groups: {
              default: {
                ...emptyAppearance,
                category: '__other',
                featured: true,
              },
            },
          })}
          value='default'
          onValueChange={() => {}}
        />
      </I18nextProvider>
    )
    const trigger = getTrigger()
    expect(trigger).toHaveAttribute('data-featured', 'true')
    expect(trigger).toHaveAttribute('data-reduced-motion', 'true')
    expect(trigger).not.toHaveAttribute('data-border')
    expect(within(trigger).getByText('Featured')).toBeVisible()
    expect(trigger.querySelector('[data-auto-group-flow-border]')).toBeNull()
    await user.click(trigger)
    const featured = screen.getByRole('option', { name: /default/ })
    expect(featured).toHaveAttribute('data-featured', 'true')
    expect(featured).toHaveAttribute('data-reduced-motion', 'true')
    expect(featured.querySelector('[data-auto-group-flow-border]')).toBeNull()
    expect(within(featured).getByText('default')).toHaveAttribute(
      'data-featured',
      'true'
    )
    const normal = screen.getByRole('option', { name: /vip/ })
    expect(normal).not.toHaveAttribute('data-featured')
    expect(within(normal).queryByText('Featured')).not.toBeInTheDocument()
    setReducedMotion(false)
  })

  test('shows a featured text badge and a single moving frame for featured normal and auto groups', async () => {
    setReducedMotion(false)
    const user = userEvent.setup()
    render(
      <I18nextProvider i18n={i18n}>
        <ApiKeyGroupCombobox
          options={applyGroupAppearance(options, {
            ...settings,
            groups: {
              ...settings.groups,
              auto: { ...emptyAppearance, featured: true },
            },
          })}
          value='default'
          onValueChange={() => {}}
        />
      </I18nextProvider>
    )
    const trigger = getTrigger()
    expect(within(trigger).getByText('Featured')).toBeVisible()
    expect(
      within(trigger).queryByRole('img', { name: 'Featured' })
    ).not.toBeInTheDocument()
    expect(
      trigger.querySelector(':scope > [data-auto-group-flow-border]')
    ).toHaveAttribute('aria-hidden', 'true')
    await user.click(trigger)
    for (const name of [/GPT standard/, /Global automatic routing/]) {
      const row = screen.getByRole('option', { name })
      expect(within(row).getByText('Featured')).toBeVisible()
      expect(
        row.querySelectorAll(':scope > [data-auto-group-flow-border]')
      ).toHaveLength(1)
    }
    const normal = screen.getByRole('option', { name: /GPT priority/ })
    expect(within(normal).queryByText('Featured')).not.toBeInTheDocument()
    expect(normal.querySelector('[data-auto-group-flow-border]')).toBeNull()
  })

  test('keeps a categorized auto group inside its configured category', async () => {
    const user = userEvent.setup()
    render(
      <I18nextProvider i18n={i18n}>
        <ApiKeyGroupCombobox
          options={applyGroupAppearance(options, {
            ...settings,
            groups: {
              ...settings.groups,
              auto: { ...emptyAppearance, category: '__other', sort_order: 5 },
            },
          })}
          value='auto'
          onValueChange={() => {}}
        />
      </I18nextProvider>
    )
    await user.click(getTrigger())
    const category = screen.getByRole('group', { name: 'OpenAI' })
    expect(
      within(category)
        .getAllByRole('option')
        .map((row) => row.getAttribute('data-value'))
    ).toEqual(['vip', 'auto', 'default'])
  })

  test('keeps the chosen group marked while keyboard focus moves to another styled row', async () => {
    const user = userEvent.setup()
    render(
      <I18nextProvider i18n={i18n}>
        <ApiKeyGroupCombobox
          options={applyGroupAppearance(options, settings)}
          value='default'
          onValueChange={() => {}}
        />
      </I18nextProvider>
    )
    await user.click(getTrigger())
    const chosen = screen.getByRole('option', { name: /GPT standard/ })
    expect(chosen).toHaveAttribute('data-checked', 'true')
    await user.keyboard('{Home}{ArrowDown}')
    const focused = screen.getByRole('option', { name: /GPT priority/ })
    expect(focused).toHaveAttribute('aria-selected', 'true')
    expect(focused).toHaveAttribute('data-checked', 'false')
    expect(chosen).toHaveAttribute('data-checked', 'true')
    await user.keyboard('{Escape}')
    expect(getTrigger()).toHaveTextContent('GPT standard')
  })

  test('keeps a disabled selector closed and leaves unconfigured reserved-looking keys usable', async () => {
    const user = userEvent.setup()
    const rendered = applyGroupAppearance(
      [{ value: 'constructor', label: 'constructor' }],
      settings
    )
    expect(rendered[0]).toEqual({ value: 'constructor', label: 'constructor' })
    render(
      <I18nextProvider i18n={i18n}>
        <ApiKeyGroupCombobox
          options={rendered}
          value='constructor'
          disabled
          onValueChange={() => {
            throw new Error('Disabled selector changed')
          }}
        />
      </I18nextProvider>
    )
    expect(getTrigger()).toBeDisabled()
    await user.click(getTrigger())
    expect(getTrigger()).toHaveAttribute('aria-expanded', 'false')
  })
})
