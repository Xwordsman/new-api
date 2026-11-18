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
import { useState } from 'react'
import { expect, it, vi } from 'vitest'

import { TagInput } from '../tag-input'

function LimitedTags() {
  const [tags, setTags] = useState(['Stable'])
  return <TagInput value={tags} onChange={setTags} maxTags={2} maxLength={6} />
}

it('limits tag length and count and allows adding again after a tag is removed', async () => {
  const user = userEvent.setup()
  render(<LimitedTags />)
  const input = screen.getByRole('textbox')
  await user.type(input, 'Fast123{Enter}')
  expect(screen.getByText('Fast12')).toBeVisible()
  expect(input).toHaveAttribute('readonly')
  await user.click(screen.getAllByRole('button', { name: 'Remove tag' })[1])
  expect(input).not.toHaveAttribute('readonly')
  await user.type(input, 'Fast{Enter}')
  expect(screen.getByText('Fast')).toBeVisible()
})

it('disables tag entry and removal while disabled', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<TagInput value={['Stable']} onChange={onChange} disabled />)
  expect(screen.getByRole('textbox')).toBeDisabled()
  expect(
    screen.queryByRole('button', { name: 'Remove tag' })
  ).not.toBeInTheDocument()
  await user.type(screen.getByRole('textbox'), 'Fast{Enter}')
  expect(onChange).not.toHaveBeenCalled()
})
