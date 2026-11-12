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
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'

import { PageFooterProvider } from '@/components/layout/components/page-footer'

import { DataTableCardGrid } from '../card-grid'
import { DataTablePage } from '../data-table-page'
import { MobileCardList } from '../mobile-card-list'

type Channel = { name: string }

const channels: Channel[] = [{ name: 'Production channel' }]
const emptyChannels: Channel[] = []
const columns: ColumnDef<Channel>[] = [{ accessorKey: 'name', header: 'Name' }]

function Fixture(props: {
  empty?: boolean
  fixedHeight?: boolean
  showPagination?: boolean
  presentation?: 'page' | 'grid' | 'list'
}) {
  const [footer, setFooter] = useState<HTMLDivElement | null>(null)
  const table = useReactTable({
    data: props.empty ? emptyChannels : channels,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  if (props.presentation === 'grid') {
    return <DataTableCardGrid table={table} emptyTitle='No channels' />
  }
  if (props.presentation === 'list') {
    return <MobileCardList table={table} emptyTitle='No channels' />
  }

  return (
    <>
      <PageFooterProvider container={footer}>
        <DataTablePage
          table={table}
          columns={columns}
          enableCardView
          fixedHeight={props.fixedHeight}
          emptyTitle='No channels'
          showPagination={props.showPagination ?? false}
          toolbarProps={{
            searchPlaceholder: 'Search channels',
            hideViewOptions: true,
          }}
          renderCard={(row) => <p>{row.original.name}</p>}
        />
      </PageFooterProvider>
      <div ref={setFooter} role='contentinfo' />
    </>
  )
}

it.each([false, true])(
  'keeps filters and content on one themed surface across view changes when empty is %s',
  async (empty) => {
    const user = userEvent.setup()
    render(<Fixture empty={empty} />)

    const surface = screen
      .getByPlaceholderText('Search channels')
      .closest('[data-slot="card"]')
    expect(surface).toHaveClass('bg-card', 'rounded-xl')
    expect(surface).toContainElement(
      screen.getByText(empty ? 'No channels' : 'Production channel')
    )

    await user.click(screen.getByRole('button', { name: 'Table view' }))

    expect(screen.getByRole('button', { name: 'Table view' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(surface).toContainElement(screen.getByRole('table'))
    expect(surface).toContainElement(
      screen.getByText(empty ? 'No channels' : 'Production channel')
    )
    expect(surface).toContainElement(
      screen.getByPlaceholderText('Search channels')
    )
  }
)

it.each([true, false])(
  'preserves internal scrolling only when fixed height is %s',
  (fixedHeight) => {
    render(<Fixture fixedHeight={fixedHeight} />)

    const surface = screen
      .getByPlaceholderText('Search channels')
      .closest('[data-slot="card"]')
    const scrollArea = screen
      .getByText('Production channel')
      .closest('.transition-opacity')
    expect(surface).toHaveClass('bg-card')
    if (fixedHeight) {
      expect(surface).toHaveClass('h-full', 'min-h-0')
      expect(scrollArea).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto')
    } else {
      expect(surface).not.toHaveClass('h-full')
      expect(scrollArea).not.toHaveClass('overflow-y-auto')
    }
  }
)

it('keeps mobile filters and empty content inside the same themed surface', () => {
  const original = window.matchMedia
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...original(query),
    matches: query === '(max-width: 640px)' || original(query).matches,
  }))
  render(<Fixture empty />)

  const surface = screen
    .getByPlaceholderText('Search channels')
    .closest('[data-slot="card"]')
  expect(surface).toHaveClass('bg-card')
  expect(surface).toContainElement(screen.getByText('No channels'))
  expect(
    screen.getByText('No channels').closest('.overflow-y-auto')
  ).not.toBeNull()
})

it('keeps pagination in the page footer outside the list surface', () => {
  render(<Fixture showPagination />)

  const footer = screen.getByRole('contentinfo')
  const nextPage = within(footer).getByRole('button', {
    name: 'Go to next page',
  })
  expect(nextPage).toBeVisible()
  expect(nextPage).toBeDisabled()
  expect(
    screen.getByPlaceholderText('Search channels').closest('[data-slot="card"]')
  ).not.toContainElement(nextPage)
})

it.each(['grid', 'list'] as const)(
  'gives the standalone %s empty state its own themed background',
  (presentation) => {
    render(<Fixture empty presentation={presentation} />)

    expect(screen.getByText('No channels').closest('.border')).toHaveClass(
      'bg-card'
    )
  }
)
