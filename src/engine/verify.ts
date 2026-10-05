/**
 * `verify-draft` (SPEC §5): extract claims from the frozen version body, retrieve evidence and judge
 * each claim (bounded concurrency), write one `claims` row per claim, then mark the version checked.
 * All I/O comes in through `VerifyDeps`.
 *
 * Retry-safe: a version already `checked` is a no-op summary; claims already stored for the version
 * are not judged again; and a `Duplicate:` refusal from the `uniqueOn ['versionId','claimHash']`
 * constraint counts as written. The version only becomes `failed` on the last attempt.
 */

import { z } from 'zod'
import type { ActionResult, ActionTools, KnowledgeClient } from 'deepspace/worker'
import { CONFIG } from './config'
import { VerifyJobPayload } from './contracts'
import type { Evidence } from './contracts'
import { extractClaims } from './extract'
import type { ExtractedClaim } from './extract'
import { judgeClaim } from './judge'
import { retrieve } from './retrieve'

/** Model boundary. Returns the parsed but UNVALIDATED output; the engine validates it with zod. */
export type GenerateFn = (req: {
  model: string
  system: string
  prompt: string
  schema: z.ZodType
  maxOutputTokens?: number
  abortSignal?: AbortSignal
}) => Promise<unknown>

export interface VerifyDeps {
  generate: GenerateFn
  kb: Pick<KnowledgeClient, 'search'>
  records: Pick<ActionTools, 'get' | 'query' | 'create' | 'update'>
}

export interface VerifyResult {
  claims: number
  byVerdict: { supported: number; contradicted: number; unsupported: number }
  dropped: number
  carriedForward: number
  ms: number
}

const StoredVersion = z.object({ body: z.string(), status: z.string() })
const StoredClaim = z.object({ claimHash: z.string(), verdict: z.enum(['supported', 'contradicted', 'unsupported']) })

/** An infrastructure failure from the record tools fails (and retries) the job. */
function must<T>(what: string, result: ActionResult<T>): T {
  if (!result.success) throw new Error(`${what}: ${result.error}`)
  return result.data
}

async function storedClaims(records: VerifyDeps['records'], versionId: string) {
  const res = must('read claims', await records.query('claims', { where: { versionId } }))
  return res.records.map((r) => StoredClaim.parse(r.data))
}

function tally(rows: Array<{ verdict: 'supported' | 'contradicted' | 'unsupported' }>): Pick<VerifyResult, 'claims' | 'byVerdict'> {
  const byVerdict = { supported: 0, contradicted: 0, unsupported: 0 }
  for (const r of rows) byVerdict[r.verdict] += 1
  return { claims: rows.length, byVerdict }
}

export async function verifyDraft(
  deps: VerifyDeps,
  job: { id: string; payload: unknown; attempts: number; maxAttempts: number },
  ctx: { progress: (fraction: number, message?: string) => void; signal: AbortSignal },
): Promise<VerifyResult> {
  const startedAt = Date.now()
  const payload = VerifyJobPayload.parse(job.payload)
  const { records } = deps
  const { draftId, versionId } = payload

  const version = StoredVersion.parse(must(`read draft_versions/${versionId}`, await records.get('draft_versions', versionId)).record.data)
  if (version.status === 'checked') {
    return { ...tally(await storedClaims(records, versionId)), dropped: 0, carriedForward: 0, ms: Date.now() - startedAt }
  }

  try {
    if (payload.mode === 'reverify') throw new Error('verify-draft mode "reverify" is not implemented (T-020)')

    ctx.progress(0, 'extracting claims')
    const { claims, dropped } = await extractClaims({ generate: deps.generate, signal: ctx.signal }, version.body)

    // A retry never judges (or pays for) a claim that an earlier attempt already stored.
    const done = new Set((await storedClaims(records, versionId)).map((c) => c.claimHash))
    const queue = claims.filter((c) => !done.has(c.claimHash))
    let finished = claims.length - queue.length

    async function judgeAndWrite(claim: ExtractedClaim): Promise<void> {
      ctx.signal.throwIfAborted() // kb.search takes no signal, so check before every retrieval
      const { chunks } = await retrieve(deps.kb, claim.text)
      const verdict = await judgeClaim({ generate: deps.generate, signal: ctx.signal }, claim.text, chunks)
      const evidence: Evidence[] = verdict.citedChunkIds.flatMap((id) => {
        const chunk = chunks.find((c) => c.chunkId === id)
        return chunk ? [{ chunkId: id, page: chunk.page, excerpt: chunk.text.slice(0, CONFIG.limits.excerptChars) }] : []
      })
      const res = await records.create('claims', {
        versionId,
        draftId,
        claimHash: claim.claimHash,
        text: claim.text,
        quote: claim.quote,
        span: claim.span,
        kind: claim.kind,
        verdict: verdict.verdict,
        confidence: verdict.confidence,
        evidence,
        reason: verdict.reason,
        fix: verdict.fix ?? '',
      })
      if (!res.success && !res.error.startsWith('Duplicate:')) throw new Error(`write claims: ${res.error}`)
    }

    // Small worker pool: `judgeConcurrency` loops pull from a shared cursor; one failure stops new work.
    let next = 0
    let failed = false
    const worker = async (): Promise<void> => {
      while (!failed && next < queue.length) {
        const claim = queue[next++]
        try {
          await judgeAndWrite(claim)
        } catch (err) {
          failed = true
          throw err
        }
        finished += 1
        ctx.progress(finished / claims.length, `judged ${finished}/${claims.length}`)
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONFIG.limits.judgeConcurrency, queue.length) }, worker))
    if (queue.length === 0) ctx.progress(1, `judged ${claims.length}/${claims.length}`)

    must(`update draft_versions/${versionId}`, await records.update('draft_versions', versionId, { status: 'checked' }))
    must(`update drafts/${draftId}`, await records.update('drafts', draftId, { latestVersionId: versionId }))

    return { ...tally(await storedClaims(records, versionId)), dropped, carriedForward: 0, ms: Date.now() - startedAt }
  } catch (err) {
    if (job.attempts >= job.maxAttempts) {
      // Never mask the original error with a failure to record it.
      try {
        const res = await records.update('draft_versions', versionId, { status: 'failed' })
        if (!res.success) console.error('[verify-draft] could not mark version failed:', res.error)
      } catch (e) {
        console.error('[verify-draft] could not mark version failed:', String(e))
      }
    }
    throw err
  }
}
