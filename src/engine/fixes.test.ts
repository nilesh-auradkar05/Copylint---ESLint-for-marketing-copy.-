import { describe, expect, it } from 'vitest'
import { applyFixes } from './fixes'

type Verdict = 'supported' | 'contradicted' | 'unsupported'
type FixClaim = { id: string; verdict: Verdict; quote: string; span: [number, number]; fix?: string | null }

/** Claim whose span is the nth (0-based) occurrence of `quote` in `body`. */
function claim(body: string, id: string, quote: string, fix: string | null | undefined, nth = 0, verdict: Verdict = 'contradicted'): FixClaim {
  let from = -1
  for (let i = 0; i <= nth; i++) from = body.indexOf(quote, from + 1)
  return { id, verdict, quote, span: [from, from + quote.length], fix }
}

describe('applyFixes', () => {
  it('[T-013.1] replaces only the occurrence at the claim span when the quote appears twice', () => {
    const body = 'Deploy takes 10 minutes. Deploy takes 10 minutes. Done.'
    const c = claim(body, 'c2', 'Deploy takes 10 minutes', 'Deploy takes under a minute', 1)
    const r = applyFixes(body, [c])
    expect(r.body).toBe('Deploy takes 10 minutes. Deploy takes under a minute. Done.')
    expect(r.applied).toEqual(['c2'])
    expect(r.skipped).toEqual([])
  })

  it('[T-013.1] ignores non-contradicted claims and empty/null/missing/whitespace fixes entirely', () => {
    const body = 'A one. B two. C three. D four. E five. F six.'
    const claims: FixClaim[] = [
      claim(body, 's', 'A one', 'X', 0, 'supported'),
      claim(body, 'u', 'B two', 'X', 0, 'unsupported'),
      claim(body, 'n', 'C three', null),
      claim(body, 'e', 'D four', ''),
      claim(body, 'm', 'E five', undefined),
      claim(body, 'w', 'F six', '   \n'),
    ]
    expect(applyFixes(body, claims)).toEqual({ body, applied: [], skipped: [] })
  })

  it('[T-013.3] skips a candidate whose span no longer matches the edited body', () => {
    const original = 'Intro. Deploy takes 10 minutes. Outro.'
    const c = claim(original, 'c1', 'Deploy takes 10 minutes', 'Deploy is instant')
    const edited = 'A brand new intro paragraph. ' + original
    expect(applyFixes(edited, [c])).toEqual({ body: edited, skipped: ['c1'], applied: [] })
  })

  it('[T-013.3] skips out-of-range, negative and reversed spans without throwing', () => {
    const body = 'Short body with a quote.'
    const base = { verdict: 'contradicted' as const, quote: 'quote', fix: 'fixed' }
    const claims: FixClaim[] = [
      { ...base, id: 'oob', span: [500, 505] },
      { ...base, id: 'neg', span: [-5, 0] },
      { ...base, id: 'rev', span: [19, 14] },
    ]
    let r: ReturnType<typeof applyFixes> | undefined
    expect(() => { r = applyFixes(body, claims) }).not.toThrow()
    expect(r!.body).toBe(body)
    expect(r!.applied).toEqual([])
    expect([...r!.skipped].sort()).toEqual(['neg', 'oob', 'rev'])
  })

  it('[T-013.1] applies several fixes of different lengths with no offset drift, in any claims order', () => {
    const body = 'Alpha is slow. Beta is also slow. Gamma is slow too.'
    const a = claim(body, 'a', 'Alpha is slow', 'Alpha is fast and cheap and reliable')
    const b = claim(body, 'b', 'Beta is also slow', 'Beta ok')
    const g = claim(body, 'g', 'Gamma is slow too', 'G')
    const expected = 'Alpha is fast and cheap and reliable. Beta ok. G.'
    for (const order of [[a, b, g], [g, b, a], [b, g, a]]) {
      const r = applyFixes(body, order)
      expect(r.body).toBe(expected)
      expect(r.applied).toEqual(['a', 'b', 'g'])
      expect(r.skipped).toEqual([])
    }
  })

  it('[T-013.1] on overlapping spans applies the earlier-start claim and skips the other', () => {
    const body = 'Deploy to Vercel in one command.'
    const outer = claim(body, 'outer', 'Deploy to Vercel in one command', 'Deploy with `deepspace deploy`')
    const inner = claim(body, 'inner', 'Vercel in one', 'XXX')
    const r = applyFixes(body, [inner, outer])
    expect(r.body).toBe('Deploy with `deepspace deploy`.')
    expect(r.applied).toEqual(['outer'])
    expect(r.skipped).toEqual(['inner'])
  })

  it('[T-013.1] returns the body unchanged with empty lists when there are no candidates', () => {
    expect(applyFixes('Nothing to fix.', [])).toEqual({ body: 'Nothing to fix.', applied: [], skipped: [] })
  })

  it('[T-013.3] orders applied and skipped by span start, not by input order', () => {
    const body = 'one 1. two 2. three 3. four 4.'
    const c1 = claim(body, 'c1', 'one 1', 'ONE')
    const c2 = claim(body, 'c2', 'two 2', 'TWO')
    const c3 = { ...claim(body, 'c3', 'three 3', 'THREE'), quote: 'stale text' }
    const c4 = { ...claim(body, 'c4', 'four 4', 'FOUR'), quote: 'also stale' }
    const r = applyFixes(body, [c4, c2, c3, c1])
    expect(r.applied).toEqual(['c1', 'c2'])
    expect(r.skipped).toEqual(['c3', 'c4'])
    expect(r.body).toBe('ONE. TWO. three 3. four 4.')
  })

  it('[T-013.1] does not mutate the input claims array or its objects', () => {
    const body = 'Deploy takes 10 minutes.'
    const claims = [claim(body, 'c1', 'Deploy takes 10 minutes', 'Deploy is instant')]
    const snapshot = structuredClone(claims)
    const frozen = Object.freeze(claims.map((c) => Object.freeze({ ...c, span: Object.freeze([...c.span]) as unknown as [number, number] })))
    applyFixes(body, frozen)
    expect(claims).toEqual(snapshot)
    expect(frozen.map((c) => ({ ...c, span: [...c.span] }))).toEqual(snapshot)
  })
})
