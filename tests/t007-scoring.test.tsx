// Located under tests/ with a .tsx extension only because the root vitest include globs are
// `src/**/*.{test,spec}.{ts,tsx}` and `tests/*.test.tsx`; eval/** is not picked up by `npx vitest run`.
import { describe, expect, it } from 'vitest'
import { formatReport, score } from '../eval/scoring'
import type { EvalRow, Label } from '../eval/scoring'

let n = 0
function row(label: Label, predicted: Label | null, over: Partial<EvalRow> = {}): EvalRow {
  n += 1
  return { id: n, label, predicted, expectedPage: 'p/a', retrievedPages: ['p/a'], claim: `claim ${n}`, ...over }
}

describe('T-007.1 scoring', () => {
  it('[T-007.1] a perfect run has an identity-diagonal matrix, P = R = accuracy = 1 and no misses', () => {
    const s = score([row('supported', 'supported'), row('contradicted', 'contradicted'), row('unsupported', 'unsupported')])
    expect(s.matrix).toEqual({
      supported: { supported: 1, contradicted: 0, unsupported: 0 },
      contradicted: { supported: 0, contradicted: 1, unsupported: 0 },
      unsupported: { supported: 0, contradicted: 0, unsupported: 1 },
    })
    expect(s.contradictedPrecision).toBe(1)
    expect(s.contradictedRecall).toBe(1)
    expect(s.accuracy).toBe(1)
    expect(s.misses).toEqual([])
  })

  it('[T-007.1] mixed case: hand-computed matrix, precision 2/3, recall 2/4, accuracy 5/10', () => {
    const rows = [
      row('contradicted', 'contradicted'),
      row('contradicted', 'contradicted'),
      row('contradicted', 'supported'),
      row('contradicted', 'unsupported'),
      row('supported', 'contradicted'),
      row('supported', 'supported'),
      row('supported', 'supported'),
      row('supported', 'unsupported'),
      row('unsupported', 'unsupported'),
      row('unsupported', 'supported'),
    ]
    const s = score(rows)
    expect(s.matrix.contradicted).toEqual({ supported: 1, contradicted: 2, unsupported: 1 })
    expect(s.matrix.supported).toEqual({ supported: 2, contradicted: 1, unsupported: 1 })
    expect(s.matrix.unsupported).toEqual({ supported: 1, contradicted: 0, unsupported: 1 })
    expect(s.contradictedPrecision).toBeCloseTo(2 / 3, 10)
    expect(s.contradictedRecall).toBeCloseTo(2 / 4, 10)
    expect(s.accuracy).toBeCloseTo(5 / 10, 10)
    expect(s.misses).toHaveLength(5)
  })

  it('[T-007.1] zero denominators give null, never NaN', () => {
    const noContradicted = score([row('supported', 'supported')])
    expect(noContradicted.contradictedPrecision).toBeNull()
    expect(noContradicted.contradictedRecall).toBeNull()
    const none = score([])
    expect(none.accuracy).toBeNull()
    expect(none.contradictedPrecision).toBeNull()
    expect(none.contradictedRecall).toBeNull()
    // gold has contradicted rows but none predicted: precision 0/0, recall 0/1
    const neverPredicted = score([row('contradicted', 'supported')])
    expect(neverPredicted.contradictedPrecision).toBeNull()
    expect(neverPredicted.contradictedRecall).toBe(0)
    // predicted contradicted but no gold contradicted: precision 0/1, recall 0/0
    const falseAlarm = score([row('supported', 'contradicted')])
    expect(falseAlarm.contradictedPrecision).toBe(0)
    expect(falseAlarm.contradictedRecall).toBeNull()
  })

  it('[T-007.4] retrieval miss: gold supported/contradicted, expected page set and not retrieved', () => {
    const s = score([
      row('supported', 'unsupported', { id: 'a', expectedPage: 'x/y', retrievedPages: ['other'] }),
      row('contradicted', 'supported', { id: 'b', expectedPage: 'x/y', retrievedPages: [] }),
    ])
    expect(s.misses.map((m) => [m.id, m.diagnosis])).toEqual([
      ['a', 'retrieval miss'],
      ['b', 'retrieval miss'],
    ])
  })

  it('[T-007.4] judge error: page was retrieved, page is null, or gold is unsupported', () => {
    const s = score([
      row('supported', 'contradicted', { id: 'a', expectedPage: 'x/y', retrievedPages: ['x/y', 'z'] }),
      row('contradicted', 'unsupported', { id: 'b', expectedPage: null, retrievedPages: [] }),
      row('unsupported', 'supported', { id: 'c', expectedPage: 'x/y', retrievedPages: ['other'] }),
    ])
    expect(s.misses.map((m) => [m.id, m.diagnosis])).toEqual([
      ['a', 'judge error'],
      ['b', 'judge error'],
      ['c', 'judge error'],
    ])
  })

  it('[T-007.4] run errors are excluded from the matrix and metrics but counted and listed', () => {
    const s = score([
      row('contradicted', 'contradicted'),
      row('contradicted', null, { id: 'boom', error: 'timeout', claim: 'the failing claim' }),
    ])
    expect(s.counted).toBe(1)
    expect(Object.values(s.matrix).flatMap((r) => Object.values(r)).reduce((a, b) => a + b, 0)).toBe(1)
    expect(s.contradictedRecall).toBe(1)
    expect(s.misses).toEqual([])
    expect(s.runErrors).toEqual([{ id: 'boom', error: 'timeout', claim: 'the failing claim' }])
  })

  it('[T-007.4] report shows matrix, PASS/BELOW against PRD targets, and one line per miss with the claim truncated to 90 chars', () => {
    const long = 'x'.repeat(200)
    const rows = [
      row('contradicted', 'contradicted'),
      row('contradicted', 'supported', { id: 7, expectedPage: 'x/y', retrievedPages: ['q'], claim: long }),
      row('supported', 'supported'),
    ]
    const text = formatReport(score(rows))
    expect(text).toMatch(/Contradicted recall\s+0\.500.*BELOW/)
    expect(text).toMatch(/Contradicted precision\s+1\.000.*PASS/)
    const missLine = text.split('\n').find((l) => l.startsWith('#7 '))
    expect(missLine).toBeDefined()
    expect(missLine).toContain('contradicted→supported | retrieval miss | ')
    const claimPart = missLine!.split(' | ')[2]
    expect(claimPart.length).toBeLessThanOrEqual(90)
    expect(claimPart.startsWith('xxxx')).toBe(true)
    expect(text).not.toContain('NaN')
  })

  it('[T-007.4] report renders null metrics as n/a and lists run errors', () => {
    const text = formatReport(score([row('supported', null, { id: 'e1', error: 'timeout' })]))
    expect(text).not.toContain('NaN')
    expect(text).toMatch(/n\/a/)
    expect(text).toContain('#e1')
  })
})
