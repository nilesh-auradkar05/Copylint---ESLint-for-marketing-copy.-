import { describe, expect, it } from 'vitest'
import { locateQuote, segmentBySpans } from './spans'
import fixture from '../../eval/fixtures/review-room.json'
import seedThread from '../../seed/launch-thread.md?raw'

type Verdict = 'supported' | 'contradicted' | 'unsupported'
type SpanClaim = { id: string; span: [number, number]; verdict: Verdict }

const claim = (id: string, start: number, end: number, verdict: Verdict): SpanClaim => ({ id, span: [start, end], verdict })

/** The matched text, read from the ORIGINAL body (offsets must index into it). */
function matched(body: string, quote: string, from?: number): string | null {
  const r = from === undefined ? locateQuote(body, quote) : locateQuote(body, quote, from)
  return r === null ? null : body.slice(r[0], r[1])
}

describe('locateQuote', () => {
  it('[T-003.3] exact match returns [start, end) offsets into the body', () => {
    const body = 'Intro line. Deploy to Vercel in one command. Outro.'
    const r = locateQuote(body, 'Deploy to Vercel')
    expect(r).toEqual([12, 28])
    expect(body.slice(r![0], r![1])).toBe('Deploy to Vercel')
  })

  it('[T-003.3] returns null when the quote is absent', () => {
    expect(locateQuote('DeepSpace deploys to app.space.', 'Deploy to Vercel')).toBeNull()
    expect(locateQuote('', 'anything')).toBeNull()
  })

  it('[T-003.3] returns null when the quote is longer than the body', () => {
    expect(locateQuote('short', 'short and then some more text')).toBeNull()
  })

  it('[T-003.3] a repeated substring resolves to the first occurrence by default', () => {
    expect(locateQuote('foo bar foo bar', 'foo')).toEqual([0, 3])
  })

  it('[T-003.3] a repeated substring honors `from` and returns the next occurrence', () => {
    const body = 'foo bar foo bar foo'
    expect(locateQuote(body, 'foo', 1)).toEqual([8, 11])
    expect(locateQuote(body, 'foo', 9)).toEqual([16, 19])
    expect(locateQuote(body, 'foo', 8)).toEqual([8, 11])
  })

  it('[T-003.3] when nothing is found at or after `from`, it falls back to searching from 0', () => {
    const body = 'foo bar baz'
    expect(locateQuote(body, 'foo', 5)).toEqual([0, 3])
  })

  it('[T-003.3] `from` beyond the body length still falls back to 0 instead of throwing', () => {
    expect(locateQuote('foo bar', 'bar', 500)).toEqual([4, 7])
  })

  it('[T-003.3] an exact match later in the body beats a whitespace-variant match earlier (exact is step 1)', () => {
    const body = 'x  y and then x y'
    // Exact "x y" only occurs at 14; the whitespace-variant "x  y" at 0 is a fallback.
    expect(locateQuote(body, 'x y')).toEqual([14, 17])
  })

  it('[T-003.3] whitespace variant: runs of spaces in the body match single spaces in the quote', () => {
    const body = 'We say: deploy  to   Vercel in one command.'
    expect(matched(body, 'deploy to Vercel')).toBe('deploy  to   Vercel')
  })

  it('[T-003.3] whitespace variant: newlines and tabs in the body match single spaces in the quote', () => {
    const body = 'First line\n\ndeploy\tto\nVercel in one command'
    expect(matched(body, 'deploy to Vercel')).toBe('deploy\tto\nVercel')
  })

  it('[T-003.3] whitespace variant: extra whitespace in the quote matches single spaces in the body', () => {
    const body = 'Then deploy to Vercel today'
    expect(matched(body, 'deploy   to  Vercel')).toBe('deploy to Vercel')
  })

  it('[T-003.3] whitespace variant: non-breaking spaces count as whitespace', () => {
    const body = 'Then deploy to Vercel today'
    expect(matched(body, 'deploy to Vercel')).toBe('deploy to Vercel')
  })

  it('[T-003.3] whitespace variant: returned offsets index the ORIGINAL body even after earlier collapsed runs', () => {
    const body = 'a    b     c\n\n\nd   e   f  deploy   to   Vercel  end'
    const r = locateQuote(body, 'deploy to Vercel')
    expect(r).not.toBeNull()
    expect(r![0]).toBe(body.indexOf('deploy'))
    expect(r![1]).toBe(body.indexOf('Vercel') + 'Vercel'.length)
    expect(body.slice(r![0], r![1])).toBe('deploy   to   Vercel')
  })

  it('[T-003.3] the whitespace-variant match does not swallow surrounding whitespace', () => {
    const body = 'before   deploy  to  Vercel   after'
    const text = matched(body, 'deploy to Vercel')
    expect(text).toBe('deploy  to  Vercel')
  })

  it('[T-003.3] curly quotes in the body match straight quotes in the quote', () => {
    const body = 'Worried about costs? Visitors can’t run up your bill and “paid” APIs are gated.'
    expect(matched(body, "can't run up your bill")).toBe('can’t run up your bill')
    expect(matched(body, '"paid" APIs')).toBe('“paid” APIs')
  })

  it('[T-003.3] straight quotes in the body match curly quotes in the quote', () => {
    const body = `Visitors can't run up your bill and "paid" APIs are gated.`
    expect(matched(body, 'can’t run up your bill')).toBe("can't run up your bill")
    expect(matched(body, '“paid” APIs')).toBe('"paid" APIs')
  })

  it('[T-003.3] curly single quotes (open and close) match a straight apostrophe', () => {
    const body = 'He said ‘hello’ twice'
    expect(matched(body, "'hello'")).toBe('‘hello’')
  })

  it('[T-003.3] curly quotes combined with a whitespace variant', () => {
    const body = 'Anonymous   visitors\ncan’t   run up your bill.'
    expect(matched(body, "Anonymous visitors can't run up your bill")).toBe(
      'Anonymous   visitors\ncan’t   run up your bill',
    )
  })

  it('[T-003.3] a normalized fallback that still does not appear returns null', () => {
    expect(locateQuote('Visitors  can’t run up bills', "can't run up your bill")).toBeNull()
  })
})

