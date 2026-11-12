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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it } from 'vitest'

import { useTopNavLinks } from '../use-top-nav-links'

afterEach(cleanup)

it('switches between local and configured external documentation when the plugin changes', () => {
  const client = new QueryClient()
  const status = { docs_link: 'https://docs.example.test' }
  client.setQueryData(['status'], {
    ...status,
    extension_features: { documentation: true },
  })
  function Wrapper(props: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {props.children}
      </QueryClientProvider>
    )
  }
  const { result, rerender } = renderHook(useTopNavLinks, { wrapper: Wrapper })
  expect(result.current.find((link) => link.href === '/docs')).toMatchObject({
    external: false,
  })

  act(() => {
    client.setQueryData(['status'], {
      ...status,
      extension_features: { documentation: false },
    })
  })
  rerender()
  expect(result.current.some((link) => link.href === '/docs')).toBe(false)
  expect(
    result.current.find((link) => link.href === status.docs_link)
  ).toMatchObject({ external: true })
  client.clear()
})

it.each([
  { docs_link: '', extension_features: { documentation: false } },
  { docs_link: '/docs', extension_features: { documentation: false } },
  {
    docs_link: 'javascript:alert(1)',
    extension_features: { documentation: false },
  },
  {
    docs_link: 'https://docs.example.test',
    extension_features: { documentation: true },
    HeaderNavModules: '{"docs":false}',
  },
])(
  'omits unavailable or explicitly hidden documentation navigation: %j',
  (status) => {
    const client = new QueryClient()
    client.setQueryData(['status'], status)
    function Wrapper(props: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>
          {props.children}
        </QueryClientProvider>
      )
    }
    const { result } = renderHook(useTopNavLinks, { wrapper: Wrapper })
    expect(result.current.map((link) => link.href)).toEqual([
      '/',
      '/dashboard',
      '/pricing',
      '/rankings',
      '/about',
    ])
    client.clear()
  }
)
