import { describe, expect, it } from 'vitest'
import {
  CheckRequest,
  ClaimKind,
  Evidence,
  ExtractOut,
  JudgeOut,
  PublishRequest,
  Verdict,
} from './contracts'

const rep = (n: number, ch = 'a') => ch.repeat(n)

const KINDS = ['capability', 'limit', 'number', 'default', 'security', 'pricing', 'deployment', 'comparison'] as const

const validClaim = { text: 'DeepSpace deploys to app.space.', quote: 'deploy to app.space', kind: 'deployment' } as const
const validJudge = {
  verdict: 'contradicted',
  citedChunkIds: ['c0', 'c1'],
  reason: 'The docs say app.space, not Vercel.',
  fix: 'Deploy to app.space in one command.',
  confidence: 'high',
} as const

describe('ClaimKind and Verdict enums', () => {
  it('[T-003.contracts] ClaimKind accepts exactly the 8 SPEC kinds', () => {
    for (const k of KINDS) expect(ClaimKind.safeParse(k).success).toBe(true)
    expect(ClaimKind.options).toHaveLength(8)
    expect(ClaimKind.safeParse('opinion').success).toBe(false)
    expect(ClaimKind.safeParse('Capability').success).toBe(false)
  })

  it('[T-003.contracts] Verdict accepts supported | contradicted | unsupported only', () => {
    for (const v of ['supported', 'contradicted', 'unsupported']) expect(Verdict.safeParse(v).success).toBe(true)
    expect(Verdict.options).toHaveLength(3)
    expect(Verdict.safeParse('unknown').success).toBe(false)
    expect(Verdict.safeParse('').success).toBe(false)
  })
})

describe('ExtractOut', () => {
  it('[T-003.contracts] accepts a valid extraction and an empty claims list', () => {
    expect(ExtractOut.safeParse({ claims: [validClaim] }).success).toBe(true)
    expect(ExtractOut.safeParse({ claims: [] }).success).toBe(true)
  })

  it('[T-003.contracts] rejects a missing claims array and non-object input', () => {
    expect(ExtractOut.safeParse({}).success).toBe(false)
    expect(ExtractOut.safeParse('claims').success).toBe(false)
    expect(ExtractOut.safeParse(null).success).toBe(false)
  })

  it('[T-003.contracts] claim text: min 8, max 300 characters', () => {
    expect(ExtractOut.safeParse({ claims: [{ ...validClaim, text: rep(7) }] }).success).toBe(false)
    expect(ExtractOut.safeParse({ claims: [{ ...validClaim, text: rep(8) }] }).success).toBe(true)
    expect(ExtractOut.safeParse({ claims: [{ ...validClaim, text: rep(300) }] }).success).toBe(true)
    expect(ExtractOut.safeParse({ claims: [{ ...validClaim, text: rep(301) }] }).success).toBe(false)
  })

  it('[T-003.contracts] claim quote: min 3, max 400 characters', () => {
    expect(ExtractOut.safeParse({ claims: [{ ...validClaim, quote: rep(2) }] }).success).toBe(false)
    expect(ExtractOut.safeParse({ claims: [{ ...validClaim, quote: rep(3) }] }).success).toBe(true)
    expect(ExtractOut.safeParse({ claims: [{ ...validClaim, quote: rep(400) }] }).success).toBe(true)
    expect(ExtractOut.safeParse({ claims: [{ ...validClaim, quote: rep(401) }] }).success).toBe(false)
  })

  it('[T-003.contracts] claim kind must be a ClaimKind', () => {
    expect(ExtractOut.safeParse({ claims: [{ ...validClaim, kind: 'opinion' }] }).success).toBe(false)
    expect(ExtractOut.safeParse({ claims: [{ text: validClaim.text, quote: validClaim.quote }] }).success).toBe(false)
  })

  it('[T-003.contracts] at most 40 claims', () => {
    expect(ExtractOut.safeParse({ claims: Array.from({ length: 40 }, () => validClaim) }).success).toBe(true)
    expect(ExtractOut.safeParse({ claims: Array.from({ length: 41 }, () => validClaim) }).success).toBe(false)
  })
})

