import { describe, expect, it } from 'vitest'
import { claimHash, normalizeClaim, sha256hex, versionId } from './ids'
import fixture from '../../eval/fixtures/review-room.json'

// Independent oracle: Web Crypto directly, so these tests do not depend on sha256hex being right.
async function oracle(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

const HEX32 = /^[0-9a-f]{32}$/
const HEX24 = /^[0-9a-f]{24}$/

describe('sha256hex', () => {
  it('[T-003.1] matches the published SHA-256 vectors (empty, abc, non-ASCII UTF-8)', async () => {
    expect(await sha256hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(await sha256hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256hex('héllo wörld ✓')).toBe('c2a59c71097b678dc5af2eb1f98ddc575b63948b0fa6740071a945673aaada4d')
  })

  it('[T-003.1] returns 64 lowercase hex characters', async () => {
    expect(await sha256hex('anything')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('versionId', () => {
  it('[T-003.1] is stable for the same (draftId, body, kbVersion)', async () => {
    const a = await versionId('draft-1', 'Deploy to Vercel.', 3)
    const b = await versionId('draft-1', 'Deploy to Vercel.', 3)
    expect(a).toBe(b)
  })

  it('[T-003.1] is 32 lowercase hex chars', async () => {
    expect(await versionId('draft-1', 'body', 1)).toMatch(HEX32)
  })

  it('[T-003.1] equals sha256(draftId + "\\n" + body + "\\n" + kbVersion) truncated to 32 chars (SPEC 4.1)', async () => {
    const expected = (await oracle('draft-1\nhello world\n7')).slice(0, 32)
    expect(await versionId('draft-1', 'hello world', 7)).toBe(expected)
  })

  it('[T-003.1] changes when draftId changes', async () => {
    expect(await versionId('draft-1', 'body', 1)).not.toBe(await versionId('draft-2', 'body', 1))
  })

  it('[T-003.1] changes when body changes (even by one character)', async () => {
    expect(await versionId('draft-1', 'body', 1)).not.toBe(await versionId('draft-1', 'body.', 1))
  })

  it('[T-003.1] changes when kbVersion changes (drift produces a new version id)', async () => {
    const v1 = await versionId('draft-1', 'body', 1)
    const v2 = await versionId('draft-1', 'body', 2)
    const v10 = await versionId('draft-1', 'body', 10)
    expect(new Set([v1, v2, v10]).size).toBe(3)
  })

  it('[T-003.1] reproduces the version ids in eval/fixtures/review-room.json', async () => {
    for (const v of fixture.versions) {
      expect(await versionId(v.data.draftId, v.data.body, v.data.kbVersion)).toBe(v.recordId)
    }
  })
})

describe('normalizeClaim', () => {
  it('[T-003.2] makes "Deploy to Vercel." equivalent to "deploy  to vercel"', () => {
    expect(normalizeClaim('Deploy to Vercel.')).toBe(normalizeClaim('deploy  to vercel'))
    expect(normalizeClaim('Deploy to Vercel.')).toBe('deploy to vercel')
  })

  it('[T-003.2] lowercases', () => {
    expect(normalizeClaim('DeepSpace Runs On CLOUDFLARE')).toBe('deepspace runs on cloudflare')
  })

  it('[T-003.2] collapses runs of spaces, tabs and newlines into one space', () => {
    expect(normalizeClaim('a  b\t\tc\n\nd \n e')).toBe('a b c d e')
  })

  it('[T-003.2] trims leading and trailing whitespace', () => {
    expect(normalizeClaim('   hello world  ')).toBe('hello world')
  })

  it.each([
    ['hello world.', 'hello world'],
    ['hello world,', 'hello world'],
    ['hello world;', 'hello world'],
    ['hello world:', 'hello world'],
    ['hello world!', 'hello world'],
    ['hello world!!!', 'hello world'],
    ['hello world.;', 'hello world'],
  ])('[T-003.2] strips trailing punctuation: %j -> %j', (input, expected) => {
    expect(normalizeClaim(input)).toBe(expected)
  })

  it('[T-003.2] keeps punctuation that is not trailing, and "+" in numbers', () => {
    expect(normalizeClaim('Fronts 215+ APIs, via one proxy.')).toBe('fronts 215+ apis, via one proxy')
    expect(normalizeClaim('Version 1.2 ships.')).toBe('version 1.2 ships')
  })

  it('[T-003.2] is idempotent', () => {
    for (const s of ['Deploy to Vercel.', 'deploy  to vercel', '  A  b!! ', 'Fronts 215+ APIs, via one proxy.']) {
      expect(normalizeClaim(normalizeClaim(s))).toBe(normalizeClaim(s))
    }
  })
})

describe('claimHash', () => {
  it('[T-003.2] is 24 lowercase hex chars', async () => {
    expect(await claimHash('DeepSpace runs on Cloudflare.')).toMatch(HEX24)
  })

  it('[T-003.2] equals sha256(normalizeClaim(text)) truncated to 24 chars (SPEC 4.1)', async () => {
    expect(await claimHash('Deploy to Vercel.')).toBe((await oracle('deploy to vercel')).slice(0, 24))
  })

  it('[T-003.2] "Deploy to Vercel." and "deploy  to vercel" hash the same (dedupe key)', async () => {
    expect(await claimHash('Deploy to Vercel.')).toBe(await claimHash('deploy  to vercel'))
  })

  it('[T-003.2] different claims hash differently', async () => {
    expect(await claimHash('Deploy to Vercel.')).not.toBe(await claimHash('Deploy to Cloudflare.'))
  })

  it('[T-003.2] reproduces the claimHash values in eval/fixtures/review-room.json', async () => {
    for (const c of fixture.claims) {
      expect(await claimHash(c.data.text)).toBe(c.data.claimHash)
    }
  })
})
