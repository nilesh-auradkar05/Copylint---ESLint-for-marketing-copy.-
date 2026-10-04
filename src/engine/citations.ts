import type { JudgeOut } from './contracts'

/** Enforces SPEC 4.5 rules 1-4, in order. Pure: returns a new object. */
export function validateJudge(out: JudgeOut, retrievedIds: readonly string[]): JudgeOut {
  const retrieved = new Set(retrievedIds)
  // Rule 1: drop cited ids that were not retrieved for this claim.
  const citedChunkIds = out.citedChunkIds.filter((id) => retrieved.has(id))
  let { verdict, confidence, fix } = out
  // Rule 2: a supported/contradicted verdict needs at least one valid citation.
  if (verdict !== 'unsupported' && citedChunkIds.length === 0) {
    verdict = 'unsupported'
    confidence = 'low'
  }
  // Rules 3 and 4: only a contradicted verdict may carry a fix (null stays null).
  if (verdict !== 'contradicted') fix = null
  return { verdict, citedChunkIds, reason: out.reason, fix, confidence }
}
