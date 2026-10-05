import { beforeEach, describe, expect, it } from 'vitest'
import { RECORD_NOT_FOUND } from 'deepspace/worker'
import type { ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { schemas } from '../schemas'
// The ONLY import of the code under test. SPEC §1/§7: action 'publishDraft' is registered in src/actions/index.ts.
import { actions } from './index'

const OWNER = 'u-owner'
const COLLAB = 'u-collab'
const STRANGER = 'u-stranger'
const KB = 4
const BODY = 'DeepSpace apps run on Cloudflare Workers. Deploys take one command.'
const URL_OK = 'https://example.com/blog/launch'
const EMAIL = 'owner-secret@example.com'

type Data = Record<string, unknown>
type Row = { data: Data; createdBy: string }

/** In-memory ActionTools (records boundary only). Equality `where`; `create` with a given id upserts. */
class FakeRecords {
  store = new Map<string, Map<string, Row>>()
  private col(c: string) {
    let m = this.store.get(c)
    if (!m) this.store.set(c, (m = new Map()))
    return m
  }
  seed(c: string, id: string, data: Data, createdBy = 'system') {
    this.col(c).set(id, { data: { ...data }, createdBy })
  }
  rows(c: string) {
    return [...this.col(c).entries()].map(([id, r]) => ({ id, ...r.data }))
  }
  private env(c: string, id: string) {
    const r = this.col(c).get(id)!
    return { recordId: id, data: r.data, createdBy: r.createdBy, createdAt: 't', updatedAt: 't' }
  }
  get = async (c: string, id: string) =>
    this.col(c).has(id) ? { success: true, data: { record: this.env(c, id) } } : { success: false, error: RECORD_NOT_FOUND }
  query = async (c: string, o?: { where?: Data; limit?: number }) => {
    const ids = [...this.col(c).keys()]
      .filter((id) => Object.entries(o?.where ?? {}).every(([k, v]) => this.col(c).get(id)!.data[k] === v))
      .slice(0, o?.limit)
    return { success: true, data: { records: ids.map((id) => this.env(c, id)), count: ids.length } }
  }
  create = async (c: string, data: Data, id?: string) => {
    const recordId = id ?? `gen-${this.col(c).size + 1}`
    this.col(c).set(recordId, { data: { ...this.col(c).get(recordId)?.data, ...data }, createdBy: 'system' })
    return { success: true, data: { recordId } }
  }
  update = async (c: string, id: string, patch: Data) => {
    const r = this.col(c).get(id)
    if (!r) return { success: false, error: 'Record not found' }
    r.data = { ...r.data, ...patch }
    return { success: true, data: { recordId: id } }
  }
}

let records: FakeRecords

type Verdict = 'supported' | 'contradicted' | 'unsupported'
const claim = (id: string, verdict: Verdict, versionId = 'v1') =>
  records.seed('claims', id, { versionId, draftId: 'd1', claimHash: `h-${id}`, text: `claim ${id} text`, quote: 'q', span: [0, 3], kind: 'capability', verdict, confidence: 'high', evidence: [], reason: 'r' })
const signoff = (claimId: string, decision: 'approve' | 'cut', versionId = 'v1') =>
  records.seed('signoffs', `s-${claimId}-${decision}`, { claimId, versionId, reviewerId: 'u-admin', decision, note: 'n' })
const version = (over: Data = {}) =>
  records.seed('draft_versions', 'v1', { draftId: 'd1', body: BODY, bodyHash: 'h', kbVersion: KB, status: 'checked', requestedBy: OWNER, requestedAt: '2026-10-05T00:00:00.000Z', mode: 'full', jobId: 'j1', ...over })

beforeEach(() => {
  records = new FakeRecords()
  records.seed('drafts', 'd1', { title: 't', channel: 'blog', body: BODY, collaborators: [COLLAB], latestVersionId: 'v1' }, OWNER)
  records.seed('kb_state', 'global', { version: KB, lastSyncAt: 't', lastChangedPages: [] })
  records.seed('users', OWNER, { name: 'Olivia Owner', email: EMAIL, role: 'member' })
  records.seed('users', STRANGER, { name: 'Sam Stranger', email: 'stranger-secret@example.com', role: 'member' })
  version()
})

/** Calls the registered action exactly as `/api/actions/publishDraft` does. */
async function publish(userId: string, params: Data = {}): Promise<ActionResult> {
  const fn = actions.publishDraft
  if (!fn) throw new Error('actions.publishDraft is not registered in src/actions/index.ts')
  return fn({ userId, params: { draftId: 'd1', versionId: 'v1', url: URL_OK, ...params }, tools: records as unknown as ActionTools, env: {} as Env, callerJwt: 'jwt' })
}
// SPEC §7 says `{ok,...}` but the SDK's ActionResult is `{success,data}`. Accept the payload either flat or under `data`.
const payload = (r: ActionResult): Data => ((r as { data?: Data }).data ?? r) as Data
const refused = (r: ActionResult) => (r as { success?: boolean }).success === false || payload(r).ok === false
const noPublications = () => expect(records.rows('publications')).toEqual([])

describe('publishDraft gate (server-side shipReady)', () => {
  const blockedCases: Array<[string, () => void, string[]]> = [
    ['a contradicted claim with no sign-off', () => claim('c1', 'contradicted'), ['c1']],
    ['an unsupported claim with no sign-off', () => claim('c1', 'unsupported'), ['c1']],
    ['a contradicted claim whose only sign-off is a cut', () => (claim('c1', 'contradicted'), signoff('c1', 'cut')), ['c1']],
    ['a contradicted claim whose approve belongs to another version', () => (claim('c1', 'contradicted'), signoff('c1', 'approve', 'v-other')), ['c1']],
  ]
  it.each(blockedCases)('[T-014.1] refuses with %s, blocking lists the claim ids, creates no row', async (_n, setup, blocking) => {
    setup()
    claim('c2', 'supported')
    const r = await publish(OWNER)
    expect(payload(r)).toMatchObject({ ok: false, reason: 'not_ship_ready' })
    expect([...(payload(r).blocking as string[])].sort()).toEqual(blocking)
    noPublications()
  })

  it('[T-014.1] blocking contains only the claims still unapproved', async () => {
    claim('c1', 'contradicted')
    claim('c2', 'unsupported')
    signoff('c1', 'approve')
    const r = await publish(OWNER)
    expect(payload(r)).toMatchObject({ ok: false, reason: 'not_ship_ready', blocking: ['c2'] })
    noPublications()
  })

  const versionCases: Array<[string, () => void]> = [
    ['the version was checked against an older kbVersion', () => version({ kbVersion: KB - 1 })],
    ['the version is still checking', () => version({ status: 'checking' })],
    ['the version failed', () => version({ status: 'failed' })],
    ['the draft body was edited after the checked version', () => records.seed('drafts', 'd1', { title: 't', channel: 'blog', body: `${BODY} Edited.`, collaborators: [COLLAB], latestVersionId: 'v1' }, OWNER)],
  ]
  it.each(versionCases)('[T-014.1] refuses when %s, creates no row', async (_n, setup) => {
    claim('c1', 'supported')
    setup()
    const r = await publish(OWNER)
    expect(payload(r)).toMatchObject({ ok: false, reason: 'not_ship_ready' })
    expect(Array.isArray(payload(r).blocking)).toBe(true)
    noPublications()
  })

  it('[T-014.1] a forged client flag does not bypass the gate', async () => {
    claim('c1', 'contradicted')
    const r = await publish(OWNER, { shipReady: true, ok: true, force: true, status: 'live', kbVersionAtPublish: KB })
    expect(payload(r)).toMatchObject({ ok: false, reason: 'not_ship_ready', blocking: ['c1'] })
    noPublications()
  })

  it('[T-014.1] re-reads the kb version server-side: a client-supplied kbVersion cannot make a stale version pass', async () => {
    version({ kbVersion: KB - 1 })
    const r = await publish(OWNER, { kbVersion: KB - 1 })
    expect(payload(r)).toMatchObject({ ok: false, reason: 'not_ship_ready' })
    noPublications()
  })
})

describe('publishDraft success', () => {
  it('[T-014.2] ship-ready creates exactly one live publication at the current kb version', async () => {
    claim('c1', 'supported')
    const r = await publish(OWNER)
    expect(payload(r)).toMatchObject({ ok: true })
    const pubs = records.rows('publications')
    expect(pubs).toHaveLength(1)
    expect(pubs[0]).toMatchObject({ draftId: 'd1', versionId: 'v1', url: URL_OK, status: 'live', kbVersionAtPublish: KB })
    expect(payload(r).publicationId).toBe(pubs[0].id)
  })

  it('[T-014.2] a contradicted claim with an admin approve is ship-ready', async () => {
    claim('c1', 'contradicted')
    claim('c2', 'unsupported')
    signoff('c1', 'approve')
    signoff('c2', 'approve')
    expect(payload(await publish(OWNER))).toMatchObject({ ok: true })
    expect(records.rows('publications')).toHaveLength(1)
  })

  it('[T-014.2] a checked version with zero claims is ship-ready', async () => {
    expect(payload(await publish(OWNER))).toMatchObject({ ok: true })
    expect(records.rows('publications')).toHaveLength(1)
  })

  it('[T-014.2] kbVersionAtPublish comes from kb_state, not the client', async () => {
    records.seed('kb_state', 'global', { version: 9 })
    version({ kbVersion: 9 })
    await publish(OWNER, { kbVersionAtPublish: 1 })
    expect(records.rows('publications')[0]).toMatchObject({ kbVersionAtPublish: 9 })
  })

  it('[T-014.2] a collaborator may publish', async () => {
    expect(payload(await publish(COLLAB))).toMatchObject({ ok: true })
    expect(records.rows('publications')).toHaveLength(1)
  })
})

describe('publishDraft access', () => {
  it('[T-014.3] a member who is neither owner nor collaborator is refused and no row is created', async () => {
    claim('c1', 'supported')
    const r = await publish(STRANGER)
    expect(refused(r)).toBe(true)
    expect(payload(r).reason).not.toBe('not_ship_ready')
    noPublications()
  })

  it('[T-014.3] a stranger gets no gate details (blocking ids) back', async () => {
    claim('c1', 'contradicted')
    const r = await publish(STRANGER)
    expect(refused(r)).toBe(true)
    expect(JSON.stringify(r)).not.toContain('c1')
    noPublications()
  })

  it('[T-014.3] a version id from a different draft cannot be published under this draft', async () => {
    records.seed('drafts', 'd2', { title: 'other', channel: 'blog', body: BODY, collaborators: [], latestVersionId: 'v2' }, STRANGER)
    records.seed('draft_versions', 'v2', { draftId: 'd2', body: BODY, kbVersion: KB, status: 'checked', mode: 'full' })
    const r = await publish(OWNER, { draftId: 'd1', versionId: 'v2' })
    expect(refused(r)).toBe(true)
    noPublications()
  })

  it.each([
    ['unknown draft', { draftId: 'nope' }],
    ['unknown version', { versionId: 'nope' }],
  ])('[T-014.3] %s is refused and creates no row', async (_n, over) => {
    expect(refused(await publish(OWNER, over))).toBe(true)
    noPublications()
  })

  it('[T-014.3] publications schema: members and admins cannot create/update/delete directly; anonymous and viewer get nothing', () => {
    const perms = schemas.find((s) => s.name === 'publications')!.permissions
    expect(perms.member).toMatchObject({ read: true, create: false, update: false, delete: false })
    expect(perms.admin).toMatchObject({ create: false, update: false, delete: false })
    expect(perms['*']).toMatchObject({ read: false, create: false, update: false, delete: false })
    expect(perms.viewer?.create ?? false).toBe(false)
  })
})

describe('publishDraft validation', () => {
  const badUrls: Array<[string, unknown]> = [
    ['not a url', 'not a url'],
    ['empty', ''],
    ['over 500 chars', `https://example.com/${'a'.repeat(500)}`],
    ['javascript: scheme (CONTRACT-CHANGE candidate: PublishRequest must allow only http/https)', 'javascript:alert(1)'],
    ['wrong type', 42],
  ]
  it.each(badUrls)('[T-014.4] invalid url (%s) is refused and creates no row', async (_n, url) => {
    claim('c1', 'supported')
    const r = await publish(OWNER, { url })
    expect(refused(r)).toBe(true)
    expect(payload(r).reason).not.toBe('not_ship_ready')
    noPublications()
  })

  it('[T-014.4] missing url or ids is refused and creates no row', async () => {
    const fn = actions.publishDraft
    if (!fn) throw new Error('actions.publishDraft is not registered in src/actions/index.ts')
    for (const params of [{ draftId: 'd1', versionId: 'v1' }, { versionId: 'v1', url: URL_OK }, { draftId: 'd1', url: URL_OK }]) {
      const r = await fn({ userId: OWNER, params, tools: records as unknown as ActionTools, env: {} as Env, callerJwt: 'jwt' })
      expect(refused(r)).toBe(true)
    }
    noPublications()
  })
})

// Strict wire shape (Lane B T-016 reads it). Deliberately not routed through the lenient payload()/refused() helpers.
describe('publishDraft result shape', () => {
  it('[T-014.1] gate refusal is exactly { success: true, data: { ok: false, reason, blocking } }', async () => {
    claim('c1', 'contradicted')
    expect(await publish(OWNER)).toEqual({ success: true, data: { ok: false, reason: 'not_ship_ready', blocking: ['c1'] } })
  })
  it('[T-014.2] success is exactly { success: true, data: { ok: true, publicationId } }', async () => {
    const r = await publish(OWNER)
    expect(r).toEqual({ success: true, data: { ok: true, publicationId: records.rows('publications')[0].id } })
  })
  it('[T-014.3] a stranger gets exactly { success: false, code: forbidden, error }', async () => {
    expect(await publish(STRANGER)).toEqual({ success: false, code: 'forbidden', error: expect.any(String) })
  })
  it('[T-014.4] a bad url gets exactly { success: false, code: invalid_request, error }', async () => {
    expect(await publish(OWNER, { url: 'not a url' })).toEqual({ success: false, code: 'invalid_request', error: expect.any(String) })
  })
})

describe('publishDraft idempotency', () => {
  it('[T-014.2] same version and url twice returns the same publicationId and leaves one row', async () => {
    const a = (await publish(OWNER)) as { data: { publicationId: string } }
    const b = (await publish(OWNER)) as { data: { publicationId: string } }
    expect(b.data.publicationId).toBe(a.data.publicationId)
    expect(records.rows('publications')).toHaveLength(1)
  })
  it('[T-014.2] same version at a different url creates a second row', async () => {
    const a = (await publish(OWNER)) as { data: { publicationId: string } }
    const b = (await publish(OWNER, { url: 'https://example.com/blog/other' })) as { data: { publicationId: string } }
    expect(b.data.publicationId).not.toBe(a.data.publicationId)
    expect(records.rows('publications').map((p) => (p as Data).url).sort()).toEqual([URL_OK, 'https://example.com/blog/other'])
  })
})

describe('publishDraft fails closed on unreadable claims', () => {
  it.each([
    ['missing verdict', { versionId: 'v1', text: 'x' }],
    ['invalid verdict', { versionId: 'v1', verdict: 'maybe' }],
  ])('[T-014.1] a claims row with a %s is refused (read_failed) and creates no row', async (_n, data) => {
    claim('c1', 'supported')
    records.seed('claims', 'bad', data)
    const r = await publish(OWNER)
    expect(r).toMatchObject({ success: false, code: 'read_failed' })
    noPublications()
  })
})

describe('publishDraft output hygiene', () => {
  it.each([
    ['success', OWNER, () => undefined],
    ['gate refusal', OWNER, () => claim('c1', 'contradicted')],
    ['access refusal', STRANGER, () => undefined],
  ])('[AGENTS.md §6] %s never returns raw users rows or emails', async (_n, caller, setup) => {
    setup()
    const out = JSON.stringify(await publish(caller))
    expect(out).not.toContain('@')
    expect(out).not.toContain('Olivia')
    expect(out).not.toContain('Sam Stranger')
  })
})
