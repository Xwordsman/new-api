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
import { once } from 'node:events'
import { createServer } from 'node:http'

import { createRsbuild, loadConfig, type RsbuildInstance } from '@rsbuild/core'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

const upstream = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json')
  response.end(
    JSON.stringify({
      host: request.headers.host,
      origin: request.headers.origin,
      method: request.method,
      url: request.url,
    })
  )
})
let devServer:
  | Awaited<ReturnType<RsbuildInstance['createDevServer']>>
  | undefined
let browserOrigin: string
let upstreamHost: string

beforeAll(async () => {
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const upstreamAddress = upstream.address()
  if (!upstreamAddress || typeof upstreamAddress === 'string') {
    throw new Error('Expected an HTTP upstream address')
  }
  upstreamHost = `127.0.0.1:${upstreamAddress.port}`
  vi.stubEnv('VITE_REACT_APP_SERVER_URL', `http://${upstreamHost}`)
  const cwd = process.cwd()
  const config = await loadConfig({
    cwd,
    envMode: 'development',
    command: 'dev',
  })
  const rsbuild = await createRsbuild({
    cwd,
    config: {
      server: {
        ...config.content.server,
        host: '127.0.0.1',
        port: 0,
        strictPort: true,
        printUrls: false,
      },
      dev: { hmr: false, liveReload: false },
    },
  })
  devServer = await rsbuild.createDevServer({ runCompile: false })
  await devServer.listen()
  const address = devServer.httpServer?.address()
  if (!address || typeof address === 'string') {
    throw new Error('Expected an HTTP development server address')
  }
  browserOrigin = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await devServer?.close()
  if (upstream.listening) {
    const closed = once(upstream, 'close')
    upstream.closeAllConnections()
    upstream.close()
    await closed
  }
  vi.unstubAllEnvs()
})

it.each([
  ['POST', '/api/extensions/email-templates/admin/preview'],
  ['PUT', '/api/extensions/email-templates/admin/settings'],
])(
  'keeps the browser authority for proxied %s %s origin checks',
  async (method, url) => {
    const response = await fetch(`${browserOrigin}${url}`, {
      method,
      headers: { Origin: browserOrigin },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      host: new URL(browserOrigin).host,
      origin: browserOrigin,
      method,
      url,
    })
  }
)

it('preserves an untrusted Origin so the backend can reject cross-site mutations', async () => {
  const response = await fetch(
    `${browserOrigin}/api/extensions/email-templates/admin/preview`,
    {
      method: 'POST',
      headers: { Origin: 'https://untrusted.example' },
    }
  )

  expect(await response.json()).toMatchObject({
    host: new URL(browserOrigin).host,
    origin: 'https://untrusted.example',
  })
})

it('continues using the upstream authority for relay requests', async () => {
  const response = await fetch(`${browserOrigin}/v1/models`, {
    headers: { Origin: browserOrigin },
  })

  expect(await response.json()).toMatchObject({
    host: upstreamHost,
    origin: browserOrigin,
    method: 'GET',
    url: '/v1/models',
  })
})

it('forwards the public AI-readable documentation export to the gateway', async () => {
  const response = await fetch(`${browserOrigin}/llms-full.txt`)

  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    method: 'GET',
    url: '/llms-full.txt',
  })
})
