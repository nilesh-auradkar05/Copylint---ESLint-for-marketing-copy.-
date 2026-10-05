import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'
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
 * STATUS: every test below is a `test.fixme` stub. Nothing here is faked.
 *
 * The permission RULES are already proven, without a server, by `src/schemas.test.ts`
 * (Vitest, runs the SDK's own `canRead`/`canCreate`/`canUpdate`/`canDelete` against the real
 * `schemas` array). What this block adds is proof that the live Durable Object enforces them over
 * the wire for a real signed-in member and a real signed-out visitor.
 *
 * Why stubs instead of code (checked against node_modules/deepspace/dist/*.d.ts and
 * docs.deep.space on 2026-10-04):
 *  - Record reads/writes are only exposed through the client SDK's React hooks
 *    (`useQuery`, `useMutations`) over the records WebSocket. There is no documented REST
 *    endpoint for records, and the WebSocket wire format is internal. This app has no route and no
 *    UI for these collections yet, and AGENTS.md §5 forbids putting identity in a WebSocket URL, so
 *    a hand-rolled `page.evaluate(new WebSocket(...))` would be a guess that could pass or fail for
 *    the wrong reason.
 *  - So these become real tests as soon as one of the following exists:
 *      (a) the Lane B drafts UI (T-010/T-011), driven through `data-testid` hooks, or
 *      (b) a documented records HTTP/WS surface, or
 *      (c) a dev-only probe page under `src/pages/(app)/` that mounts `useQuery`/`useMutations`
 *          and renders results by test id (a Lane B or orchestrator decision; test-author may not
 *          create files under src/).
 *  - The signed-out half needs a page that mounts the data layer without sign-in. `(app)/_layout.tsx`
 *    already uses `<RecordProvider allowAnonymous>`, so any `(app)/` page that lists a collection
 *    would serve for (a) or (c).
 *
 * To run once unblocked: create two test accounts (`npx deepspace test accounts create --email
 * <name>@deepspace.test --name "<name>" --password-stdin`), then `npx deepspace test run api`.
 * Per docs/guides/testing, prefix any record a test creates with `__test-${Date.now()}__` and delete
 * it in `finally`.
 */
const usableTestAccounts = loadAllTestAccounts().length

const NEW_COLLECTIONS = [
  'drafts',
  'draft_versions',
  'claims',
  'signoffs',
  'publications',
  'sources',
  'kb_state',
] as const

const SERVER_ONLY_COLLECTIONS = [
  'draft_versions',
  'claims',
  'signoffs',
  'publications',
  'sources',
  'kb_state',
] as const

test.describe('RBAC matrix (live)', () => {
  test.skip(
    usableTestAccounts < 2,
    `Needs 2 usable test accounts (two members), found ${usableTestAccounts}. Create them with ` +
      '`npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" ' +
      '--password-stdin`, or fetch existing pool accounts with `npx deepspace test accounts recover --all`.',
  )

  // T-002.2 ---------------------------------------------------------------------------------
  for (const collection of NEW_COLLECTIONS) {
    test.fixme(`[T-002.2] anonymous visitor gets 0 rows from ${collection}`, async ({ browser }) => {
      // Plan: open a fresh anonymous context (no storageState) on a dynamic (app)/ page that
      // subscribes to `${collection}`; wait for the query status to be 'ready' (not just empty,
      // which also means "loading"); assert the row count is 0 even after member A has created
      // data (seed it first in a second context). Blocked: no UI/route reads this collection
      // (see block comment). Do not replace with a guessed WebSocket call.
      void browser
    })
  }

  // T-002.3 ---------------------------------------------------------------------------------
  test.fixme('[T-002.3] member A creates a draft and can read and update it', async ({ users }) => {
    // Plan: A creates `{title: '__test-<ts>__ ...', body, channel: 'blog', collaborators: []}`
    // with createConfirmed, sees it in their query, and putConfirmed on it succeeds.
    const [a] = await users(1)
    void a
  })

  test.fixme("[T-002.3] member B cannot see member A's private draft", async ({ users }) => {
    // Plan: A creates a draft with collaborators []. B's query for `drafts` (status 'ready')
    // contains no row with A's title; B's putConfirmed on A's recordId is refused (permission).
    const [a, b] = await users(2)
    void a
    void b
  })

  test.fixme('[T-002.3] after A adds B to collaborators, B can read and update the draft', async ({ users }) => {
    // Plan: A putConfirmed({ collaborators: [B.userId] }). B's query now shows the row; B's
    // putConfirmed({ title: ... }) succeeds; A sees B's edit. B removeConfirmed is still refused
    // (delete is 'own'). B's id comes from MultiplayerUser.userId if the registry knows it,
    // otherwise from the session profile in B's page.
    const [a, b] = await users(2)
    void a
    void b
  })

  test.fixme('[T-002.3] only the owner can delete a draft', async ({ users }) => {
    const [a, b] = await users(2)
    void a
    void b
  })

  // T-002.4 ---------------------------------------------------------------------------------
  for (const collection of SERVER_ONLY_COLLECTIONS) {
    test.fixme(`[T-002.4] member create on ${collection} is refused`, async ({ users }) => {
      // Plan: a member's createConfirmed(collection, <minimal valid row>) rejects with a
      // permission error, and the row never appears in either member's query.
      const [a] = await users(1)
      void a
    })
  }

  test.fixme('[T-002.4] a member cannot forge a signoff with another reviewerId', async ({ users }) => {
    // Plan: member A createConfirmed('signoffs', { claimId, versionId, reviewerId: <B or an
    // admin id>, decision: 'approve', note: 'forged' }) is refused; no signoff row exists after.
    const [a] = await users(1)
    void a
  })

  // T-002.5 (admin half) --------------------------------------------------------------------
  test.fixme('[T-002.5] admin can create one signoff; a second on the same claim is refused; reviewerId cannot be spoofed', async () => {
    // Blocked on a human decision: password test accounts are `member`; the app owner (pinned
    // admin) is OAuth-only. There is no documented way to obtain an admin test user.
    test.fixme(true, 'needs an admin test user: see SPEC §11 note 8')
    // Plan once an admin exists: admin createConfirmed('signoffs', {claimId, versionId, decision:
    // 'approve', note}) succeeds and the stored reviewerId equals the admin's id even if the
    // payload sent another id; a second create for the same claim returns
    // `Duplicate: a record with claimId=..., reviewerId=... already exists in signoffs`
    // (SPEC §11 note 5); a different admin cannot update or delete it.
  })
})

/**
 * T-004.5 live check of POST /api/admin/sync (SPEC §8, AGENTS.md §6 "paid triggers").
 *
 * The role and body-handling matrix is proven without a server by `src/server/admin-routes.test.ts`
 * (Vitest, real Hono app, JWT/role/JobRoom faked). These cover the live wiring only.
 * The anonymous case is real: it is rejected before anything is enqueued, so it costs nothing.
 * Member and admin cases stay `fixme` until a signed-in API caller and an admin test user exist.
 * Never run the admin case in a loop: a 202 starts a real, billed sync job.
 */
test.describe('POST /api/admin/sync (live)', () => {
  test('[T-004.5] anonymous caller gets 401', async ({ request }) => {
    const res = await request.post('/api/admin/sync', { data: {} })
    expect(res.status()).toBe(401)
  })

  test.fixme('[T-004.5] a signed-in member gets 403', async ({ users }) => {
    // Plan: sign in one password test account (member), POST /api/admin/sync with the session's
    // bearer token, expect 403 and no job enqueued. Blocked: the `users` fixture exposes a browser
    // page, and the route authenticates with a bearer JWT; extracting that token from the page
    // session is not documented. Do not hand-roll a token.
    const [a] = await users(1)
    void a
  })

  test.fixme('[T-004.5] an admin gets 202 with a jobId', async () => {
    test.fixme(true, 'no admin test user (SPEC §11 correction 8)')
    // Plan once an admin exists: POST /api/admin/sync, expect 202 and a string `jobId`.
    // This starts one real sync job (25 docs fetches plus knowledge uploads): run it once per run.
  })
})
