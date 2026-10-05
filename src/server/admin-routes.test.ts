import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { AppContext, Env } from '../../worker'
import { registerAdminRoutes } from './admin-routes'
import type { AdminRouteDeps } from './admin-routes'

const ENV = { marker: 'test-env' } as unknown as Env

interface Setup {
  auth: { userId: string } | null
  role: string | null
  enqueueError?: Error
}

/**
 * The three deps are external boundaries (JWT verification, platform role lookup, JobRoom DO),
 * so they are faked. The Hono app and the route registration are the real code under test.
 */
function build({ auth, role, enqueueError }: Setup) {
  const resolveAuth = vi.fn<AdminRouteDeps['resolveAuth']>(async () => auth)
  const resolveRole = vi.fn<AdminRouteDeps['resolveRole']>(async () => role)
  const enqueue = vi.fn<AdminRouteDeps['enqueue']>(async () => {
    if (enqueueError) throw enqueueError
    return 'job-123'
  })
  const app = new Hono<AppContext>()
  registerAdminRoutes(app, { resolveAuth, resolveRole, enqueue })
  const post = (init?: RequestInit) => app.request('/api/admin/sync', { method: 'POST', ...init }, ENV)
  return { app, post, resolveAuth, resolveRole, enqueue }
}

describe('POST /api/admin/sync', () => {
  it('[T-004.5] anonymous caller gets 401 and nothing is enqueued', async () => {
    const t = build({ auth: null, role: 'admin' })
    const res = await t.post()
    expect(res.status).toBe(401)
    expect(t.enqueue).not.toHaveBeenCalled()
    expect(t.resolveRole).not.toHaveBeenCalled()
    expect(JSON.stringify(await res.json())).not.toContain('jobId')
  })

  it('[T-004.5] member gets 403 and nothing is enqueued', async () => {
    const t = build({ auth: { userId: 'u-member' }, role: 'member' })
    const res = await t.post()
    expect(res.status).toBe(403)
    expect(t.enqueue).not.toHaveBeenCalled()
    expect(JSON.stringify(await res.json())).not.toContain('jobId')
  })

  it.each([['viewer'], [null], ['']])('[T-004.5] role %j is refused with 403', async (role) => {
    const t = build({ auth: { userId: 'u-x' }, role })
    const res = await t.post()
    expect(res.status).toBe(403)
    expect(t.enqueue).not.toHaveBeenCalled()
  })

  it('[T-004.5] resolves the role for the verified caller id, using the request and env', async () => {
    const t = build({ auth: { userId: 'u-admin' }, role: 'admin' })
    await t.post()
    expect(t.resolveAuth).toHaveBeenCalledTimes(1)
    expect(t.resolveAuth.mock.calls[0]?.[0]).toBeInstanceOf(Request)
    expect(t.resolveAuth.mock.calls[0]?.[1]).toBe(ENV)
    expect(t.resolveRole).toHaveBeenCalledWith(ENV, 'u-admin')
  })

  it('[T-004.5] admin gets 202 with the job id and exactly one sync-sources job is enqueued', async () => {
    const t = build({ auth: { userId: 'u-admin' }, role: 'admin' })
    const res = await t.post()
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ jobId: 'job-123' })
    expect(t.enqueue).toHaveBeenCalledTimes(1)
    expect(t.enqueue).toHaveBeenCalledWith(ENV, 'sync-sources', { reverify: true }, { enqueuedBy: 'u-admin' })
  })

  it('[T-004.5] ignores any request body: job type and payload cannot be chosen by the caller', async () => {
    const t = build({ auth: { userId: 'u-admin' }, role: 'admin' })
    const res = await t.post({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'verify-draft', reverify: false, payload: { draftId: 'x' }, enqueuedBy: 'someone-else' }),
    })
    expect(res.status).toBe(202)
    expect(t.enqueue).toHaveBeenCalledTimes(1)
    expect(t.enqueue).toHaveBeenCalledWith(ENV, 'sync-sources', { reverify: true }, { enqueuedBy: 'u-admin' })
  })

  it('[T-004.5] a malformed JSON body does not break an admin request', async () => {
    const t = build({ auth: { userId: 'u-admin' }, role: 'admin' })
    const res = await t.post({ headers: { 'content-type': 'application/json' }, body: '{not json' })
    expect(res.status).toBe(202)
    expect(t.enqueue).toHaveBeenCalledTimes(1)
  })

  it('[T-004.5] does not report success when the job cannot be enqueued', async () => {
    const t = build({ auth: { userId: 'u-admin' }, role: 'admin', enqueueError: new Error('JobRoom down') })
    const res = await t.post()
    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(res.status).toBeLessThan(600)
  })

  it('[T-004.5] only POST is routed', async () => {
    const t = build({ auth: { userId: 'u-admin' }, role: 'admin' })
    const res = await t.app.request('/api/admin/sync', { method: 'GET' }, ENV)
    expect(res.status).toBe(404)
    expect(t.enqueue).not.toHaveBeenCalled()
  })
})
