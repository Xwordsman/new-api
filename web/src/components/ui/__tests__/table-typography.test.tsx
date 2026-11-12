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
import { expect, it } from 'vitest'

import { Table, TableBody, TableCell, TableRow } from '../table'

it('keeps uniform typography by default and allows content-specific typography when requested', () => {
  const view = render(
    <Table aria-label='Results'>
      <TableBody>
        <TableRow>
          <TableCell>
            <span className='font-mono text-xs'>gpt-4.1</span>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
  const table = screen.getByRole('table', { name: 'Results' })
  expect(table).toHaveClass('[&_:is(th,td)_*]:[font-size:inherit]')
  expect(table).toHaveClass('[&_:is(th,td)_*]:[font-weight:inherit]')
  expect(table).toHaveClass('[&_:is(th,td)_*]:[font-family:inherit]')

  view.rerender(
    <Table aria-label='Results' typography='content'>
      <TableBody>
        <TableRow>
          <TableCell>
            <span className='font-mono text-xs'>gpt-4.1</span>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
  expect(table).not.toHaveClass('[&_:is(th,td)_*]:[font-size:inherit]')
  expect(table).not.toHaveClass('[&_:is(th,td)_*]:[font-weight:inherit]')
  expect(table).not.toHaveClass('[&_:is(th,td)_*]:[font-family:inherit]')
  expect(screen.getByText('gpt-4.1')).toHaveClass('font-mono', 'text-xs')
  expect(table.parentElement).toHaveClass('overflow-x-auto')
})
