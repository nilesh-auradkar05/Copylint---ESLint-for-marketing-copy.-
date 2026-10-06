import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { BrowserContext, Page } from '@playwright/test'

/**
 * T-015 two-user end-to-end spec (SPEC §3 permissions, §6 review room "Live", §7 check route).
 *
 * Accounts are chosen by NAME because the behaviour depends on who acts (same convention as the
 * T-002 matrix in api.spec.ts):
 *   Writer   member, owns the draft
 *   Engineer admin (promoted by the human on this worktree's dev server; tests never promote)
 *   Dev1     a third member who is neither owner nor collaborator
 *
 * Writes go through the same records-probe the RBAC matrix uses, so "refused" means the Durable
 * Object's RBAC said DENIED, never a hidden button. Rows created here carry a `__test-<ts>__`
 * marker and are removed in `finally` by the identity allowed to delete them. `claims` and
 * `draft_versions` are server-only (no role may create or delete them), so a real check leaves
 * those two rows behind; that is inherent and keyed to a throwaway draft.
 *
 * T-015.1 needs claims on a draft. No role can create `claims` / `draft_versions` through the records
 * API (SPEC §3, AGENTS.md §6), so it can only get them from a real check, which is a paid model call.
 * It is therefore gated behind RUN_PAID_CHECK=1 and makes exactly one POST /api/drafts/:id/check.
 */
const accountNames = new Set(loadAllTestAccounts().flatMap(a => [a.name, a.label].filter((n): n is string => !!n)))
const hasAccounts = (...names: string[]) => names.every(n => accountNames.has(n))

type Result = { ok: true; id: string } | { ok: false; error: string }

async function openProbe(context: BrowserContext): Promise<Page> {
  const page = await context.newPage()
  await page.goto('/home')
  await page.addScriptTag({ type: 'module', url: '/tests/helpers/records-probe.tsx' })
  await expect.poll(() => page.evaluate(() => window.recordsProbe?.ready() ?? false), { timeout: 20_000 }).toBe(true)
  return page
}

const rows = (page: Page, collection: string) => page.evaluate(c => window.recordsProbe!.rows(c), collection)
const me = (page: Page) => page.evaluate(() => window.recordsProbe!.me())
const create = (page: Page, collection: string, data: Record<string, unknown>): Promise<Result> =>
  page.evaluate(([c, d]) => window.recordsProbe!.create(c as string, d as Record<string, unknown>), [collection, data] as const)
const put = (page: Page, collection: string, id: string, patch: Record<string, unknown>): Promise<Result> =>
  page.evaluate(([c, i, p]) => window.recordsProbe!.put(c as string, i as string, p as Record<string, unknown>), [collection, id, patch] as const)
const remove = (page: Page, collection: string, id: string): Promise<Result> =>
  page.evaluate(([c, i]) => window.recordsProbe!.remove(c, i), [collection, id] as const)

function expectDenied(result: Result, message: string) {
  expect(result.ok, message).toBe(false)
  expect(result.ok ? '' : result.error, message).toMatch(/DENIED/)
}

/** Skip (with a reason) when the account is not the role this scenario depends on. */
async function requireRole(page: Page, who: string, role: 'admin' | 'member') {
  const { role: actual } = await me(page)
  const isAdmin = actual === 'admin'
  test.skip(role === 'admin' ? !isAdmin : isAdmin, `${who} must be a ${role} on the server under test (is ${actual}); the human sets roles, tests never do.`)
}

/** Create a draft as `page`'s user and return its record id (looked up by unique title). */
async function createDraft(page: Page, title: string, body: string, collaborators: string[] = []): Promise<string> {
  const created = await create(page, 'drafts', { title, body, channel: 'blog', collaborators })
  expect(created.ok, JSON.stringify(created)).toBe(true)
  await expect.poll(async () => (await rows(page, 'drafts')).some(r => r.data.title === title)).toBe(true)
  return (await rows(page, 'drafts')).find(r => r.data.title === title)!.recordId
}

