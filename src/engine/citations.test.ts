import { describe, expect, it } from 'vitest'
import { validateJudge } from './citations'
import { JudgeOut } from './contracts'

type Out = {
  verdict: 'supported' | 'contradicted' | 'unsupported'
  citedChunkIds: string[]
  reason: string
  fix: string | null
  confidence: 'high' | 'medium' | 'low'
}

const retrieved = ['c0', 'c1', 'c2']

const judge = (over: Partial<Out> = {}): Out => ({
  verdict: 'supported',
  citedChunkIds: ['c0'],
  reason: 'The docs state this directly.',
  fix: null,
  confidence: 'high',
  ...over,
})

describe('validateJudge rule 1: drop cited ids that were not retrieved', () => {
  it('[T-003.5] foreign chunk ids are dropped, valid ones kept in order', () => {
    const r = validateJudge(judge({ citedChunkIds: ['c9', 'c2', 'zzz', 'c0'] }), retrieved)
    expect(r.citedChunkIds).toEqual(['c2', 'c0'])
    expect(r.verdict).toBe('supported')
    expect(r.confidence).toBe('high')
  })

  it('[T-003.5] a fully valid citation list is returned unchanged', () => {
    const input = judge({ citedChunkIds: ['c0', 'c1'], confidence: 'medium' })
    expect(validateJudge(input, retrieved)).toEqual(input)
  })

  it('[T-003.5] an id from a different claim\'s retrieval is treated as foreign', () => {
    // c4 exists in some other claim's retrieved set, but not this one's.
    const r = validateJudge(judge({ citedChunkIds: ['c4', 'c1'] }), ['c0', 'c1'])
    expect(r.citedChunkIds).toEqual(['c1'])
  })

  it('[T-003.5] an empty retrieved set invalidates every citation', () => {
    const r = validateJudge(judge({ citedChunkIds: ['c0', 'c1'] }), [])
    expect(r.citedChunkIds).toEqual([])
    expect(r.verdict).toBe('unsupported')
  })
})

describe('validateJudge rule 2: supported/contradicted without a valid citation become unsupported', () => {
  it('[T-003.5] supported citing only foreign ids is downgraded to unsupported with confidence low', () => {
    const r = validateJudge(judge({ verdict: 'supported', citedChunkIds: ['c7', 'c8'], confidence: 'high' }), retrieved)
    expect(r.verdict).toBe('unsupported')
    expect(r.confidence).toBe('low')
    expect(r.citedChunkIds).toEqual([])
  })

  it('[T-003.5] supported with no citations at all is downgraded to unsupported with confidence low', () => {
    const r = validateJudge(judge({ verdict: 'supported', citedChunkIds: [], confidence: 'medium' }), retrieved)
    expect(r.verdict).toBe('unsupported')
    expect(r.confidence).toBe('low')
  })

  it('[T-003.5] contradicted citing only foreign ids is downgraded to unsupported with confidence low', () => {
    const r = validateJudge(
      judge({ verdict: 'contradicted', citedChunkIds: ['c9'], fix: 'Deploy to app.space.', confidence: 'high' }),
      retrieved,
    )
    expect(r.verdict).toBe('unsupported')
    expect(r.confidence).toBe('low')
  })

  it('[T-003.5] a downgraded contradicted verdict also loses its fix (rule 4 runs after rule 2)', () => {
    const r = validateJudge(
      judge({ verdict: 'contradicted', citedChunkIds: [], fix: 'Deploy to app.space.' }),
      retrieved,
    )
    expect(r.verdict).toBe('unsupported')
    expect(r.fix).toBeNull()
  })

  it('[T-003.5] the downgrade keeps the model\'s reason text', () => {
    const r = validateJudge(judge({ verdict: 'supported', citedChunkIds: ['c9'], reason: 'Because docs.' }), retrieved)
    expect(r.reason).toBe('Because docs.')
  })

  it('[T-003.5] one valid citation among foreign ones is enough to keep supported', () => {
    const r = validateJudge(judge({ verdict: 'supported', citedChunkIds: ['c9', 'c1'] }), retrieved)
    expect(r.verdict).toBe('supported')
    expect(r.citedChunkIds).toEqual(['c1'])
    expect(r.confidence).toBe('high')
  })

  it('[T-003.5] an unsupported verdict is not rewritten and keeps its confidence even with no citations', () => {
    const r = validateJudge(judge({ verdict: 'unsupported', citedChunkIds: [], confidence: 'high' }), retrieved)
    expect(r.verdict).toBe('unsupported')
    expect(r.confidence).toBe('high')
  })

  it('[T-003.5] an unsupported verdict that cited foreign ids has them dropped but keeps its confidence', () => {
    const r = validateJudge(judge({ verdict: 'unsupported', citedChunkIds: ['c9'], confidence: 'medium' }), retrieved)
    expect(r.verdict).toBe('unsupported')
    expect(r.confidence).toBe('medium')
    expect(r.citedChunkIds).toEqual([])
  })
})

