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
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { AttachmentPicker } from '../components/attachment-picker'
import { ticketImageError } from '../constants'

afterEach(() => vi.unstubAllGlobals())

function Picker(props: { disabled?: boolean }) {
  const [files, setFiles] = useState<File[]>([])
  return (
    <AttachmentPicker
      files={files}
      onChange={setFiles}
      disabled={props.disabled}
    />
  )
}

it('accepts paste and drop images, releases preview URLs, and enforces count and type limits', async () => {
  const user = userEvent.setup()
  const revoked = vi.fn()
  const created = vi.fn(() => `blob:test-image-${revoked.mock.calls.length}`)
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL() {
        return created()
      }
      static revokeObjectURL(url: string) {
        revoked(url)
      }
    }
  )
  const { unmount } = render(<Picker />)
  const group = screen.getByRole('group', { name: 'Image attachments' })
  const screenshot = new File(['png'], 'error.png', { type: 'image/png' })
  fireEvent.paste(group, { clipboardData: { files: [screenshot] } })
  expect(await screen.findByRole('img', { name: 'error.png' })).toBeVisible()
  fireEvent.paste(group, { clipboardData: { files: [screenshot] } })
  expect(screen.getAllByRole('img')).toHaveLength(1)
  fireEvent.drop(group, {
    dataTransfer: {
      files: [new File(['svg'], 'unsafe.svg', { type: 'image/svg+xml' })],
    },
  })
  expect(screen.getByRole('alert')).toHaveTextContent(ticketImageError)
  expect(
    screen.queryByRole('img', { name: 'unsafe.svg' })
  ).not.toBeInTheDocument()
  const more = [1, 2, 3, 4].map(
    (id) => new File(['png'], `image-${id}.png`, { type: 'image/png' })
  )
  fireEvent.drop(group, { dataTransfer: { files: more } })
  expect(screen.getAllByRole('img')).toHaveLength(5)
  expect(screen.getByRole('button', { name: 'Add images' })).toBeDisabled()
  fireEvent.paste(group, { clipboardData: { files: [screenshot] } })
  expect(screen.getAllByRole('img')).toHaveLength(5)
  expect(screen.getByRole('alert')).toHaveTextContent(ticketImageError)
  await user.click(
    screen.getByRole('button', { name: 'Remove image error.png' })
  )
  expect(screen.getAllByRole('img')).toHaveLength(4)
  expect(revoked).toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Add images' })).toBeEnabled()
  unmount()
  expect(revoked).toHaveBeenCalledTimes(created.mock.calls.length)
})

it('rejects oversized images and ignores file changes while the submission is pending', () => {
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL() {
        return 'blob:test-image'
      }
      static revokeObjectURL() {}
    }
  )
  const { rerender } = render(<Picker />)
  const group = screen.getByRole('group', { name: 'Image attachments' })
  fireEvent.drop(group, {
    dataTransfer: {
      files: [
        new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.png', {
          type: 'image/png',
        }),
      ],
    },
  })
  expect(screen.getByRole('alert')).toHaveTextContent(ticketImageError)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  rerender(<Picker disabled />)
  expect(group).toHaveAttribute('aria-disabled', 'true')
  fireEvent.drop(group, {
    dataTransfer: {
      files: [new File(['png'], 'small.png', { type: 'image/png' })],
    },
  })
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Add images' })).toBeDisabled()
})
