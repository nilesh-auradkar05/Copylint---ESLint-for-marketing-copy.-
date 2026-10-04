import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

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
