/**
 * `publishDraft` (SPEC §7, ADR-0003). The only writer of `publications` for a user action.
 * Ship-ready is re-derived here from stored rows; no client flag or client kb version is read.
 * Gate refusals come back as `{ success: true, data: { ok: false, reason, blocking } }` because the SDK's
 * `ActionResult` failure arm cannot carry data. Access and validation refusals are `{ success: false }`.
 */

import { z } from 'zod'
import type { ActionContext, ActionResult } from 'deepspace/worker'
import type { Env } from '../../worker'
import { PublishRequest } from '../engine/contracts'
import { blockingClaims, shipReady } from '../engine/gate'

const StoredDraft = z.object({ body: z.string(), collaborators: z.array(z.string()).nullish() })
const StoredVersion = z.object({
  draftId: z.string(),
  body: z.string(),
  kbVersion: z.number(),
  status: z.enum(['checking', 'checked', 'failed']),
})
const StoredClaim = z.object({ verdict: z.enum(['supported', 'contradicted', 'unsupported']) })
const StoredSignoff = z.object({ claimId: z.string(), decision: z.enum(['approve', 'cut']) })
const StoredKbState = z.object({ version: z.number() })

const fail = (code: string, error: string): ActionResult => ({ success: false, error, code })
const notShipReady = (blocking: string[]): ActionResult => ({
  success: true,
  data: { ok: false, reason: 'not_ship_ready', blocking },
})

/** Collection reads inside an action are infrastructure: a failure aborts with a generic error. */
async function read<T>(result: Promise<ActionResult<T>>): Promise<{ ok: true; data: T } | { ok: false }> {
  const r = await result
  return r.success ? { ok: true, data: r.data } : { ok: false }
}

export async function publishDraft({ userId, params, tools }: ActionContext<Env>): Promise<ActionResult> {
  const parsed = PublishRequest.safeParse(params)
  if (!parsed.success) return fail('invalid_request', 'Invalid publish request.')
  const { draftId, versionId, url } = parsed.data

  // Access first, and with one indistinguishable refusal for "no such draft" and "not yours",
  // so a stranger learns nothing about the draft or its claims.
  const draftRes = await read(tools.get('drafts', draftId))
  const forbidden = fail('forbidden', 'Draft not found.')
  if (!draftRes.ok) return forbidden
  const draftRow = draftRes.data.record
  const draft = StoredDraft.safeParse(draftRow.data)
  if (!draft.success) return forbidden
  const isOwner = draftRow.createdBy === userId
  const isCollaborator = (draft.data.collaborators ?? []).includes(userId)
  if (!isOwner && !isCollaborator) return forbidden

  const versionRes = await read(tools.get('draft_versions', versionId))
  if (!versionRes.ok) return fail('version_not_found', 'Checked version not found.')
  const version = StoredVersion.safeParse(versionRes.data.record.data)
  if (!version.success || version.data.draftId !== draftId) return fail('version_not_found', 'Checked version not found.')

  const [kbRes, claimsRes, signoffsRes] = await Promise.all([
    read(tools.get('kb_state', 'global')),
    // No `limit`: internal record readers are unbounded and a version has at most CONFIG.limits.maxClaims rows.
    read(tools.query('claims', { where: { versionId } })),
    read(tools.query('signoffs', { where: { versionId } })),
  ])
  if (!kbRes.ok || !claimsRes.ok || !signoffsRes.ok) return fail('read_failed', 'Could not verify the draft. Try again.')
  const kb = StoredKbState.safeParse(kbRes.data.record.data)
  if (!kb.success) return fail('read_failed', 'Could not verify the draft. Try again.')

  const claims = claimsRes.data.records.flatMap((r) => {
    const c = StoredClaim.safeParse(r.data)
    return c.success ? [{ id: r.recordId, verdict: c.data.verdict }] : []
  })
  const signoffs = signoffsRes.data.records.flatMap((r) => {
    const s = StoredSignoff.safeParse(r.data)
    return s.success ? [s.data] : []
  })
  // A claim row that cannot be read must block, never be skipped.
  if (claims.length !== claimsRes.data.records.length || signoffs.length !== signoffsRes.data.records.length) {
    return fail('read_failed', 'Could not verify the draft. Try again.')
  }

  const blocking = blockingClaims(claims, signoffs).map((c) => c.id)
  const bodyUnchanged = draft.data.body === version.data.body
  if (!bodyUnchanged || !shipReady(version.data, claims, signoffs, kb.data.version)) return notShipReady(blocking)

  const existing = await read(tools.query('publications', { where: { versionId, url, status: 'live' } }))
  if (!existing.ok) return fail('read_failed', 'Could not verify the draft. Try again.')
  const already = existing.data.records[0]
  if (already) return { success: true, data: { ok: true, publicationId: already.recordId } }

  const created = await tools.create('publications', {
    draftId,
    versionId,
    url,
    status: 'live',
    kbVersionAtPublish: kb.data.version,
  })
  if (!created.success) return fail('write_failed', 'Could not publish. Try again.')
  return { success: true, data: { ok: true, publicationId: created.data.recordId } }
}
