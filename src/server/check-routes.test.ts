import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { RECORD_NOT_FOUND } from 'deepspace/worker'
import type { ActionResult } from 'deepspace/worker'
import type { AppContext, Env } from '../../worker'
import { CONFIG } from '../engine/config'
import { VerifyJobPayload } from '../engine/contracts'
import { versionId as deriveVersionId } from '../engine/ids'
import { registerCheckRoutes } from './check-routes'
import type { CheckRouteDeps } from './check-routes'

const ENV = { marker: 'test-env' } as unknown as Env
const NOW = new Date('2026-10-05T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const BODY = 'DeepSpace apps run on Cloudflare Workers. Deploys take one command.'
const OWNER = 'u-owner'
const COLLAB = 'u-collab'
const STRANGER = 'u-stranger'
const ADMIN = 'u-admin'
const ROLES: Record<string, string> = { [OWNER]: 'member', [COLLAB]: 'member', [STRANGER]: 'member', [ADMIN]: 'admin', 'u-viewer': 'viewer' }

type Data = Record<string, unknown>
type Tools = ReturnType<CheckRouteDeps['records']>

/**
 * In-memory ActionTools subset. `create` on a known id upserts (merges), as the platform does. A missing `get` returns the
 * platform's exact RECORD_NOT_FOUND string. `query` without `limit` is unbounded (ActionTools applies no default).
 */
class FakeRecords {
  readonly store = new Map<string, Map<string, { data: Data; createdBy: string }>>()
  log: string[] = []
  failCreate = false
  /** Every create/update after this is set fails (`fail`) or throws (`throw`). */
  writeMode: 'fail' | 'throw' | null = null
  /** `${collection}/${id}` -> error string returned by get for that row (infrastructure failure). */
  getErrors = new Map<string, string>()
  private col(c: string) {
    let m = this.store.get(c)
    if (!m) this.store.set(c, (m = new Map()))
    return m
  }
  seed(c: string, id: string, data: Data, createdBy = 'system'): void {
    this.col(c).set(id, { data: { ...data }, createdBy })
  }
  row(c: string, id: string): Data | undefined {
    return this.col(c).get(id)?.data
  }
  rows(c: string): Data[] {
    return [...this.col(c).values()].map((r) => r.data)
  }
  private env(c: string, id: string) {
    const r = this.col(c).get(id)!
    return { recordId: id, data: r.data, createdBy: r.createdBy, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }
  }
  get = (async (c: string, id: string) => {
    this.log.push(`get:${c}`)
    const infra = this.getErrors.get(`${c}/${id}`)
    if (infra) return { success: false, error: infra }
    return this.col(c).has(id) ? { success: true, data: { record: this.env(c, id) } } : { success: false, error: RECORD_NOT_FOUND }
  }) as unknown as Tools['get']
  query = (async (c: string, o?: { where?: Data; orderBy?: string; orderDir?: 'asc' | 'desc'; limit?: number }) => {
    this.log.push(`query:${c}`)
    let ids = [...this.col(c).keys()].filter((id) => Object.entries(o?.where ?? {}).every(([k, v]) => this.col(c).get(id)!.data[k] === v))
    if (o?.orderBy) {
      const key = o.orderBy
      const dir = o.orderDir === 'desc' ? -1 : 1
      ids = ids.sort((a, b) => dir * String(this.col(c).get(a)!.data[key]).localeCompare(String(this.col(c).get(b)!.data[key])))
    }
    ids = ids.slice(0, o?.limit)
    return { success: true, data: { records: ids.map((id) => this.env(c, id)), count: ids.length } }
  }) as unknown as Tools['query']
  create = (async (c: string, data: Data, id?: string): Promise<ActionResult<{ recordId: string }>> => {
    this.log.push(`create:${c}`)
    if (this.writeMode === 'throw') throw new Error('storage exploded')
    if (this.writeMode === 'fail') return { success: false, error: 'disk on fire' }
    if (this.failCreate) return { success: false, error: 'disk on fire' }
    const recordId = id ?? `gen-${this.col(c).size + 1}`
    const prev = this.col(c).get(recordId)
    this.col(c).set(recordId, { data: { ...prev?.data, ...data }, createdBy: prev?.createdBy ?? 'system' })
    return { success: true, data: { recordId } }
  }) as unknown as Tools['create']
  update = (async (c: string, id: string, patch: Data): Promise<ActionResult<{ recordId: string }>> => {
    this.log.push(`update:${c}`)
    if (this.writeMode === 'throw') throw new Error('storage exploded')
    if (this.writeMode === 'fail') return { success: false, error: 'disk on fire' }
    const r = this.col(c).get(id)
    if (!r) return { success: false, error: 'Record not found' }
    r.data = { ...r.data, ...patch }
    return { success: true, data: { recordId: id } }
  }) as unknown as Tools['update']
}

interface Snapshot { status: unknown; jobId: unknown; body: unknown }
let records: FakeRecords
let enqueue: ReturnType<typeof vi.fn<CheckRouteDeps['enqueue']>>
let atEnqueue: Snapshot[]
let enqueueError: Error | null
let failedWriteMode: FakeRecords['writeMode']
let auth: { userId: string } | null
let resolveRole: ReturnType<typeof vi.fn<CheckRouteDeps['resolveRole']>>
let app: Hono<AppContext>
let clock: Date
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

const vid = (body = BODY, kb = 0) => deriveVersionId('d1', body, kb)
const draft = (over: Data = {}) => ({ title: 't', channel: 'blog', body: BODY, collaborators: [COLLAB], latestVersionId: '', ...over })
const post = (init?: RequestInit, id = 'd1') => app.request(`/api/drafts/${id}/check`, { method: 'POST', ...init }, ENV)
const as = (userId: string | null) => { auth = userId === null ? null : { userId } }
const noWrites = () => expect(records.log.filter((l) => /^(create|update):/.test(l))).toEqual([])
const priorChecks = (n: number, userId: string, ageMs: number) => {
  for (let i = 0; i < n; i++) records.seed('draft_versions', `old-${userId}-${ageMs}-${i}`, { draftId: 'other', requestedBy: userId, requestedAt: new Date(NOW.getTime() - ageMs - i).toISOString(), status: 'checked' })
}

beforeEach(() => {
  records = new FakeRecords()
  records.seed('drafts', 'd1', draft(), OWNER)
  atEnqueue = []
  enqueueError = null
  failedWriteMode = null
  clock = NOW
  auth = { userId: OWNER }
  resolveRole = vi.fn<CheckRouteDeps['resolveRole']>(async (_e, u) => ROLES[u] ?? null)
  enqueue = vi.fn<CheckRouteDeps['enqueue']>(async (_env, _type, payload) => {
    const v = records.row('draft_versions', (payload as { versionId: string }).versionId)
    atEnqueue.push({ status: v?.status, jobId: v?.jobId, body: v?.body })
    records.log.push('enqueue')
    if (enqueueError) {
      records.writeMode = failedWriteMode
      throw enqueueError
    }
    return `job-${enqueue.mock.calls.length}`
  })
  app = new Hono<AppContext>()
  registerCheckRoutes(app, {
    resolveAuth: async () => auth,
    resolveRole,
    records: () => records as unknown as Tools,
    enqueue,
    now: () => clock,
  })
})

describe('auth, role and ownership (T-006.1)', () => {
  it('[T-006.1] anonymous caller gets 401 before any read, write or enqueue', async () => {
    as(null)
    const res = await post()
    expect(res.status).toBe(401)
    expect(records.log).toEqual([])
    expect(enqueue).not.toHaveBeenCalled()
    expect(resolveRole).not.toHaveBeenCalled()
  })

  it.each([['u-viewer'], ['u-unknown']])('[T-006.1] a caller whose role is not member/admin (%s) gets 403 before any record read', async (u) => {
    as(u)
    expect((await post()).status).toBe(403)
    expect(records.log).toEqual([])
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('[T-006.1] a non-collaborator member gets 404 with the same body as a missing draft, and nothing is written or enqueued', async () => {
    as(STRANGER)
    const hidden = await post()
    const missing = await post(undefined, 'nope')
    expect(hidden.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(await hidden.json()).toEqual(await missing.json())
    noWrites()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('[T-006.1] the draft owner, a collaborator (array or JSON string) and an admin may check; each gets 202', async () => {
    for (const u of [OWNER, COLLAB, ADMIN]) {
      as(u)
      records.store.delete('draft_versions')
      expect((await post()).status).toBe(202)
    }
    records.seed('drafts', 'd2', draft({ collaborators: JSON.stringify([COLLAB]) }), OWNER)
    as(COLLAB)
    expect((await post(undefined, 'd2')).status).toBe(202)
    expect(enqueue).toHaveBeenCalledTimes(4)
  })

  it('[T-006.1] a body over maxBodyChars gets 413 with no version and no job; exactly maxBodyChars is accepted', async () => {
    records.seed('drafts', 'd1', draft({ body: 'x'.repeat(CONFIG.limits.maxBodyChars + 1) }), OWNER)
    expect((await post()).status).toBe(413)
    noWrites()
    expect(enqueue).not.toHaveBeenCalled()
    records.seed('drafts', 'd1', draft({ body: 'x'.repeat(CONFIG.limits.maxBodyChars) }), OWNER)
    expect((await post()).status).toBe(202)
  })

  it('[T-006.1] ownership is checked before size: a stranger hitting an oversized draft still gets 404, not 413', async () => {
    records.seed('drafts', 'd1', draft({ body: 'x'.repeat(CONFIG.limits.maxBodyChars + 1) }), OWNER)
    as(STRANGER)
    expect((await post()).status).toBe(404)
  })

  it('[T-006.1] only POST is routed', async () => {
    const res = await app.request('/api/drafts/d1/check', { method: 'GET' }, ENV)
    expect(res.status).toBe(404)
    expect(enqueue).not.toHaveBeenCalled()
  })
})

describe('quota (T-006.2)', () => {
  const limit = CONFIG.limits.checksPerUserPerDay

  it('[T-006.2] the 20th check in 24h is allowed and the 21st gets 429 with nothing created or enqueued', async () => {
    for (let i = 1; i <= limit; i++) {
      records.seed('drafts', 'd1', draft({ body: `${BODY} edit ${i}` }), OWNER)
      expect((await post()).status, `check ${i}`).toBe(202)
    }
    records.seed('drafts', 'd1', draft({ body: `${BODY} edit ${limit + 1}` }), OWNER)
    const calls = enqueue.mock.calls.length
    const before = records.rows('draft_versions').length
    const res = await post()
    expect(res.status).toBe(429)
    expect(enqueue.mock.calls.length).toBe(calls)
    expect(records.rows('draft_versions')).toHaveLength(before)
    expect(JSON.stringify(await res.json())).not.toContain('jobId')
  })

  it('[T-006.2] another user is unaffected by the first user being over quota', async () => {
    priorChecks(limit, OWNER, 1000)
    as(OWNER)
    expect((await post()).status).toBe(429)
    as(COLLAB)
    expect((await post()).status).toBe(202)
    priorChecks(limit, STRANGER, 1000) // someone else's rows never count against the caller
    as(ADMIN)
    expect((await post()).status).toBe(202)
  })

  it('[T-006.2] checks older than 24h do not count', async () => {
    priorChecks(limit, OWNER, DAY + 60_000)
    expect((await post()).status).toBe(202)
  })

  it('[T-006.2] a long history does not hide recent checks: the newest rows must be fetched first when the query is limited', async () => {
    priorChecks(60, OWNER, 3 * DAY) // oldest-first insertion order: a limited query without newest-first ordering sees only these
    priorChecks(limit, OWNER, 1000)
    const res = await post()
    expect(res.status).toBe(429)
    expect(enqueue).not.toHaveBeenCalled()
  })
})

describe('idempotency (T-006.3)', () => {
  const row = (status: string, over: Data = {}) => ({ draftId: 'd1', body: BODY, bodyHash: 'h', kbVersion: 3, status, requestedBy: OWNER, requestedAt: NOW.toISOString(), mode: 'full', jobId: 'job-existing', ...over })
  beforeEach(async () => {
    records.seed('kb_state', 'global', { version: 3 })
  })

  it('[T-006.3] unchanged body and kbVersion with a checked version returns 200 cached:true, with no create, update or enqueue', async () => {
    const id = await vid(BODY, 3)
    records.seed('draft_versions', id, row('checked'))
    const res = await post()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ versionId: id, cached: true })
    noWrites()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('[T-006.3] a running (checking) version returns 202 with the stored jobId and starts nothing', async () => {
    const id = await vid(BODY, 3)
    records.seed('draft_versions', id, row('checking'))
    const res = await post()
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ versionId: id, jobId: 'job-existing' })
    noWrites()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('[T-006.3] cached and running results are served before the quota check, to any collaborator', async () => {
    const id = await vid(BODY, 3)
    records.seed('draft_versions', id, row('checked', { requestedBy: OWNER }))
    priorChecks(CONFIG.limits.checksPerUserPerDay, COLLAB, 1000)
    as(COLLAB)
    expect((await post()).status).toBe(200)
    records.seed('draft_versions', id, row('checking'))
    expect((await post()).status).toBe(202)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('[T-006.3] a changed body or a changed kbVersion derives a new versionId and enqueues a new job', async () => {
    records.seed('draft_versions', await vid(BODY, 3), row('checked'))
    records.seed('drafts', 'd1', draft({ body: `${BODY} Edited.` }), OWNER)
    const edited = await post()
    expect(edited.status).toBe(202)
    expect((await edited.json() as { versionId: string }).versionId).toBe(await vid(`${BODY} Edited.`, 3))
    records.seed('drafts', 'd1', draft(), OWNER)
    records.seed('kb_state', 'global', { version: 4 })
    const bumped = await post()
    expect((await bumped.json() as { versionId: string }).versionId).toBe(await vid(BODY, 4))
    expect(enqueue).toHaveBeenCalledTimes(2)
  })

  it('[T-006.3] a missing kb_state row means kbVersion 0', async () => {
    records.store.delete('kb_state')
    const res = await post()
    expect(res.status).toBe(202)
    const id = await vid(BODY, 0)
    expect(await res.json()).toEqual({ jobId: 'job-1', versionId: id })
    expect(records.row('draft_versions', id)?.kbVersion).toBe(0)
  })

  it('[T-006.3] a failed version is re-run: it goes back to checking with a new job, and the quota still applies to it', async () => {
    const id = await vid(BODY, 3)
    records.seed('draft_versions', id, row('failed', { jobId: 'job-dead', requestedAt: ago(CONFIG.job.failedRetryCooldownMs + 1) }))
    const res = await post()
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ jobId: 'job-1', versionId: id })
    expect(records.row('draft_versions', id)).toMatchObject({ status: 'checking', jobId: 'job-1', body: BODY })
    expect(records.rows('draft_versions')).toHaveLength(1)

    records.seed('draft_versions', id, row('failed', { requestedAt: ago(CONFIG.job.failedRetryCooldownMs + 1) }))
    priorChecks(CONFIG.limits.checksPerUserPerDay, OWNER, 1000)
    expect((await post()).status).toBe(429)
  })
})

describe('stale checking, failed cooldown, infrastructure errors', () => {
  const row = (status: string, over: Data = {}) => ({ draftId: 'd1', body: BODY, bodyHash: 'h', kbVersion: 0, status, requestedBy: OWNER, requestedAt: NOW.toISOString(), mode: 'full', jobId: 'job-existing', ...over })
  const staleAt = () => ago(CONFIG.job.checkingStaleMs + 1) // lazy: a missing tunable fails the test, not collection

  it.each([['older than checkingStaleMs', () => ({ requestedAt: staleAt() })], ['missing requestedAt', () => ({ requestedAt: undefined })], ['unparseable requestedAt', () => ({ requestedAt: 'garbage' })]])(
    '[T-006.3] a checking version with %s is no longer treated as running: it re-runs with a fresh requestedAt and the new jobId',
    async (_name, mkOver) => {
      const id = await vid(BODY, 0)
      records.seed('draft_versions', id, row('checking', mkOver()))
      const res = await post()
      expect(res.status).toBe(202)
      expect(await res.json()).toEqual({ jobId: 'job-1', versionId: id })
      expect(enqueue).toHaveBeenCalledTimes(1)
      expect(records.rows('draft_versions')).toHaveLength(1)
      expect(records.row('draft_versions', id)).toMatchObject({ status: 'checking', requestedAt: NOW.toISOString(), jobId: 'job-1', body: BODY })
    },
  )

  it('[T-006.3] a checking version younger than checkingStaleMs is still returned as running', async () => {
    const id = await vid(BODY, 0)
    records.seed('draft_versions', id, row('checking', { requestedAt: ago(CONFIG.job.checkingStaleMs - 1000) }))
    const res = await post()
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ versionId: id, jobId: 'job-existing' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('[T-006.2] a stale checking version goes through the quota check: over quota gets 429 and nothing is written or enqueued', async () => {
    records.seed('draft_versions', await vid(BODY, 0), row('checking', { requestedAt: staleAt() }))
    priorChecks(CONFIG.limits.checksPerUserPerDay, OWNER, 1000)
    expect((await post()).status).toBe(429)
    noWrites()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('[T-006.2] a failed version inside the retry cooldown gets 429 with nothing written or enqueued; after the cooldown it re-runs', async () => {
    const id = await vid(BODY, 0)
    records.seed('draft_versions', id, row('failed', { requestedAt: ago(CONFIG.job.failedRetryCooldownMs - 1000) }))
    expect((await post()).status).toBe(429)
    noWrites()
    expect(enqueue).not.toHaveBeenCalled()
    expect(records.row('draft_versions', id)?.status).toBe('failed')
    clock = new Date(NOW.getTime() + 2000)
    expect((await post()).status).toBe(202)
    expect(records.row('draft_versions', id)?.status).toBe('checking')
  })

  it('[T-006.1] the missing-record error is the platform contract string', () => {
    expect(RECORD_NOT_FOUND).toBe('Record not found')
  })

  it('[T-006.1] a drafts read that fails for a reason other than not-found is 503, not 404, and nothing is written or enqueued', async () => {
    records.getErrors.set('drafts/d1', 'Internal error: storage unavailable')
    const res = await post()
    expect(res.status).toBe(503)
    noWrites()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('[T-006.3] a kb_state read that fails for a reason other than not-found is 503 and nothing is written or enqueued', async () => {
    records.seed('kb_state', 'global', { version: 3 })
    records.getErrors.set('kb_state/global', 'Internal error: storage unavailable')
    const res = await post()
    expect(res.status).toBe(503)
    noWrites()
    expect(enqueue).not.toHaveBeenCalled()
  })
})

describe('what gets enqueued (T-006.4)', () => {
  it('[T-006.4] creates the checking version (id = versionId) BEFORE enqueueing exactly one verify-draft job, then stores and returns the jobId', async () => {
    records.seed('kb_state', 'global', { version: 2 })
    const res = await post()
    const id = await vid(BODY, 2)
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ jobId: 'job-1', versionId: id })
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith(ENV, 'verify-draft', { draftId: 'd1', versionId: id, mode: 'full' }, { maxAttempts: CONFIG.job.verifyMaxAttempts, enqueuedBy: OWNER })
    expect(atEnqueue[0]).toMatchObject({ status: 'checking', body: BODY })
    expect(records.row('draft_versions', id)).toMatchObject({
      draftId: 'd1', body: BODY, kbVersion: 2, status: 'checking', requestedBy: OWNER, requestedAt: NOW.toISOString(), mode: 'full', jobId: 'job-1',
    })
    expect(typeof records.row('draft_versions', id)?.bodyHash).toBe('string')
    expect(records.log.indexOf('enqueue')).toBeGreaterThan(records.log.indexOf('create:draft_versions'))
  })

  it('[T-006.4] the payload has exactly draftId, versionId, mode and parses with VerifyJobPayload', async () => {
    await post()
    const payload = enqueue.mock.calls[0][2]
    expect(Object.keys(payload as object).sort()).toEqual(['draftId', 'mode', 'versionId'])
    expect(VerifyJobPayload.safeParse(payload).success).toBe(true)
  })

  it('[T-006.4] the request body is never used: type, payload, versionId, mode, body and maxAttempts from the client change nothing', async () => {
    const res = await post({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'sync-sources', body: 'attacker text', versionId: 'forged', mode: 'reverify', draftId: 'other', maxAttempts: 99, enqueuedBy: 'someone-else', changedPages: ['x'] }),
    })
    const id = await vid(BODY, 0)
    expect(res.status).toBe(202)
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith(ENV, 'verify-draft', { draftId: 'd1', versionId: id, mode: 'full' }, { maxAttempts: CONFIG.job.verifyMaxAttempts, enqueuedBy: OWNER })
    expect(records.row('draft_versions', id)?.body).toBe(BODY)
    expect(records.row('draft_versions', 'forged')).toBeUndefined()
  })

  it('[T-006.4] a malformed JSON body does not break a valid request', async () => {
    const res = await post({ headers: { 'content-type': 'application/json' }, body: '{not json' })
    expect(res.status).toBe(202)
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  it('[T-006.4] if enqueue throws the response is not 2xx and the version ends failed (not stuck checking); a later request can retry', async () => {
    enqueueError = new Error('JobRoom down')
    const res = await post()
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(records.rows('draft_versions').map((v) => v.status)).toEqual(['failed'])

    enqueueError = null
    expect((await post()).status).toBe(429) // inside the failed-retry cooldown
    clock = new Date(NOW.getTime() + CONFIG.job.failedRetryCooldownMs + 1)
    expect((await post()).status).toBe(202)
    expect(records.rows('draft_versions').map((v) => v.status)).toEqual(['checking'])
  })

  it('[T-006.4] if the version cannot be written nothing is enqueued and the response is not 2xx', async () => {
    records.failCreate = true
    const res = await post()
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it.each([['fail'], ['throw']] as const)('[T-006.4] if enqueue throws and the failed-status write then %ss, the response is still a JSON 5xx', async (mode) => {
    enqueueError = new Error('JobRoom down')
    failedWriteMode = mode
    const res = await post()
    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(res.status).toBeLessThan(600)
    expect(res.headers.get('content-type') ?? '').toMatch(/json/)
    expect(typeof (await res.json())).toBe('object')
  })
})
