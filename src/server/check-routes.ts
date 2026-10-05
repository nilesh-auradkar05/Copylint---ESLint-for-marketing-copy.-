/**
 * `POST /api/drafts/:draftId/check` — the member-facing paid trigger (SPEC §7). Auth, role, access, size,
 * idempotency and quota are all decided here, server-side. The request body is never read: the text
 * that gets checked is the stored draft, and the job type and payload are fixed.
 */

import { z } from 'zod'
import type { Hono } from 'hono'
import { RECORD_NOT_FOUND } from 'deepspace/worker'
import type { ActionTools } from 'deepspace/worker'
import { CONFIG } from '../engine/config'
import { sha256hex, versionId as deriveVersionId } from '../engine/ids'
import { overQuota } from '../engine/quota'
import type { AppContext, Env } from '../../worker.js'

export interface CheckRouteDeps {
  resolveAuth: (req: Request, env: Env) => Promise<{ userId: string } | null>
  resolveRole: (env: Env, userId: string) => Promise<string | null>
  records: (env: Env) => Pick<ActionTools, 'get' | 'query' | 'create' | 'update'>
  enqueue: (
    env: Env,
    type: string,
    payload: unknown,
    options: { maxAttempts: number; enqueuedBy: string },
  ) => Promise<string>
  now?: () => Date
}

const DraftRow = z.object({
  body: z.string().default(''),
  // json column: the SDK stores either an array or a JSON string.
  collaborators: z.union([z.array(z.string()), z.string()]).nullish(),
})
const VersionRow = z.object({ status: z.string(), jobId: z.string().default(''), requestedAt: z.string().default('') })
const KbStateRow = z.object({ version: z.number().default(0) })
const QuotaRow = z.object({ requestedAt: z.string().default('') })

function collaboratorIds(raw: z.infer<typeof DraftRow>['collaborators']): string[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return z.array(z.string()).parse(parsed)
  } catch {
    return []
  }
}

export function registerCheckRoutes(app: Hono<AppContext>, deps: CheckRouteDeps): void {
  app.post('/api/drafts/:draftId/check', async (c) => {
    const auth = await deps.resolveAuth(c.req.raw, c.env)
    if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    const role = await deps.resolveRole(c.env, auth.userId)
    if (role !== 'member' && role !== 'admin') return c.json({ error: 'Forbidden' }, 403)

    const records = deps.records(c.env)
    const now = (deps.now ?? ((): Date => new Date()))()
    const draftId = c.req.param('draftId')

    // A hidden draft and a missing one are indistinguishable.
    const notFound = (): Response => c.json({ error: 'Draft not found' }, 404)
    const found = await records.get('drafts', draftId)
    if (!found.success) {
      // Only a genuinely missing row is a 404; a storage failure must not look like "no such draft".
      if (!found.error.includes(RECORD_NOT_FOUND)) return c.json({ error: 'Storage unavailable' }, 503)
      return notFound()
    }
    const draft = DraftRow.parse(found.data.record.data)
    const allowed =
      role === 'admin' ||
      found.data.record.createdBy === auth.userId ||
      collaboratorIds(draft.collaborators).includes(auth.userId)
    if (!allowed) return notFound()

    if (draft.body.length > CONFIG.limits.maxBodyChars) return c.json({ error: 'Draft is too long to check' }, 413)

    const kbRes = await records.get('kb_state', 'global')
    if (!kbRes.success && !kbRes.error.includes(RECORD_NOT_FOUND)) return c.json({ error: 'Storage unavailable' }, 503)
    const kbVersion = kbRes.success ? KbStateRow.parse(kbRes.data.record.data).version : 0
    const versionId = await deriveVersionId(draftId, draft.body, kbVersion)

    // Same body and docs version: serve the existing result (before the quota, it costs nothing).
    const existing = await records.get('draft_versions', versionId)
    if (existing.success) {
      const version = VersionRow.parse(existing.data.record.data)
      const ageMs = now.getTime() - Date.parse(version.requestedAt) // NaN when missing or unparseable
      if (version.status === 'checked') return c.json({ versionId, cached: true }, 200)
      // A `checking` row whose job never finished (no timestamp counts as dead) is re-run below.
      if (version.status === 'checking' && ageMs <= CONFIG.job.checkingStaleMs) {
        return c.json({ versionId, jobId: version.jobId }, 202)
      }
      // A failed check may not be retried immediately; after the cooldown it re-runs (and counts toward quota).
      if (version.status === 'failed' && ageMs < CONFIG.job.failedRetryCooldownMs) {
        return c.json({ error: 'Check failed recently; try again shortly' }, 429)
      }
    }

    // The count and the later write are not atomic: parallel POSTs on different drafts can exceed the
    // limit by the number in flight. Accepted (bounded, small).
    // Newest first and bounded to the limit: enough to decide, and an old history cannot hide recent checks.
    const recent = await records.query('draft_versions', {
      where: { requestedBy: auth.userId },
      orderBy: 'requestedAt',
      orderDir: 'desc',
      limit: CONFIG.limits.checksPerUserPerDay,
    })
    if (!recent.success) return c.json({ error: 'Could not check quota' }, 503)
    if (overQuota(recent.data.records.map((r) => QuotaRow.parse(r.data)), now)) {
      return c.json({ error: 'Daily check limit reached' }, 429)
    }

    // Known gap: two concurrent POSTs for a brand-new versionId can both enqueue (the records API has
    // no compare-and-set); the UI disables the button while a check runs.
    const created = await records.create(
      'draft_versions',
      {
        draftId,
        body: draft.body,
        bodyHash: await sha256hex(draft.body),
        kbVersion,
        status: 'checking',
        requestedBy: auth.userId,
        requestedAt: now.toISOString(),
        mode: 'full',
        jobId: '',
      },
      versionId,
    )
    if (!created.success) return c.json({ error: 'Could not start the check' }, 500)

    let jobId: string
    try {
      jobId = await deps.enqueue(
        c.env,
        'verify-draft',
        { draftId, versionId, mode: 'full' },
        { maxAttempts: CONFIG.job.verifyMaxAttempts, enqueuedBy: auth.userId },
      )
    } catch (err) {
      console.error('[check] enqueue failed:', String(err))
      // Never leave the version stuck `checking` with no job behind it.
      try {
        const res = await records.update('draft_versions', versionId, { status: 'failed' })
        if (!res.success) console.error('[check] could not mark version failed:', res.error)
      } catch (e) {
        console.error('[check] could not mark version failed:', String(e))
      }
      return c.json({ error: 'Could not start the check' }, 500)
    }
    const linked = await records.update('draft_versions', versionId, { jobId })
    if (!linked.success) console.error('[check] could not store jobId on version:', linked.error)
    return c.json({ jobId, versionId }, 202)
  })
}
