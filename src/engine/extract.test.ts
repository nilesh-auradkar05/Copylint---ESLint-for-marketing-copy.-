import { describe, expect, it } from 'vitest'
import { CONFIG } from './config'
import { claimHash } from './ids'
import { EXTRACT_SYSTEM, extractUserPrompt } from './prompts'
import { extractClaims } from './extract'
import type { GenerateFn } from './verify'

type Req = Parameters<GenerateFn>[0]

const BODY = [
  'DeepSpace apps run on Cloudflare Workers. Deploys take one command.',
  'The free tier has no limits.',
  'DeepSpace apps run on Cloudflare Workers.',
].join('\n')

const claim = (text: string, quote: string, kind = 'capability') => ({ text, quote, kind })

/** Mock of the only model boundary: returns scripted outputs in order and records every request. */
function scripted(...outputs: unknown[]) {
  const calls: Req[] = []
  const generate: GenerateFn = async (req) => {
    calls.push(req)
    if (outputs.length === 0) throw new Error('unexpected extra generate call')
    return outputs.shift()
  }
  return { generate, calls }
}

describe('extractClaims', () => {
  it('[T-005.1] locates every quote in the body; span slices back to the exact quote; claimHash is derived from text', async () => {
    const { generate } = scripted({
      claims: [
        claim('DeepSpace apps run on Cloudflare Workers.', 'DeepSpace apps run on Cloudflare Workers'),
        claim('The free tier has no limits.', 'The free tier has no limits', 'limit'),
      ],
    })
    const { claims, dropped } = await extractClaims({ generate }, BODY)
    expect(dropped).toBe(0)
    expect(claims).toHaveLength(2)
    for (const c of claims) expect(BODY.slice(c.span[0], c.span[1])).toBe(c.quote)
    expect(claims[1].kind).toBe('limit')
    expect(claims[0].claimHash).toBe(await claimHash(claims[0].text))
  })

  it('[T-005.1] uses the extract model, EXTRACT_SYSTEM, and the draft only inside the user prompt', async () => {
    const { generate, calls } = scripted({ claims: [] })
    await extractClaims({ generate }, BODY)
    expect(calls).toHaveLength(1)
    expect(calls[0].model).toBe(CONFIG.models.extract)
    expect(calls[0].system).toBe(EXTRACT_SYSTEM)
    expect(calls[0].system).not.toContain('Cloudflare Workers.')
    expect(calls[0].prompt).toBe(extractUserPrompt(BODY))
    expect(calls[0].schema.safeParse({ claims: [] }).success).toBe(true)
  })

  it('[T-005.1] dedupes by claimHash (case / trailing punctuation) and advances through repeated quotes', async () => {
    const q = 'DeepSpace apps run on Cloudflare Workers'
    const { generate } = scripted({
      claims: [
        claim('DeepSpace apps run on Cloudflare Workers.', q),
        claim('deepspace apps run on  cloudflare workers', q), // same claimHash: dropped as duplicate
        claim('Apps built with DeepSpace deploy to Workers.', q), // distinct claim, same quote: must take the LATER occurrence
      ],
    })
    const { claims } = await extractClaims({ generate }, BODY)
    expect(claims).toHaveLength(2)
    expect(claims[0].span[0]).toBe(BODY.indexOf(q))
    expect(claims[1].span[0]).toBe(BODY.lastIndexOf(q))
  })

  it('[T-005.7] unlocatable quotes are dropped and counted, not thrown', async () => {
    const { generate } = scripted({
      claims: [
        claim('DeepSpace is hosted on Mars.', 'DeepSpace is hosted on Mars'),
        claim('The free tier has no limits.', 'The free tier has no limits', 'limit'),
        claim('DeepSpace bills per heartbeat.', 'bills per heartbeat', 'pricing'),
      ],
    })
    const { claims, dropped } = await extractClaims({ generate }, BODY)
    expect(claims.map((c) => c.quote)).toEqual(['The free tier has no limits'])
    expect(dropped).toBe(2)
  })

  it('[T-005.7] caps at CONFIG.limits.maxClaims, keeping model order', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `Fact number ${i} about DeepSpace is true.`)
    const { generate } = scripted({
      claims: lines.map((l) => claim(l, l.slice(0, -1))),
    })
    const { claims } = await extractClaims({ generate }, lines.join('\n'))
    expect(claims).toHaveLength(CONFIG.limits.maxClaims)
    expect(claims[0].quote).toBe(lines[0].slice(0, -1))
    expect(claims[24].quote).toBe(lines[24].slice(0, -1))
  })

  it('[T-005.4] malformed output: exactly one repair call whose prompt carries the validation error, then success', async () => {
    const bad = { claims: [{ text: 'x', quote: 'q', kind: 'capability' }] } // too short for ExtractOut
    const good = { claims: [claim('The free tier has no limits.', 'The free tier has no limits', 'limit')] }
    const { generate, calls } = scripted(bad, good)
    const { claims } = await extractClaims({ generate }, BODY)
    expect(claims).toHaveLength(1)
    expect(calls).toHaveLength(2)
    expect(calls[1].prompt.startsWith(calls[0].prompt)).toBe(true)
    expect(calls[1].prompt.slice(calls[0].prompt.length)).toMatch(/claims|text|too.small|expected|invalid/i)
    expect(calls[1].model).toBe(CONFIG.models.extract)
  })

  it('[T-005.4] malformed twice throws after exactly two generate calls', async () => {
    const { generate, calls } = scripted({ nope: true }, { still: 'nope' })
    await expect(extractClaims({ generate }, BODY)).rejects.toThrow()
    expect(calls).toHaveLength(2)
  })

  it('[T-005.6] passes the abort signal to the model call', async () => {
    const ac = new AbortController()
    const { generate, calls } = scripted({ claims: [] })
    await extractClaims({ generate, signal: ac.signal }, BODY)
    expect(calls[0].abortSignal).toBe(ac.signal)
  })

  it('[T-005.4] an upstream failure (timeout) propagates and is not retried here', async () => {
    const generate: GenerateFn = async () => {
      throw new Error('upstream timeout')
    }
    await expect(extractClaims({ generate }, BODY)).rejects.toThrow('upstream timeout')
  })
})
