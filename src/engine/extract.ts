/** Claim extraction (SPEC §4.6): model -> zod -> dedupe -> locate quotes ourselves -> cap. */

import { CONFIG } from './config'
import { ExtractOut } from './contracts'
import type { ClaimKind } from './contracts'
import { claimHash } from './ids'
import { EXTRACT_SYSTEM, extractUserPrompt, generateValidated } from './prompts'
import { locateQuote } from './spans'
import type { GenerateFn } from './verify'

export interface ExtractedClaim {
  text: string
  quote: string
  kind: ClaimKind
  claimHash: string
  span: [number, number]
}

export async function extractClaims(
  deps: { generate: GenerateFn; signal?: AbortSignal },
  body: string,
): Promise<{ claims: ExtractedClaim[]; dropped: number }> {
  const out = await generateValidated(deps, {
    model: CONFIG.models.extract,
    system: EXTRACT_SYSTEM,
    prompt: extractUserPrompt(body),
    schema: ExtractOut,
    maxOutputTokens: CONFIG.limits.extractMaxOutputTokens,
  })

  const seen = new Set<string>()
  const claims: ExtractedClaim[] = []
  let dropped = 0
  let from = 0
  for (const c of out.claims) {
    if (claims.length >= CONFIG.limits.maxClaims) break // over-cap is not "dropped"
    const hash = await claimHash(c.text)
    if (seen.has(hash)) continue
    seen.add(hash)
    const span = locateQuote(body, c.quote, from)
    if (span === null) {
      dropped += 1
      continue
    }
    from = span[1]
    claims.push({ text: c.text, quote: c.quote, kind: c.kind, claimHash: hash, span })
  }
  return { claims, dropped }
}
