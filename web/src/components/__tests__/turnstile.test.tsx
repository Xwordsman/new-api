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
import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { Turnstile } from '../turnstile'

afterEach(() => {
  delete window.turnstile
  document.querySelector('#cf-turnstile')?.remove()
})

test('retries a failed script on remount and clears expired tokens', () => {
  const onVerify = vi.fn()
  const first = render(
    <Turnstile siteKey='public-site-key' onVerify={onVerify} />
  )
  const script = document.querySelector('#cf-turnstile')
  if (!script) throw new Error('Turnstile script was not created')
  fireEvent.error(script)
  expect(onVerify).toHaveBeenLastCalledWith('')
  first.unmount()

  const second = render(
    <Turnstile siteKey='public-site-key' onVerify={onVerify} />
  )
  const retry = document.querySelector('#cf-turnstile')
  if (!retry) throw new Error('Turnstile script was not recreated')
  expect(retry).not.toBe(script)
  const renderWidget = vi.fn(() => 'widget-1')
  const remove = vi.fn()
  window.turnstile = { render: renderWidget, remove }
  fireEvent.load(retry)
  expect(renderWidget).toHaveBeenCalledOnce()
  const options = renderWidget.mock.calls[0] as unknown as [
    HTMLElement,
    Record<string, (value?: string) => void>,
  ]
  act(() => options[1].callback('verified-token'))
  expect(onVerify).toHaveBeenLastCalledWith('verified-token')
  act(() => options[1]['expired-callback']())
  expect(onVerify).toHaveBeenLastCalledWith('')
  second.unmount()
  expect(remove).toHaveBeenCalledWith('widget-1')
})