describe('segmentBySpans', () => {
  const join = (segs: Array<{ text: string }>) => segs.map((s) => s.text).join('')
  const ids = (s: { claimIds: string[] }) => [...s.claimIds].sort()

  it('[T-003.4] an empty claims list yields one segment covering the whole body with verdict null', () => {
    const body = 'Just some text with no claims.'
    expect(segmentBySpans(body, [])).toEqual([{ text: body, claimIds: [], verdict: null }])
  })

  it('[T-003.4] a single span splits the body into before / claim / after, covering it exactly once', () => {
    const body = '0123456789ABCDEFGHIJ'
    const segs = segmentBySpans(body, [claim('a', 5, 10, 'supported')])
    expect(segs).toEqual([
      { text: '01234', claimIds: [], verdict: null },
      { text: '56789', claimIds: ['a'], verdict: 'supported' },
      { text: 'ABCDEFGHIJ', claimIds: [], verdict: null },
    ])
    expect(join(segs)).toBe(body)
  })

  it('[T-003.4] a span at the very start or very end produces no empty segment', () => {
    const body = '0123456789'
    const start = segmentBySpans(body, [claim('a', 0, 4, 'unsupported')])
    expect(start.map((s) => s.text)).toEqual(['0123', '456789'])
    const end = segmentBySpans(body, [claim('a', 6, 10, 'unsupported')])
    expect(end.map((s) => s.text)).toEqual(['012345', '6789'])
    const whole = segmentBySpans(body, [claim('a', 0, 10, 'contradicted')])
    expect(whole).toEqual([{ text: body, claimIds: ['a'], verdict: 'contradicted' }])
  })

  it('[T-003.4] segments appear in body order even when claims are passed out of order', () => {
    const body = 'aaaaabbbbbcccccddddd'
    const segs = segmentBySpans(body, [claim('late', 15, 20, 'supported'), claim('early', 0, 5, 'contradicted')])
    expect(join(segs)).toBe(body)
    expect(segs).toEqual([
      { text: 'aaaaa', claimIds: ['early'], verdict: 'contradicted' },
      { text: 'bbbbbccccc', claimIds: [], verdict: null },
      { text: 'ddddd', claimIds: ['late'], verdict: 'supported' },
    ])
  })

  it('[T-003.4] adjacent (touching) spans stay separate and in order', () => {
    const body = 'AAAAABBBBB'
    const segs = segmentBySpans(body, [claim('a', 0, 5, 'supported'), claim('b', 5, 10, 'contradicted')])
    expect(segs).toEqual([
      { text: 'AAAAA', claimIds: ['a'], verdict: 'supported' },
      { text: 'BBBBB', claimIds: ['b'], verdict: 'contradicted' },
    ])
  })

  it('[T-003.4] a gap between spans is a null-verdict segment', () => {
    const body = 'AAAA--BBBB'
    const segs = segmentBySpans(body, [claim('a', 0, 4, 'supported'), claim('b', 6, 10, 'supported')])
    expect(segs.map((s) => [s.text, s.verdict])).toEqual([
      ['AAAA', 'supported'],
      ['--', null],
      ['BBBB', 'supported'],
    ])
  })

  it('[T-003.4] overlapping spans are split at the overlap and the overlap takes the higher-priority verdict', () => {
    const body = '0123456789ABCDE'
    const segs = segmentBySpans(body, [claim('a', 0, 10, 'supported'), claim('b', 5, 15, 'contradicted')])
    expect(join(segs)).toBe(body)
    expect(segs.map((s) => s.text)).toEqual(['01234', '56789', 'ABCDE'])
    expect(segs.map((s) => s.verdict)).toEqual(['supported', 'contradicted', 'contradicted'])
    expect(segs.map(ids)).toEqual([['a'], ['a', 'b'], ['b']])
  })

  it('[T-003.4] overlapping spans resolve contradicted > unsupported > supported', () => {
    const body = '0123456789'
    const pairs: Array<[Verdict, Verdict, Verdict]> = [
      ['supported', 'unsupported', 'unsupported'],
      ['unsupported', 'supported', 'unsupported'],
      ['supported', 'contradicted', 'contradicted'],
      ['contradicted', 'supported', 'contradicted'],
      ['unsupported', 'contradicted', 'contradicted'],
      ['contradicted', 'unsupported', 'contradicted'],
    ]
    for (const [va, vb, winner] of pairs) {
      const segs = segmentBySpans(body, [claim('a', 0, 10, va), claim('b', 3, 7, vb)])
      expect(join(segs)).toBe(body)
      const overlap = segs.find((s) => s.text === '3456')
      expect(overlap?.verdict, `${va} + ${vb}`).toBe(winner)
      expect(overlap ? ids(overlap) : []).toEqual(['a', 'b'])
    }
  })

  it('[T-003.4] three-way overlap: contradicted beats unsupported beats supported', () => {
    const body = '0123456789'
    const segs = segmentBySpans(body, [
      claim('s', 0, 10, 'supported'),
      claim('u', 2, 8, 'unsupported'),
      claim('c', 4, 6, 'contradicted'),
    ])
    expect(join(segs)).toBe(body)
    expect(segs.map((x) => [x.text, x.verdict])).toEqual([
      ['01', 'supported'],
      ['23', 'unsupported'],
      ['45', 'contradicted'],
      ['67', 'unsupported'],
      ['89', 'supported'],
    ])
    expect(ids(segs[2])).toEqual(['c', 's', 'u'])
  })

  it('[T-003.4] two claims with identical spans share one segment listing both ids, higher priority wins', () => {
    const body = 'xxAAAAyy'
    const segs = segmentBySpans(body, [claim('a', 2, 6, 'supported'), claim('b', 2, 6, 'contradicted')])
    expect(segs).toHaveLength(3)
    expect(segs[1].text).toBe('AAAA')
    expect(segs[1].verdict).toBe('contradicted')
    expect(ids(segs[1])).toEqual(['a', 'b'])
  })

  it('[T-003.4] concatenated segment text always equals the body (messy mix of gaps, overlaps, adjacency)', () => {
    const body = 'The quick brown fox jumps over the lazy dog and keeps running far away.'
    const claims = [
      claim('1', 4, 15, 'supported'),
      claim('2', 10, 25, 'unsupported'),
      claim('3', 25, 31, 'contradicted'),
      claim('4', 45, 70, 'supported'),
      claim('5', 60, body.length, 'contradicted'),
    ]
    const segs = segmentBySpans(body, claims)
    expect(join(segs)).toBe(body)
    for (const s of segs) expect(s.text.length).toBeGreaterThan(0)
    // every claim id appears in at least one segment
    const seen = new Set(segs.flatMap((s) => s.claimIds))
    for (const c of claims) expect(seen.has(c.id)).toBe(true)
  })

  it('[T-003.4] uncovered text is verdict null and has no claim ids; covered text has at least one id', () => {
    const body = 'plain claimed plain'
    const segs = segmentBySpans(body, [claim('a', 6, 13, 'unsupported')])
    for (const s of segs) {
      if (s.verdict === null) expect(s.claimIds).toEqual([])
      else expect(s.claimIds.length).toBeGreaterThan(0)
    }
    expect(join(segs)).toBe(body)
  })

  it('[T-003.4] does not mutate the claims array it is given', () => {
    const claims = [claim('b', 5, 10, 'supported'), claim('a', 0, 6, 'contradicted')]
    const snapshot = JSON.stringify(claims)
    segmentBySpans('0123456789', claims)
    expect(JSON.stringify(claims)).toBe(snapshot)
  })
})