test.describe('T-015 two-user review room', () => {
  test.skip(!hasAccounts('Writer', 'Engineer', 'Dev1'), 'Needs test accounts named Writer and Dev1 (members) and Engineer (admin).')

  test('[T-015.1] claims appear for writer and engineer without reload; an engineer approve updates the writer badge live', async ({ users }) => {
    test.skip(process.env.RUN_PAID_CHECK !== '1', 'claims/draft_versions are server-only, so the only source is one real check (model calls on the owner bill); opt in with RUN_PAID_CHECK=1')
    test.setTimeout(300_000)
    const [writer, engineer] = await users(['Writer', 'Engineer'])
    const writerProbe = await openProbe(writer.context)
    const engineerProbe = await openProbe(engineer.context)
    await requireRole(writerProbe, 'Writer', 'member')
    await requireRole(engineerProbe, 'Engineer', 'admin')

    const marker = `__test-${Date.now()}__`
    const title = `${marker} two-user`
    const body = 'DeepSpace apps run on AWS Lambda rather than Cloudflare. Every DeepSpace app is capped at 3 collections.'
    let draftId: string | undefined
    try {
      draftId = await createDraft(writerProbe, title, body)
      // Admin read is `true`, so the engineer needs no collaborator entry to open the writer's draft.
      const w = writer.page
      const e = engineer.page
      await Promise.all([w.goto(`/drafts/${draftId}`), e.goto(`/drafts/${draftId}`)])
      for (const p of [w, e]) {
        await expect(p.getByRole('heading', { name: title, level: 1 })).toBeVisible({ timeout: 20_000 })
        await expect(p.getByRole('heading', { name: 'Claims · 0' })).toBeVisible()
        // A reload would drop this flag: it is how the test proves nothing reloaded.
        await p.evaluate(() => { (window as unknown as { __t015Loaded: boolean }).__t015Loaded = true })
      }

      let checkPosts = 0
      w.on('request', r => { if (r.method() === 'POST' && /\/api\/drafts\/[^/]+\/check$/.test(r.url())) checkPosts += 1 })
      const gate = (p: Page) => p.getByRole('status').filter({ hasText: /^(DRAFT|CHECKING|FAILED|STALE|BLOCKED \d+|SHIP-READY)/ }).first()
      await w.getByRole('button', { name: 'Check claims' }).click()

      // Claims appear for BOTH users with no navigation.
      for (const p of [w, e]) {
        await expect(p.getByRole('heading', { name: /^Claims · [1-9]/ }), 'the check produced no claims for the writer/engineer').toBeVisible({ timeout: 240_000 })
      }
      // The engineer sees the sign-off controls; the writer sees the cards but no controls.
      const panel = e.getByRole('region', { name: 'Engineer sign-off' })
      // The panel only mounts once the version is `checked` and at least one claim is not supported.
      await expect(panel, 'the false claims should have produced at least one blocking claim for the engineer').toBeVisible({ timeout: 240_000 })
      await expect(w.getByRole('button', { name: /^Approve:/ })).toHaveCount(0)
      await expect(gate(w)).toHaveText(/^BLOCKED [1-9]\d*$/, { timeout: 30_000 })
      await expect(gate(e)).toHaveText(/^BLOCKED [1-9]\d*$/)
      const blocking = Number(/\d+/.exec(await gate(w).innerText())![0])
      const cards = panel.getByRole('article')
      await expect(cards).toHaveCount(blocking)

      // A note is required: an empty approve is refused client-side and the gate does not move.
      await cards.nth(0).getByRole('button', { name: /^Approve:/ }).click()
      await expect(cards.nth(0).getByRole('alert')).toHaveText('Add a note explaining your decision.')
      await expect(gate(w)).toHaveText(`BLOCKED ${blocking}`)

      // Approve the first blocking claim: the writer's badge moves with no reload.
      await cards.nth(0).getByRole('textbox').fill(`${marker} verified by engineer`)
      await cards.nth(0).getByRole('button', { name: /^Approve:/ }).click()
      await expect(gate(w)).toHaveText(blocking === 1 ? 'SHIP-READY' : `BLOCKED ${blocking - 1}`, { timeout: 30_000 })
      await expect(w.getByRole('list', { name: 'Existing sign-offs' }).first()).toContainText('approved')

      // Approve the rest: the writer's gate opens.
      for (let i = 1; i < blocking; i++) {
        await cards.nth(i).getByRole('textbox').fill(`${marker} verified by engineer ${i}`)
        await cards.nth(i).getByRole('button', { name: /^Approve:/ }).click()
      }
      await expect(gate(w)).toHaveText('SHIP-READY', { timeout: 30_000 })
      await expect(gate(e)).toHaveText('SHIP-READY')

      for (const p of [w, e]) {
        expect(await p.evaluate(() => (window as unknown as { __t015Loaded?: boolean }).__t015Loaded), 'the page reloaded; live sync was not proven').toBe(true)
      }
      expect(checkPosts, 'exactly one real check per run (AGENTS.md section 3)').toBe(1)
    } finally {
      // Signoffs are deletable by their admin author; the draft by its owner. claims and
      // draft_versions have no delete path for any role and stay behind, keyed to the dead draft.
      if (draftId) {
        const claimIds = new Set((await rows(engineerProbe, 'claims')).filter(r => r.data.draftId === draftId).map(r => r.recordId))
        for (const s of await rows(engineerProbe, 'signoffs')) {
          if (claimIds.has(String(s.data.claimId))) await remove(engineerProbe, 'signoffs', s.recordId)
        }
        await remove(writerProbe, 'drafts', draftId)
      }
    }
  })

  test('[T-015.2] a member\'s forged signoffs create is refused and no row appears for the engineer', async ({ users }) => {
    const [member, other] = await users(['Writer', 'Dev1'])
    const [admin] = await users(['Engineer'])
    const memberProbe = await openProbe(member.context)
    const otherProbe = await openProbe(other.context)
    const adminProbe = await openProbe(admin.context)
    await requireRole(memberProbe, 'Writer', 'member')
    await requireRole(adminProbe, 'Engineer', 'admin')

    const marker = `__test-${Date.now()}__`
    const adminId = (await me(adminProbe)).id as string
    const base = { claimId: `${marker}-claim`, versionId: `${marker}-version`, decision: 'approve', note: `${marker} forged` }
    let controlId: string | undefined
    try {
      // Plain forge, and a forge that names the engineer as the reviewer.
      for (const forged of [base, { ...base, reviewerId: adminId }]) {
        const result = await create(memberProbe, 'signoffs', forged)
        if (result.ok) await remove(adminProbe, 'signoffs', result.id) // never leave a wrongly accepted row
        expectDenied(result, `member forged signoff ${JSON.stringify(Object.keys(forged))} must be refused by RBAC`)
      }
      // Control: a legitimate engineer signoff DOES reach every reader, so the empty result above
      // means "refused", not "this probe is not subscribed". The denial was confirmed before this
      // write, so any wrongly accepted row would already have fanned out ahead of the control.
      const control = await create(adminProbe, 'signoffs', { ...base, claimId: `${marker}-control`, note: `${marker} real` })
      expect(control.ok, JSON.stringify(control)).toBe(true)
      controlId = control.ok ? control.id : undefined
      for (const p of [memberProbe, otherProbe, adminProbe]) {
        await expect.poll(async () => (await rows(p, 'signoffs')).some(r => r.recordId === controlId)).toBe(true)
      }
      const mine = (await rows(adminProbe, 'signoffs')).filter(r => JSON.stringify(r.data).includes(marker))
      expect(mine.map(r => r.recordId)).toEqual([controlId])
      expect(mine[0].data.reviewerId).toBe(adminId)
      for (const p of [memberProbe, otherProbe]) {
        expect((await rows(p, 'signoffs')).filter(r => JSON.stringify(r.data).includes('forged'))).toHaveLength(0)
      }
    } finally {
      if (controlId) await remove(adminProbe, 'signoffs', controlId)
    }
  })

  test('[T-015.3] a third member who is neither owner nor collaborator cannot open the draft', async ({ users }) => {
    const [writer, third] = await users(['Writer', 'Dev1'])
    const writerProbe = await openProbe(writer.context)
    const thirdProbe = await openProbe(third.context)
    await requireRole(writerProbe, 'Writer', 'member')
    await requireRole(thirdProbe, 'Dev1', 'member')

    const marker = `__test-${Date.now()}__`
    const title = `${marker} private launch`
    const secret = `${marker} unannounced pricing details`
    let draftId: string | undefined
    try {
      draftId = await createDraft(writerProbe, title, secret)
      const thirdId = (await me(thirdProbe)).id as string

      // Control: the owner opens it and sees title and body.
      await writer.page.goto(`/drafts/${draftId}`)
      await expect(writer.page.getByRole('heading', { name: title, level: 1 })).toBeVisible({ timeout: 20_000 })

      await third.page.goto(`/drafts/${draftId}`)
      await expect(third.page.getByRole('heading', { name: 'Draft not found' })).toBeVisible({ timeout: 20_000 })
      await expect(third.page.getByText(marker)).toHaveCount(0)
      expect(await third.page.content()).not.toContain(marker)
      expect(await third.page.locator('body').innerText()).not.toContain('unannounced pricing')
      expect((await rows(thirdProbe, 'drafts')).some(r => r.recordId === draftId)).toBe(false)

      // Same page, no reload: once the owner shares it, access is granted, so the page was
      // refusing on access and not on a broken route.
      const shared = await put(writerProbe, 'drafts', draftId, { collaborators: [thirdId] })
      expect(shared.ok, JSON.stringify(shared)).toBe(true)
      await expect(third.page.getByRole('heading', { name: title, level: 1 })).toBeVisible({ timeout: 20_000 })
    } finally {
      if (draftId) await remove(writerProbe, 'drafts', draftId).catch(e => console.error('cleanup failed', String(e)))
    }
  })
})