describe('validateJudge rules 3 and 4: fix handling', () => {
  it('[T-003.5] contradicted with a valid citation keeps its fix', () => {
    const r = validateJudge(
      judge({ verdict: 'contradicted', citedChunkIds: ['c1'], fix: 'Deploy to app.space in one command.' }),
      retrieved,
    )
    expect(r.verdict).toBe('contradicted')
    expect(r.fix).toBe('Deploy to app.space in one command.')
    expect(r.confidence).toBe('high')
  })

  it('[T-003.5] contradicted with a valid citation and fix = null stays contradicted with fix null', () => {
    const r = validateJudge(judge({ verdict: 'contradicted', citedChunkIds: ['c0'], fix: null }), retrieved)
    expect(r.verdict).toBe('contradicted')
    expect(r.fix).toBeNull()
  })

  it('[T-003.5] supported verdicts get fix = null even if the model supplied one', () => {
    const r = validateJudge(judge({ verdict: 'supported', citedChunkIds: ['c0'], fix: 'Rewrite this.' }), retrieved)
    expect(r.verdict).toBe('supported')
    expect(r.fix).toBeNull()
  })

  it('[T-003.5] unsupported verdicts get fix = null even if the model supplied one', () => {
    const r = validateJudge(judge({ verdict: 'unsupported', citedChunkIds: [], fix: 'Rewrite this.' }), retrieved)
    expect(r.fix).toBeNull()
  })
})

describe('validateJudge general behavior', () => {
  it('[T-003.5] does not mutate its input', () => {
    const input = judge({ verdict: 'contradicted', citedChunkIds: ['c9', 'c0'], fix: 'x fix here' })
    const snapshot = JSON.parse(JSON.stringify(input))
    validateJudge(input, retrieved)
    expect(input).toEqual(snapshot)
  })

  it('[T-003.5] always returns a value that satisfies the JudgeOut contract', () => {
    const cases: Out[] = [
      judge(),
      judge({ verdict: 'supported', citedChunkIds: ['c9'] }),
      judge({ verdict: 'contradicted', citedChunkIds: ['c0'], fix: 'A fix.' }),
      judge({ verdict: 'contradicted', citedChunkIds: [], fix: 'A fix.' }),
      judge({ verdict: 'unsupported', citedChunkIds: [], fix: 'ignored' }),
    ]
    for (const c of cases) expect(JudgeOut.safeParse(validateJudge(c, retrieved)).success).toBe(true)
  })

  it('[T-003.5] never returns a cited id outside the retrieved set', () => {
    const r = validateJudge(judge({ verdict: 'supported', citedChunkIds: ['c0', 'c4', 'c1', 'c3'] }), retrieved)
    for (const id of r.citedChunkIds) expect(retrieved).toContain(id)
  })
})
