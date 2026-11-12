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
import { expect, test } from 'vitest'

import { WebPreview, WebPreviewBody, WebPreviewConsole } from '../web-preview'

test('a preview without an explicit sandbox isolates scripted content from the host origin', () => {
  render(
    <WebPreview defaultUrl='https://preview.example/'>
      <WebPreviewBody />
    </WebPreview>
  )
  const frame = screen.getByTitle('Preview')

  expect(frame).toHaveAttribute('src', 'https://preview.example/')
  expect(frame).toHaveAttribute(
    'sandbox',
    'allow-scripts allow-forms allow-popups allow-presentation'
  )
})

test.each(['', 'allow-scripts'])(
  'a caller selecting sandbox %j keeps its own restrictive policy and document',
  (sandbox) => {
    const document = '<!doctype html><p>Isolated preview content</p>'
    render(
      <WebPreview>
        <WebPreviewBody
          sandbox={sandbox}
          srcDoc={document}
          referrerPolicy='no-referrer'
          title='Isolated preview'
        />
      </WebPreview>
    )
    const frame = screen.getByTitle('Isolated preview')

    expect(frame).toHaveAttribute('sandbox', sandbox)
    expect(frame).toHaveAttribute('srcdoc', document)
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
  }
)

test('expanding a preview console preserves identical log messages recorded at the same time', async () => {
  const user = userEvent.setup()
  const timestamp = new Date('2026-11-12T12:00:00Z')
  render(
    <WebPreview>
      <WebPreviewConsole
        logs={[
          { level: 'log', message: 'Repeated console event', timestamp },
          { level: 'log', message: 'Repeated console event', timestamp },
        ]}
      />
    </WebPreview>
  )

  const toggle = screen.getByRole('button', { name: 'Console' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await user.click(toggle)

  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const entries = screen.getAllByText('Repeated console event')
  expect(entries).toHaveLength(2)
  for (const entry of entries) {
    expect(entry).toBeVisible()
  }
})