describe('eval/fixtures/review-room.json (Lane B fixture)', () => {
  const versionById = new Map(fixture.versions.map((v) => [v.recordId, v]))

  it('[T-003.3] has 2 versions, 5 claims and 2 signoffs, all in the record-envelope shape', () => {
    expect(fixture.versions).toHaveLength(2)
    expect(fixture.claims).toHaveLength(5)
    expect(fixture.signoffs).toHaveLength(2)
    for (const r of [fixture.draft, ...fixture.versions, ...fixture.claims, ...fixture.signoffs, fixture.kbState]) {
      expect(Object.keys(r).sort()).toEqual(['createdAt', 'createdBy', 'data', 'recordId', 'updatedAt'])
    }
  })

  it('[T-003.3] the oldest version body is the seed launch thread', () => {
    const bodies = fixture.versions.map((v) => v.data.body.trim())
    expect(bodies).toContain(seedThread.trim())
  })

  it('[T-003.3] every claim span locates its quote in that version\'s body, exactly', () => {
    for (const c of fixture.claims) {
      const v = versionById.get(c.data.versionId)
      expect(v, `claim ${c.recordId} references a version in the fixture`).toBeDefined()
      const body = v!.data.body
      const [start, end] = c.data.span
      expect(body.slice(start, end), `claim ${c.recordId} span slice`).toBe(c.data.quote)
      expect(locateQuote(body, c.data.quote), `claim ${c.recordId} locateQuote`).toEqual([start, end])
    }
  })

  it('[T-003.4] segmentBySpans over each fixture version reproduces its body', () => {
    for (const v of fixture.versions) {
      const claims: SpanClaim[] = fixture.claims
        .filter((c) => c.data.versionId === v.recordId)
        .map((c) => ({ id: c.recordId, span: [c.data.span[0], c.data.span[1]], verdict: c.data.verdict as Verdict }))
      const segs = segmentBySpans(v.data.body, claims)
      expect(segs.map((s) => s.text).join('')).toBe(v.data.body)
    }
  })
})
