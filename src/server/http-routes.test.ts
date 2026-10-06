import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { AppContext, Env } from '../../worker'

/**
 * External boundaries only: JWT verification (`verifyJwt`) and the upstream platform
 * api-worker fetch (`apiWorkerFetch`) from 'deepspace/worker'. The Hono app and
 * `registerAuthAndIntegrationRoutes` (the route under test) are real code.
 */
const OWNER_JWT = 'OWNER-JWT-SECRET-VALUE'
const MEMBER_TOKEN = 'member-token'

const upstream = vi.hoisted(() => ({
  apiWorkerFetch: vi.fn(),
  verifyJwt: vi.fn(),
}))

vi.mock('deepspace/worker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('deepspace/worker')>()
  return { ...actual, apiWorkerFetch: upstream.apiWorkerFetch, verifyJwt: upstream.verifyJwt }
})

import { registerAuthAndIntegrationRoutes } from './http-routes'

const ENV = {
  APP_OWNER_JWT: OWNER_JWT,
  APP_IDENTITY_TOKEN: 'app-identity-token',
  DEEPSPACE_APP_ID: 'app-id',
  AUTH_JWT_PUBLIC_KEY: 'pk',
  AUTH_JWT_ISSUER: 'iss',
} as unknown as Env

function build() {
  const app = new Hono<AppContext>()
  registerAuthAndIntegrationRoutes(app)
  return (path: string, init: RequestInit = {}, token?: string) =>
    app.request(
      path,
      {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      ENV,
    )
}

function sentHeaders(): string {
  return JSON.stringify(upstream.apiWorkerFetch.mock.calls.map((c) => c.slice(1)))
}

let globalFetch: ReturnType<typeof vi.fn>

beforeEach(() => {
  upstream.apiWorkerFetch.mockReset()
  upstream.apiWorkerFetch.mockImplementation(async () => new Response('{"ok":true}', { status: 200 }))
  upstream.verifyJwt.mockReset()
  upstream.verifyJwt.mockImplementation(async (_cfg: unknown, token: string) =>
    token === MEMBER_TOKEN ? { result: { userId: 'u-member' } } : { result: null },
  )
  globalFetch = vi.fn(async () => new Response('{}'))
  vi.stubGlobal('fetch', globalFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const REFUSED = [401, 403, 404]

describe('developer-billed integration proxy is closed', () => {
  it('[T-023.1] anonymous POST /api/integrations/anthropic/messages is refused and nothing goes upstream', async () => {
    const call = build()
    const res = await call('/api/integrations/anthropic/messages', { method: 'POST', body: '{"q":1}' })
    expect(REFUSED).toContain(res.status)
    expect(upstream.apiWorkerFetch).not.toHaveBeenCalled()
    expect(globalFetch).not.toHaveBeenCalled()
    expect(sentHeaders()).not.toContain(OWNER_JWT)
  })

  it('[T-023.2] signed-in member POST to a developer-billed integration is also refused, no upstream fetch', async () => {
    const call = build()
    const res = await call(
      '/api/integrations/anthropic/messages',
      { method: 'POST', body: '{"q":1}' },
      MEMBER_TOKEN,
    )
    expect(REFUSED).toContain(res.status)
    expect(upstream.apiWorkerFetch).not.toHaveBeenCalled()
    expect(globalFetch).not.toHaveBeenCalled()
    expect(sentHeaders()).not.toContain(OWNER_JWT)
  })

  it.each([
    ['GET', 'anthropic', 'messages'],
    ['GET', 'totally-made-up-integration', 'whatever'],
    ['POST', 'totally-made-up-integration', 'whatever'],
  ])(
    '[T-023.3] anonymous and member %s /api/integrations/%s/%s are refused, no upstream fetch',
    async (method, name, endpoint) => {
      const call = build()
      const init: RequestInit = method === 'GET' ? { method } : { method, body: '{}' }
      for (const token of [undefined, MEMBER_TOKEN]) {
        const res = await call(`/api/integrations/${name}/${endpoint}`, init, token)
        expect(REFUSED).toContain(res.status)
      }
      expect(upstream.apiWorkerFetch).not.toHaveBeenCalled()
      expect(globalFetch).not.toHaveBeenCalled()
      expect(sentHeaders()).not.toContain(OWNER_JWT)
    },
  )
})

describe('user-billed and catalog integration routes are unchanged', () => {
  it('[T-023.1] google (billing user): anonymous gets 401 and nothing goes upstream', async () => {
    const call = build()
    const res = await call('/api/integrations/google/gmail-list', { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
    expect(upstream.apiWorkerFetch).not.toHaveBeenCalled()
  })

  it('[T-023.1] google (billing user): signed-in caller is forwarded with their own bearer, never the owner JWT', async () => {
    const call = build()
    const res = await call('/api/integrations/google/gmail-list', { method: 'POST', body: '{}' }, MEMBER_TOKEN)
    expect(res.status).toBe(200)
    expect(upstream.apiWorkerFetch).toHaveBeenCalledTimes(1)
    const [, target, init] = upstream.apiWorkerFetch.mock.calls[0] as [
      unknown,
      string,
      { headers: Record<string, string> },
    ]
    expect(target).toBe('/api/integrations/google/gmail-list')
    expect(init.headers.Authorization).toBe(`Bearer ${MEMBER_TOKEN}`)
    expect(sentHeaders()).not.toContain(OWNER_JWT)
  })

  it('[T-023.1] catalog GET /api/integrations still forwards upstream (not a paid call)', async () => {
    const call = build()
    const res = await call('/api/integrations', { method: 'GET' })
    expect(res.status).toBe(200)
    expect(upstream.apiWorkerFetch).toHaveBeenCalledTimes(1)
    expect(upstream.apiWorkerFetch.mock.calls[0]?.[1]).toBe('/api/integrations')
  })
})
