import type { Claim } from './contracts'

type FixClaim = Pick<Claim, 'id' | 'verdict' | 'quote' | 'span' | 'fix'>

/**
 * Replaces each contradicted claim's quote with its suggested fix, at the claim's own span only.
 * A claim whose span no longer matches the body is skipped, never guessed at. Pure; never throws.
 */
export function applyFixes(body: string, claims: ReadonlyArray<FixClaim>): { body: string; applied: string[]; skipped: string[] } {
  const candidates = claims
    .filter((claim) => claim.verdict === 'contradicted' && typeof claim.fix === 'string' && claim.fix.trim() !== '')
    .map((claim) => ({ id: claim.id, quote: claim.quote, start: claim.span[0], end: claim.span[1], fix: (claim.fix as string).trim() }))
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const accepted: typeof candidates = []
  const skipped: string[] = []
  let lastEnd = 0
  for (const candidate of candidates) {
    const { start, end } = candidate
    const valid = Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start < end && end <= body.length && body.slice(start, end) === candidate.quote
    if (valid && start >= lastEnd) {
      accepted.push(candidate)
      lastEnd = end
    } else skipped.push(candidate.id)
  }
  let next = body
  for (const { start, end, fix } of [...accepted].reverse()) next = next.slice(0, start) + fix + next.slice(end)
  return { body: next, applied: accepted.map((candidate) => candidate.id), skipped }
}
