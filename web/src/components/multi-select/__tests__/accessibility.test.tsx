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
import { expect, it } from 'vitest'

import { MultiSelect } from '@/components/multi-select'

it('forwards the form label, description and validation state to the keyboard control', async () => {
  const user = userEvent.setup()
  render(
    <>
      <label id='groups-label' htmlFor='groups'>
        Published groups
      </label>
      <p id='groups-error'>Choose fewer groups</p>
      <MultiSelect
        id='groups'
        options={[{ value: 'public', label: 'public' }]}
        selected={[]}
        onChange={() => undefined}
        aria-labelledby='groups-label'
        aria-describedby='groups-error'
        aria-invalid
        data-form-root='monitor-form'
      />
    </>
  )
  const input = screen.getByRole('combobox', { name: 'Published groups' })
  expect(input).toHaveAccessibleDescription('Choose fewer groups')
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(input).toHaveAttribute('data-form-root', 'monitor-form')
  await user.click(screen.getByText('Published groups'))
  expect(input).toHaveFocus()
  await user.keyboard('{ArrowDown}')
  expect(input).toHaveAttribute('aria-expanded', 'true')
})