describe('JudgeOut', () => {
  it('[T-003.5] accepts a valid judge output (contradicted with fix)', () => {
    expect(JudgeOut.safeParse(validJudge).success).toBe(true)
  })

  it('[T-003.5] accepts fix = null, and every verdict and confidence value', () => {
    for (const verdict of ['supported', 'contradicted', 'unsupported']) {
      for (const confidence of ['high', 'medium', 'low']) {
        expect(JudgeOut.safeParse({ ...validJudge, verdict, confidence, fix: null }).success).toBe(true)
      }
    }
  })

  it('[T-003.5] rejects an unknown verdict or confidence', () => {
    expect(JudgeOut.safeParse({ ...validJudge, verdict: 'maybe' }).success).toBe(false)
    expect(JudgeOut.safeParse({ ...validJudge, confidence: 'certain' }).success).toBe(false)
  })

  it('[T-003.5] citedChunkIds: at most 5 entries, may be empty', () => {
    expect(JudgeOut.safeParse({ ...validJudge, citedChunkIds: [] }).success).toBe(true)
    expect(JudgeOut.safeParse({ ...validJudge, citedChunkIds: ['c0', 'c1', 'c2', 'c3', 'c4'] }).success).toBe(true)
    expect(JudgeOut.safeParse({ ...validJudge, citedChunkIds: ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'] }).success).toBe(false)
    expect(JudgeOut.safeParse({ ...validJudge, citedChunkIds: [0, 1] }).success).toBe(false)
  })

  it('[T-003.5] reason: at most 400 characters', () => {
    expect(JudgeOut.safeParse({ ...validJudge, reason: rep(400) }).success).toBe(true)
    expect(JudgeOut.safeParse({ ...validJudge, reason: rep(401) }).success).toBe(false)
  })

  it('[T-003.5] fix: at most 240 characters, nullable but not optional', () => {
    expect(JudgeOut.safeParse({ ...validJudge, fix: rep(240) }).success).toBe(true)
    expect(JudgeOut.safeParse({ ...validJudge, fix: rep(241) }).success).toBe(false)
    const withoutFix: Record<string, unknown> = { ...validJudge }
    delete withoutFix.fix
    expect(JudgeOut.safeParse(withoutFix).success).toBe(false)
  })
})

describe('Evidence', () => {
  const ev = { chunkId: 'c0', page: 'concepts/permissions', excerpt: 'DO checks reads before broadcast.' }

  it('[T-003.contracts] accepts a valid evidence item', () => {
    expect(Evidence.safeParse(ev).success).toBe(true)
  })

  it('[T-003.contracts] excerpt: at most 300 characters', () => {
    expect(Evidence.safeParse({ ...ev, excerpt: rep(300) }).success).toBe(true)
    expect(Evidence.safeParse({ ...ev, excerpt: rep(301) }).success).toBe(false)
  })

  it('[T-003.contracts] chunkId, page and excerpt are all required', () => {
    for (const key of ['chunkId', 'page', 'excerpt'] as const) {
      const copy: Record<string, unknown> = { ...ev }
      delete copy[key]
      expect(Evidence.safeParse(copy).success).toBe(false)
    }
  })
})

describe('CheckRequest', () => {
  it('[T-003.contracts] accepts only an empty object (body comes from the stored draft)', () => {
    expect(CheckRequest.safeParse({}).success).toBe(true)
  })

  it('[T-003.contracts] is strict: rejects unknown keys such as a client-supplied body or versionId', () => {
    expect(CheckRequest.safeParse({ body: 'client-supplied text' }).success).toBe(false)
    expect(CheckRequest.safeParse({ versionId: 'abc' }).success).toBe(false)
  })

  it('[T-003.contracts] rejects non-object input', () => {
    expect(CheckRequest.safeParse('x').success).toBe(false)
    expect(CheckRequest.safeParse(null).success).toBe(false)
  })
})

describe('PublishRequest', () => {
  const ok = { draftId: 'd1', versionId: 'v1', url: 'https://example.com/post' }

  it('[T-003.contracts] accepts a valid publish request', () => {
    expect(PublishRequest.safeParse(ok).success).toBe(true)
  })

  it('[T-003.contracts] requires draftId, versionId and url', () => {
    for (const key of ['draftId', 'versionId', 'url'] as const) {
      const copy: Record<string, unknown> = { ...ok }
      delete copy[key]
      expect(PublishRequest.safeParse(copy).success).toBe(false)
    }
  })

  it('[T-003.contracts] url must be a URL and at most 500 characters', () => {
    expect(PublishRequest.safeParse({ ...ok, url: 'not a url' }).success).toBe(false)
    const at500 = 'https://example.com/' + rep(500 - 'https://example.com/'.length)
    const at501 = at500 + 'a'
    expect(at500).toHaveLength(500)
    expect(PublishRequest.safeParse({ ...ok, url: at500 }).success).toBe(true)
    expect(PublishRequest.safeParse({ ...ok, url: at501 }).success).toBe(false)
  })
})
