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
import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'

import { ArtworkPreview, SavedArtwork } from '../components/artwork-preview'

afterEach(() => vi.unstubAllGlobals())

it('renders generated code in an opaque sandbox without exposing a loading prop as text', () => {
  const output =
    '<svg><text>Artwork</text></svg><script>window.test = true</script>'
  const view = render(<ArtworkPreview output={output} paused={false} />)
  const frame = screen.getByTitle('SVG artwork preview')
  expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
  expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
  expect(frame.getAttribute('srcdoc')).toContain("connect-src 'none'")
  expect(frame.getAttribute('srcdoc')).toContain("frame-src 'none'")
  expect(frame.getAttribute('srcdoc')).toContain(output)
  expect(screen.queryByText('lazy')).not.toBeInTheDocument()
  view.rerender(<ArtworkPreview output={output} paused />)
  expect(screen.queryByTitle('SVG artwork preview')).not.toBeInTheDocument()
  expect(screen.getByText('Preview paused')).toBeVisible()
})

it('loads saved artwork only near the viewport and stops the iframe when it leaves or is paused', async () => {
  const observers: {
    callback: IntersectionObserverCallback
    target?: Element
  }[] = []
  class Observer {
    entry: (typeof observers)[number]
    constructor(callback: IntersectionObserverCallback) {
      this.entry = { callback }
      observers.push(this.entry)
    }
    observe(target: Element) {
      this.entry.target = target
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', Observer)
  const client = createAppQueryClient()
  client.setDefaultOptions({ queries: { retry: false, gcTime: 0 } })
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { id: 4, output: '<svg><circle r="10"/></svg>' },
    },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <SavedArtwork id={4} paused={false} />
    </QueryClientProvider>
  )
  expect(get).not.toHaveBeenCalled()
  const observer = observers[0]
  expect(observer.target).toBeDefined()
  act(() =>
    observer.callback(
      [
        { target: observer.target, isIntersecting: true },
      ] as IntersectionObserverEntry[],
      {} as IntersectionObserver
    )
  )
  expect(await screen.findByTitle('SVG artwork preview')).toBeInTheDocument()
  act(() =>
    observer.callback(
      [
        { target: observer.target, isIntersecting: false },
      ] as IntersectionObserverEntry[],
      {} as IntersectionObserver
    )
  )
  await waitFor(() =>
    expect(screen.queryByTitle('SVG artwork preview')).not.toBeInTheDocument()
  )
  view.rerender(
    <QueryClientProvider client={client}>
      <SavedArtwork id={4} paused />
    </QueryClientProvider>
  )
  expect(screen.getByText('Preview paused')).toBeVisible()
  client.clear()
})

it('loads saved artwork when viewport observation is unavailable and still honors pause', async () => {
  vi.stubGlobal('IntersectionObserver', undefined)
  const client = createAppQueryClient()
  client.setDefaultOptions({ queries: { retry: false, gcTime: 0 } })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { id: 5, output: '<svg><circle r="10"/></svg>' },
    },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <SavedArtwork id={5} paused={false} />
    </QueryClientProvider>
  )
  expect(await screen.findByTitle('SVG artwork preview')).toBeInTheDocument()
  view.rerender(
    <QueryClientProvider client={client}>
      <SavedArtwork id={5} paused />
    </QueryClientProvider>
  )
  expect(screen.queryByTitle('SVG artwork preview')).not.toBeInTheDocument()
  expect(screen.getByText('Preview paused')).toBeVisible()
  client.clear()
})
