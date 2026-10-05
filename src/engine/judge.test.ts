import { describe, expect, it } from 'vitest'
import { CONFIG } from './config'
import { JUDGE_SYSTEM, judgeUserPrompt } from './prompts'
import type { RetrievedChunk } from './retrieve'
import { judgeClaim } from './judge'
import type { GenerateFn } from './verify'

type Req = Parameters<GenerateFn>[0]

const CHUNKS: RetrievedChunk[] = [
  { chunkId: 'c0', page: 'concepts/architecture', text: 'DeepSpace apps run on Cloudflare Workers.' },
  { chunkId: 'c1', page: 'guides/background-jobs', text: 'Jobs default to maxAttempts 1.' },
]
const CLAIM = 'DeepSpace apps run on Vercel.'

const out = (over: Record<string, unknown> = {}) => ({
  verdict: 'supported',
  citedChunkIds: ['c0'],
  reason: 'Docs say so.',
  fix: null,
  confidence: 'high',
  ...over,
})

function scripted(...outputs: unknown[]) {
  const calls: Req[] = []
  const generate: GenerateFn = async (req) => {
    calls.push(req)
    if (outputs.length === 0) throw new Error('unexpected extra generate call')
    return outputs.shift()
  }
  return { generate, calls }
}

describe('judgeClaim', () => {
  it('[T-005.2] calls the judge model with JUDGE_SYSTEM, the delimited claim prompt and the output token cap', async () => {
    const { generate, calls } = scripted(out())
    await judgeClaim({ generate }, CLAIM, CHUNKS)
    expect(calls).toHaveLength(1)
    expect(calls[0].model).toBe(CONFIG.models.judge)
    expect(calls[0].system).toBe(JUDGE_SYSTEM)
    expect(calls[0].system).not.toContain(CLAIM)
    expect(calls[0].prompt).toBe(judgeUserPrompt(CLAIM, CHUNKS))
    expect(calls[0].maxOutputTokens).toBe(CONFIG.limits.judgeMaxOutputTokens)
  })

  it('[T-005.2] a valid citation is kept; contradicted keeps its fix', async () => {
    const { generate } = scripted(out({ verdict: 'contradicted', fix: 'DeepSpace apps run on Cloudflare Workers.' }))
    const r = await judgeClaim({ generate }, CLAIM, CHUNKS)
    expect(r.verdict).toBe('contradicted')
    expect(r.citedChunkIds).toEqual(['c0'])
    expect(r.fix).toBe('DeepSpace apps run on Cloudflare Workers.')
  })

  it('[T-005.2] output is passed through validateJudge: ids outside the retrieved set are dropped; none left => unsupported/low', async () => {
    const { generate } = scripted(out({ citedChunkIds: ['c0', 'c9'] }), out({ citedChunkIds: ['c7'] }))
    const a = await judgeClaim({ generate }, CLAIM, CHUNKS)
    expect(a.verdict).toBe('supported')
    expect(a.citedChunkIds).toEqual(['c0'])
    const b = await judgeClaim({ generate }, CLAIM, CHUNKS)
    expect(b.verdict).toBe('unsupported')
    expect(b.confidence).toBe('low')
    expect(b.citedChunkIds).toEqual([])
  })

  it('[T-005.2] with zero retrieved chunks no verdict can be supported or contradicted', async () => {
    const { generate } = scripted(out())
    const r = await judgeClaim({ generate }, CLAIM, [])
    expect(r.verdict).toBe('unsupported')
  })

  it('[T-005.4] malformed output: exactly one repair call with the validation error appended, then success', async () => {
    const { generate, calls } = scripted({ verdict: 'maybe' }, out())
    const r = await judgeClaim({ generate }, CLAIM, CHUNKS)
    expect(r.verdict).toBe('supported')
    expect(calls).toHaveLength(2)
    expect(calls[1].prompt.startsWith(calls[0].prompt)).toBe(true)
    expect(calls[1].prompt.slice(calls[0].prompt.length)).toMatch(/verdict|invalid|expected|required/i)
  })

  it('[T-005.4] malformed twice throws after exactly two generate calls', async () => {
    const { generate, calls } = scripted({ verdict: 'maybe' }, { verdict: 'perhaps' })
    await expect(judgeClaim({ generate }, CLAIM, CHUNKS)).rejects.toThrow()
    expect(calls).toHaveLength(2)
  })

  it('[T-005.6] passes the abort signal to the model call', async () => {
    const ac = new AbortController()
    const { generate, calls } = scripted(out())
    await judgeClaim({ generate, signal: ac.signal }, CLAIM, CHUNKS)
    expect(calls[0].abortSignal).toBe(ac.signal)
  })
})
