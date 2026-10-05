import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { BrowserContext, Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { CONFIG } from '../src/engine/config'

async function draftProbe(page: Page) {
  await page.goto('/home')
  await page.addScriptTag({ type: 'module', url: '/tests/helpers/draft-probe.tsx' })
  await expect.poll(() => page.evaluate(() => window.draftProbe?.ready && window.draftProbe.status === 'ready')).toBe(true)
}

test.describe('T-010b live drafts', () => {
  test('[T-010.2] anonymous visitors cannot mount either protected draft view', async ({ page }) => {
    for (const path of ['/drafts', '/drafts/new']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible()
      await expect(page.getByRole('heading', { name: /^(Drafts|New draft)$/ })).toHaveCount(0)
      await expect(page.getByLabel('Body', { exact: true })).toHaveCount(0)
    }
  })

  test.describe('signed-in persistence', () => {
    test.skip(loadAllTestAccounts().length < 2, 'Requires two usable SDK test accounts; no credentials belong in the spec.')

    test('[T-010.2] member creates a validated persistent draft; another member cannot read it', async ({ users }) => {
      const [writer, other] = await users(2)
      const observer = await writer.context.newPage()
      await draftProbe(observer)
      const before = await observer.evaluate(() => window.draftProbe!.records.map(r => r.recordId))
      const title = `__test-${Date.now()}__ Launch`
      try {
        await writer.page.goto('/home')
        await expect(writer.page.getByRole('link', { name: 'Drafts', exact: true })).toBeVisible()
        await writer.page.getByRole('link', { name: 'Drafts', exact: true }).click()
        await expect(writer.page).toHaveURL(/\/drafts$/)
        await writer.page.getByRole('link', { name: /New draft/ }).click()
        await expect(writer.page).toHaveURL(/\/drafts\/new$/)
        await writer.page.getByLabel('Body', { exact: true }).fill('abc')
        await expect(writer.page.getByText(/3\s*\/\s*20,?000/)).toBeVisible()
        await writer.page.getByRole('button', { name: /Create draft/ }).click()
        expect(await observer.evaluate(() => window.draftProbe!.records.map(r => r.recordId))).toEqual(before)
        await writer.page.getByLabel('Title', { exact: true }).fill(title)
        await writer.page.getByLabel('Body', { exact: true }).fill('x'.repeat(CONFIG.limits.maxBodyChars))
        await writer.page.getByRole('button', { name: /Create draft/ }).click()
        await expect.poll(() => observer.evaluate(t => window.draftProbe!.records.find(r => r.data.title === t)?.data.body, title)).toBe('x'.repeat(CONFIG.limits.maxBodyChars))
        await writer.page.goto('/drafts')
        await expect(writer.page.getByRole('link', { name: title, exact: true })).toBeVisible()
        await writer.page.reload()
        await expect(writer.page.getByRole('link', { name: title, exact: true })).toBeVisible()
        await other.page.goto('/drafts')
        await expect(other.page.getByRole('heading', { name: 'Drafts', exact: true })).toBeVisible()
        await expect(other.page.getByRole('link', { name: title, exact: true })).toHaveCount(0)
      } finally {
        await observer.evaluate(async t => { for (const r of window.draftProbe!.records.filter(r => r.data.title === t)) await window.draftProbe!.remove(r.recordId) }, title)
        await observer.close()
      }
    })

    test('[T-010.3] empty list sample persists the exact seed body and thread channel', async ({ users }) => {
      const [writer] = await users(1)
      const observer = await writer.context.newPage()
      await draftProbe(observer)
      const before = await observer.evaluate(() => window.draftProbe!.records.map(r => r.recordId))
      try {
        await writer.page.goto('/drafts')
        await expect(writer.page.getByRole('button', { name: 'Create from sample', exact: true })).toBeVisible()
        await writer.page.getByRole('button', { name: 'Create from sample', exact: true }).click()
        await expect.poll(() => observer.evaluate(ids => window.draftProbe!.records.filter(r => !ids.includes(r.recordId)).map(r => r.data), before)).toEqual([
          expect.objectContaining({ title: 'DeepSpace launch thread', channel: 'thread', body: readFileSync('seed/launch-thread.md', 'utf8') }),
        ])
        await writer.page.reload()
        await expect(writer.page.getByRole('link', { name: 'DeepSpace launch thread', exact: true })).toBeVisible()
      } finally {
        // The product fixes the sample title; track IDs so cleanup never removes pre-existing data.
        await observer.evaluate(async ids => { for (const r of window.draftProbe!.records.filter(r => !ids.includes(r.recordId))) await window.draftProbe!.remove(r.recordId) }, before)
        await observer.close()
      }
    })
  })
})

test.describe('API tests', () => {
  test('auth proxy forwards to auth worker', async ({ request }) => {
    const res = await request.get('/api/auth/ok')
    expect(res.ok()).toBeTruthy()
  })

  test('WebSocket endpoint exists', async ({ page }) => {
    // /home is a dynamic page (under src/pages/(app)/), so mounting it boots
    // the providers and auto-connects the records WebSocket. The static
    // landing at '/' deliberately does neither — see smoke.spec.ts.
    await page.goto('/home')
    // Wait for the app to connect its WebSocket (it auto-connects on mount)
    await page.waitForSelector('[data-testid="app-navigation"]', { timeout: 15000 })
    // If the app loaded and connected, the WS endpoint works
  })
})


/**
 * T-002 live RBAC matrix (SPEC §3, ADR-0004, AGENTS.md §6).
 *
 * The permission RULES are also proven without a server by `src/schemas.test.ts`. These tests prove
 * that the live Durable Object enforces them over the records WebSocket for real signed-in members,
 * a real admin and a signed-out visitor. Reads and writes go through the SDK's own hooks via
 * `tests/helpers/records-probe.tsx` (no hand-rolled wire format). Assertions are on what the server
 * returned and on which rows exist afterwards, never on hidden buttons.
 *
 * Accounts are chosen by NAME, never by count: `Dev1`, `Dev2` are members; `Engineer` must have been
 * promoted to admin in this worktree's local dev state (SPEC §11 correction 8). Credentials stay in the
 * local registry.
 *
 * Every row a test creates carries a `__test-<ts>__` marker, is tracked by id and removed in `finally`
 * by the identity allowed to delete it (drafts: owner; signoffs: the admin who created them).
 */
const accountNames = new Set(loadAllTestAccounts().flatMap(a => [a.name, a.label].filter((n): n is string => !!n)))
const hasAccounts = (...names: string[]) => names.every(n => accountNames.has(n))

const NEW_COLLECTIONS = [
  'drafts',
  'draft_versions',
  'claims',
  'signoffs',
  'publications',
  'sources',
  'kb_state',
] as const

/** A minimal, schema-valid row for each collection that members must never be able to create. */
function serverOnlyRow(collection: string, marker: string): Record<string, unknown> {
  switch (collection) {
    case 'draft_versions':
      return { draftId: marker, body: marker, bodyHash: marker, kbVersion: 1, status: 'checked', requestedBy: marker, requestedAt: new Date().toISOString(), mode: 'full', jobId: marker }
    case 'claims':
      return { versionId: marker, draftId: marker, claimHash: marker, text: marker, quote: marker, span: { start: 0, end: 1 }, kind: 'capability', verdict: 'supported', confidence: 'high', evidence: [], reason: marker }
    case 'signoffs':
      return { claimId: marker, versionId: marker, decision: 'approve', note: marker }
    case 'publications':
      return { draftId: marker, versionId: marker, url: `https://example.test/${marker}`, kbVersionAtPublish: 1, status: 'live', stalePages: [] }
    case 'sources':
      return { path: marker, contentHash: marker, kbItemIds: [], lastFetchedAt: new Date().toISOString(), indexStatus: 'completed' }
    case 'kb_state':
      return { version: 99, lastSyncAt: new Date().toISOString(), lastChangedPages: [marker] }
    default:
      throw new Error(`no fixture for ${collection}`)
  }
}

const SERVER_ONLY_COLLECTIONS = NEW_COLLECTIONS.filter(c => c !== 'drafts')

/** Open a fresh page in `context` with the generic records probe mounted and every room ready. */
async function openProbe(context: BrowserContext, options: { anonymous?: boolean } = {}): Promise<Page> {
  const page = await context.newPage()
  await page.goto('/home')
  if (options.anonymous) await page.evaluate(() => { window.recordsProbeConfig = { allowAnonymous: true } })
  await page.addScriptTag({ type: 'module', url: '/tests/helpers/records-probe.tsx' })
  await expect.poll(() => page.evaluate(() => window.recordsProbe?.ready() ?? false), { timeout: 20_000 }).toBe(true)
  return page
}

const probeRows = (page: Page, collection: string) => page.evaluate(c => window.recordsProbe!.rows(c), collection)
const probeCreate = (page: Page, collection: string, data: Record<string, unknown>) =>
  page.evaluate(([c, d]) => window.recordsProbe!.create(c as string, d as Record<string, unknown>), [collection, data] as const)
const probePut = (page: Page, collection: string, id: string, patch: Record<string, unknown>) =>
  page.evaluate(([c, i, p]) => window.recordsProbe!.put(c as string, i as string, p as Record<string, unknown>), [collection, id, patch] as const)
const probeRemove = (page: Page, collection: string, id: string) =>
  page.evaluate(([c, i]) => window.recordsProbe!.remove(c, i), [collection, id] as const)
/** Assert a write was refused by the server's RBAC (not by validation, transport or a client guard). */
function expectDenied(result: { ok: boolean; error?: string }, message: string) {
  expect(result.ok, message).toBe(false)
  expect(result.error ?? '', message).toMatch(/DENIED/)
}

const probeMe = (page: Page) => page.evaluate(() => window.recordsProbe!.me())

async function hasRow(page: Page, collection: string, id: string): Promise<boolean> {
  return (await probeRows(page, collection)).some(r => r.recordId === id)
}

async function expectAdmin(page: Page): Promise<string> {
  const me = await probeMe(page)
  expect(me.role, 'Engineer must be an admin in this worktree dev state (human promotes it; tests never do)').toBe('admin')
  expect(me.id).toBeTruthy()
  return me.id as string
}

function draftData(marker: string, collaborators: string[] = []) {
  return { title: `${marker} draft`, body: `Body for ${marker}`, channel: 'blog', collaborators }
}

test.describe('RBAC matrix (live)', () => {
  test.skip(!hasAccounts('Dev1', 'Dev2', 'Engineer'), 'Needs test accounts named Dev1 and Dev2 (members) and Engineer (admin).')

  // T-002.2 ---------------------------------------------------------------------------------
  for (const collection of NEW_COLLECTIONS) {
    test(`[T-002.2] anonymous visitor gets 0 rows from ${collection}`, async ({ browser }) => {
      const context = await browser.newContext()
      try {
        const anon = await openProbe(context, { anonymous: true })
        expect((await probeMe(anon)).id).toBeNull()
        expect(await anon.evaluate(c => window.recordsProbe!.status(c), collection)).toBe('ready')
        expect(await probeRows(anon, collection)).toHaveLength(0)
      } finally {
        await context.close()
      }
    })
  }

  test('[T-002.2] anonymous visitor still sees 0 rows after a member draft and an admin signoff exist', async ({ users, browser }) => {
    const [dev] = await users(['Dev1'])
    const [admin] = await users(['Engineer'])
    const marker = `__test-${Date.now()}__`
    const anonContext = await browser.newContext()
    const devPage = await openProbe(dev.context)
    const adminPage = await openProbe(admin.context)
    let draftId: string | undefined
    let signoffId: string | undefined
    try {
      await expectAdmin(adminPage)
      const draft = await probeCreate(devPage, 'drafts', draftData(marker))
      expect(draft.ok, JSON.stringify(draft)).toBe(true)
      draftId = draft.ok ? draft.id : undefined
      const signoff = await probeCreate(adminPage, 'signoffs', { claimId: `${marker}-claim`, versionId: `${marker}-version`, decision: 'approve', note: marker })
      expect(signoff.ok, JSON.stringify(signoff)).toBe(true)
      signoffId = signoff.ok ? signoff.id : undefined

      // Control: signed-in readers do see the rows, so an empty anonymous result means "denied", not "empty".
      await expect.poll(() => hasRow(devPage, 'drafts', draftId!)).toBe(true)
      await expect.poll(() => hasRow(devPage, 'signoffs', signoffId!)).toBe(true)

      const anon = await openProbe(anonContext, { anonymous: true })
      expect(await probeRows(anon, 'drafts')).toHaveLength(0)
      expect(await probeRows(anon, 'signoffs')).toHaveLength(0)
    } finally {
      if (signoffId) await probeRemove(adminPage, 'signoffs', signoffId)
      if (draftId) await probeRemove(devPage, 'drafts', draftId)
      await anonContext.close()
    }
  })

  // T-002.3 ---------------------------------------------------------------------------------
  test('[T-002.3] member A creates a draft and can read and update it', async ({ users }) => {
    const [a] = await users(['Dev1'])
    const marker = `__test-${Date.now()}__`
    const pageA = await openProbe(a.context)
    let id: string | undefined
    try {
      const created = await probeCreate(pageA, 'drafts', draftData(marker))
      expect(created.ok, JSON.stringify(created)).toBe(true)
      id = created.ok ? created.id : undefined
      await expect.poll(() => hasRow(pageA, 'drafts', id!)).toBe(true)

      const updated = await probePut(pageA, 'drafts', id!, { title: `${marker} edited` })
      expect(updated.ok, JSON.stringify(updated)).toBe(true)
      await expect.poll(async () => (await probeRows(pageA, 'drafts')).find(r => r.recordId === id)?.data.title).toBe(`${marker} edited`)
    } finally {
      if (id) await probeRemove(pageA, 'drafts', id)
    }
  })

  test("[T-002.3] member B cannot see member A's private draft, nor update or delete it", async ({ users }) => {
    const [a, b] = await users(['Dev1', 'Dev2'])
    const marker = `__test-${Date.now()}__`
    const pageA = await openProbe(a.context)
    const pageB = await openProbe(b.context)
    let id: string | undefined
    try {
      const created = await probeCreate(pageA, 'drafts', draftData(marker))
      expect(created.ok, JSON.stringify(created)).toBe(true)
      id = created.ok ? created.id : undefined
      await expect.poll(() => hasRow(pageA, 'drafts', id!)).toBe(true)

      expect(await hasRow(pageB, 'drafts', id!)).toBe(false)
      expect((await probeRows(pageB, 'drafts')).filter(r => String(r.data.title).includes(marker))).toHaveLength(0)

      const put = await probePut(pageB, 'drafts', id!, { title: `${marker} hijacked` })
      expectDenied(put, 'B must not be able to update a private draft')
      const removed = await probeRemove(pageB, 'drafts', id!)
      expectDenied(removed, 'B must not be able to delete a private draft')

      // The row is untouched from the owner's side.
      const mine = (await probeRows(pageA, 'drafts')).find(r => r.recordId === id)
      expect(mine?.data.title).toBe(`${marker} draft`)
    } finally {
      if (id) await probeRemove(pageA, 'drafts', id)
    }
  })

  test('[T-002.3] after A adds B to collaborators, B can read and update the draft but not delete it', async ({ users }) => {
    const [a, b] = await users(['Dev1', 'Dev2'])
    const marker = `__test-${Date.now()}__`
    const pageA = await openProbe(a.context)
    const pageB = await openProbe(b.context)
    let id: string | undefined
    try {
      const bId = (await probeMe(pageB)).id
      expect(bId).toBeTruthy()
      const created = await probeCreate(pageA, 'drafts', draftData(marker))
      expect(created.ok, JSON.stringify(created)).toBe(true)
      id = created.ok ? created.id : undefined
      await expect.poll(() => hasRow(pageA, 'drafts', id!)).toBe(true)
      expect(await hasRow(pageB, 'drafts', id!)).toBe(false)

      const shared = await probePut(pageA, 'drafts', id!, { collaborators: [bId] })
      expect(shared.ok, JSON.stringify(shared)).toBe(true)
      await expect.poll(() => hasRow(pageB, 'drafts', id!)).toBe(true)

      const edited = await probePut(pageB, 'drafts', id!, { title: `${marker} edited by B` })
      expect(edited.ok, JSON.stringify(edited)).toBe(true)
      await expect.poll(async () => (await probeRows(pageA, 'drafts')).find(r => r.recordId === id)?.data.title).toBe(`${marker} edited by B`)

      const removed = await probeRemove(pageB, 'drafts', id!)
      expectDenied(removed, 'a collaborator must not be able to delete')
      expect(await hasRow(pageA, 'drafts', id!)).toBe(true)
    } finally {
      if (id) await probeRemove(pageA, 'drafts', id)
    }
  })

  test('[T-002.3] only the owner can delete a draft', async ({ users }) => {
    const [a, b] = await users(['Dev1', 'Dev2'])
    const marker = `__test-${Date.now()}__`
    const pageA = await openProbe(a.context)
    const pageB = await openProbe(b.context)
    let id: string | undefined
    try {
      const bId = (await probeMe(pageB)).id
      const created = await probeCreate(pageA, 'drafts', draftData(marker, [bId as string]))
      expect(created.ok, JSON.stringify(created)).toBe(true)
      id = created.ok ? created.id : undefined
      await expect.poll(() => hasRow(pageB, 'drafts', id!)).toBe(true)

      expectDenied(await probeRemove(pageB, 'drafts', id!), 'a collaborator must not be able to delete')
      expect(await hasRow(pageA, 'drafts', id!)).toBe(true)

      const removed = await probeRemove(pageA, 'drafts', id!)
      expect(removed.ok, JSON.stringify(removed)).toBe(true)
      await expect.poll(() => hasRow(pageA, 'drafts', id!)).toBe(false)
      await expect.poll(() => hasRow(pageB, 'drafts', id!)).toBe(false)
      id = undefined
    } finally {
      if (id) await probeRemove(pageA, 'drafts', id)
    }
  })

  // T-002.4 ---------------------------------------------------------------------------------
  for (const collection of SERVER_ONLY_COLLECTIONS) {
    test(`[T-002.4] member create on ${collection} is refused and no row exists afterwards`, async ({ users }) => {
      const [member, other] = await users(['Dev1', 'Dev2'])
      const [admin] = await users(['Engineer'])
      const marker = `__test-${Date.now()}__`
      const pageMember = await openProbe(member.context)
      const pageOther = await openProbe(other.context)
      const pageAdmin = await openProbe(admin.context)
      const before = await Promise.all([pageMember, pageOther, pageAdmin].map(async p => (await probeRows(p, collection)).length))
      const result = await probeCreate(pageMember, collection, serverOnlyRow(collection, marker))
      try {
        expectDenied(result, `member create on ${collection} must be refused`)
        // Give a wrongly-accepted write time to fan out, then check every observer.
        await pageMember.waitForTimeout(500)
        const after = await Promise.all([pageMember, pageOther, pageAdmin].map(async p => (await probeRows(p, collection)).length))
        expect(after).toEqual(before)
        for (const p of [pageMember, pageOther, pageAdmin]) {
          expect(JSON.stringify(await probeRows(p, collection))).not.toContain(marker)
        }
      } finally {
        // Nothing to clean up when the server behaves; if it did not, the assertion above already failed
        // loudly and no role may delete these rows, so report rather than guess.
        if (result.ok) console.error(`LEFTOVER ${collection} row ${result.id} (member create was accepted)`)
      }
    })
  }

  test('[T-002.4] a member cannot forge a signoff with another reviewerId', async ({ users }) => {
    const [member, other] = await users(['Dev1', 'Dev2'])
    const [admin] = await users(['Engineer'])
    const marker = `__test-${Date.now()}__`
    const pageMember = await openProbe(member.context)
    const pageOther = await openProbe(other.context)
    const pageAdmin = await openProbe(admin.context)
    const adminId = await expectAdmin(pageAdmin)
    const otherId = (await probeMe(pageOther)).id as string
    for (const reviewerId of [adminId, otherId]) {
      const forged = await probeCreate(pageMember, 'signoffs', { claimId: `${marker}-claim`, versionId: `${marker}-version`, reviewerId, decision: 'approve', note: `${marker} forged` })
      if (forged.ok) console.error(`LEFTOVER signoffs row ${forged.id} (forged signoff accepted)`)
      expectDenied(forged, `forged signoff naming ${reviewerId === adminId ? 'the admin' : 'another member'} must be refused`)
    }
    await pageMember.waitForTimeout(500)
    for (const p of [pageMember, pageOther, pageAdmin]) {
      expect((await probeRows(p, 'signoffs')).filter(r => JSON.stringify(r.data).includes(marker))).toHaveLength(0)
    }
  })

  // T-002.5 (admin half) --------------------------------------------------------------------
  test('[T-002.5] admin creates one signoff stamped with their own id; a second on the same claim is refused as a duplicate', async ({ users }) => {
    const [admin] = await users(['Engineer'])
    const [member] = await users(['Dev1'])
    const marker = `__test-${Date.now()}__`
    const pageAdmin = await openProbe(admin.context)
    const pageMember = await openProbe(member.context)
    const adminId = await expectAdmin(pageAdmin)
    const memberId = (await probeMe(pageMember)).id as string
    const claimId = `${marker}-claim`
    const created: string[] = []
    try {
      // The payload names someone else as reviewer; the server must stamp the verified identity.
      const first = await probeCreate(pageAdmin, 'signoffs', { claimId, versionId: `${marker}-version`, reviewerId: memberId, decision: 'approve', note: `${marker} first` })
      expect(first.ok, JSON.stringify(first)).toBe(true)
      if (first.ok) created.push(first.id)
      await expect.poll(() => hasRow(pageAdmin, 'signoffs', created[0] ?? '')).toBe(true)
      const stored = (await probeRows(pageAdmin, 'signoffs')).find(r => r.recordId === created[0])
      expect(stored?.data.reviewerId).toBe(adminId)
      expect(stored?.data.claimId).toBe(claimId)

      const second = await probeCreate(pageAdmin, 'signoffs', { claimId, versionId: `${marker}-version`, decision: 'cut', note: `${marker} second` })
      if (second.ok) created.push(second.id)
      expect(second.ok, 'a second signoff by the same admin on the same claim must be refused').toBe(false)
      if (!second.ok) expect(second.error).toMatch(/^Duplicate:/)
      expect((await probeRows(pageAdmin, 'signoffs')).filter(r => r.data.claimId === claimId)).toHaveLength(1)
    } finally {
      for (const id of created) await probeRemove(pageAdmin, 'signoffs', id)
    }
  })

  test('[T-002.5] reviewerId and claimId are immutable once a signoff exists', async ({ users }) => {
    const [admin] = await users(['Engineer'])
    const [member] = await users(['Dev1'])
    const marker = `__test-${Date.now()}__`
    const pageAdmin = await openProbe(admin.context)
    const pageMember = await openProbe(member.context)
    const adminId = await expectAdmin(pageAdmin)
    const memberId = (await probeMe(pageMember)).id as string
    let id: string | undefined
    try {
      const created = await probeCreate(pageAdmin, 'signoffs', { claimId: `${marker}-claim`, versionId: `${marker}-version`, decision: 'approve', note: marker })
      expect(created.ok, JSON.stringify(created)).toBe(true)
      id = created.ok ? created.id : undefined
      await expect.poll(() => hasRow(pageAdmin, 'signoffs', id!)).toBe(true)

      const reassign = await probePut(pageAdmin, 'signoffs', id!, { reviewerId: memberId })
      expect(reassign.ok, 'reviewerId is immutable').toBe(false)
      if (!reassign.ok) expect(reassign.error).toMatch(/immutable/i)
      const reclaim = await probePut(pageAdmin, 'signoffs', id!, { claimId: `${marker}-other` })
      expect(reclaim.ok, 'claimId is immutable').toBe(false)
      if (!reclaim.ok) expect(reclaim.error).toMatch(/immutable/i)
      const row = (await probeRows(pageAdmin, 'signoffs')).find(r => r.recordId === id)
      expect(row?.data.reviewerId).toBe(adminId)
      expect(row?.data.claimId).toBe(`${marker}-claim`)

      // A member can read the signoff but not alter or remove it.
      await expect.poll(() => hasRow(pageMember, 'signoffs', id!)).toBe(true)
      expectDenied(await probePut(pageMember, 'signoffs', id!, { note: 'tampered' }), 'member must not update a signoff')
      expectDenied(await probeRemove(pageMember, 'signoffs', id!), 'member must not delete a signoff')
      expect(await hasRow(pageAdmin, 'signoffs', id!)).toBe(true)
    } finally {
      if (id) await probeRemove(pageAdmin, 'signoffs', id)
    }
  })
})

/**
 * T-004.5 live check of POST /api/admin/sync (SPEC §8, AGENTS.md §6 "paid triggers").
 *
 * The role and body-handling matrix is proven without a server by `src/server/admin-routes.test.ts`
 * (Vitest, real Hono app, JWT/role/JobRoom faked). These cover the live wiring only.
 * Anonymous and member are rejected before anything is enqueued, so they cost nothing.
 * The admin 202 starts a real sync (25 uploads into the app's shared knowledge base) and is opt-in.
 */
const signedInToken = (page: Page) => page.evaluate(() => window.recordsProbe!.token())

test.describe('POST /api/admin/sync (live)', () => {
  test('[T-004.5] anonymous caller gets 401', async ({ request }) => {
    const res = await request.post('/api/admin/sync', { data: {} })
    expect(res.status()).toBe(401)
  })

  test('[T-004.5] a signed-in member gets 403', async ({ users, request }) => {
    test.skip(!hasAccounts('Dev1'), 'Needs a test account named Dev1 (member).')
    const [member] = await users(['Dev1'])
    const page = await openProbe(member.context)
    const token = await signedInToken(page)
    expect(token, 'signed-in page must expose a bearer token').toBeTruthy()
    const res = await request.post('/api/admin/sync', { data: {}, headers: { Authorization: `Bearer ${token}` } })
    expect(res.status()).toBe(403)
  })

  test('[T-004.5] an admin gets 202 with a jobId', async ({ users, request }) => {
    test.skip(process.env.RUN_PAID_SYNC !== '1', "starts a real sync: 25 uploads into the app's shared knowledge base; opt in with RUN_PAID_SYNC=1")
    test.skip(!hasAccounts('Engineer'), 'Needs a test account named Engineer (admin).')
    const [admin] = await users(['Engineer'])
    const page = await openProbe(admin.context)
    await expectAdmin(page)
    const token = await signedInToken(page)
    expect(token).toBeTruthy()
    const res = await request.post('/api/admin/sync', { data: {}, headers: { Authorization: `Bearer ${token}` } })
    expect(res.status()).toBe(202)
    const body = (await res.json()) as { jobId?: unknown }
    expect(typeof body.jobId).toBe('string')
  })
})
