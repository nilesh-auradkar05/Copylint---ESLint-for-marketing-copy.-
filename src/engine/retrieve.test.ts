import { describe, expect, it, vi } from 'vitest'
import { KnowledgeError } from 'deepspace/worker'
import type { KnowledgeSearchChunk, KnowledgeSearchResult } from 'deepspace/worker'
import { CONFIG } from './config'
import { filenameForPath, pageFromFilename, retrieve } from './retrieve'

type Kb = Parameters<typeof retrieve>[0]

function chunk(id: string, filename: string | undefined, text = `text of ${id}`): KnowledgeSearchChunk {
  return { id, score: 0.5, text, ...(filename === undefined ? {} : { filename }) }
}

/** External boundary: knowledge search. Records every call; never inspects the module under test. */
function fakeKb(chunks: KnowledgeSearchChunk[]) {
  const search = vi.fn(
    async (_query: string, _options?: unknown): Promise<KnowledgeSearchResult> => ({ chunks }),
  )
  return { kb: { search } as unknown as Kb, search }
}

describe('filenameForPath / pageFromFilename', () => {
  it('[T-004.2] maps a docs path to a flat markdown filename', () => {
    expect(filenameForPath('concepts/permissions')).toBe('concepts__permissions.md')
    expect(filenameForPath('index')).toBe('index.md')
    expect(filenameForPath('sdk-reference/worker/ai')).toBe('sdk-reference__worker__ai.md')
  })

  it('[T-004.2] pageFromFilename inverts filenameForPath for every configured source page', () => {
    for (const path of CONFIG.sourcePages) {
      expect(pageFromFilename(filenameForPath(path))).toBe(path)
    }
  })

  it('[T-004.2] pageFromFilename returns null for a filename that is not one of ours', () => {
    expect(pageFromFilename('notes.txt')).toBeNull()
    expect(pageFromFilename('concepts__permissions')).toBeNull()
    expect(pageFromFilename('')).toBeNull()
  })
})

describe('retrieve', () => {
  it('[T-004.2] searches the docs folder once with hybrid mode and the configured limit', async () => {
    const { kb, search } = fakeKb([chunk('k1', 'concepts__permissions.md')])
    await retrieve(kb, 'Permissions are enforced server-side.')
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith('Permissions are enforced server-side.', {
      folder: CONFIG.kb.folder,
      mode: CONFIG.kb.mode,
      limit: CONFIG.limits.kbLimit,
    })
    expect(CONFIG.kb.folder).toBe('docs')
    expect(CONFIG.limits.kbLimit).toBe(5)
  })

  it('[T-004.2] truncates a very long claim to 4,096 characters (knowledge query cap)', async () => {
    const long = 'a'.repeat(3000) + 'b'.repeat(3000)
    const { kb, search } = fakeKb([])
    await retrieve(kb, long)
    const query = search.mock.calls[0]?.[0]
    expect(query).toBe(long.slice(0, 4096))
    expect(query).toHaveLength(4096)
  })

  it('[T-004.2] leaves a claim of exactly 4,096 characters untouched', async () => {
    const exact = 'x'.repeat(4096)
    const { kb, search } = fakeKb([])
    await retrieve(kb, exact)
    expect(search.mock.calls[0]?.[0]).toBe(exact)
  })

  it('[T-004.2] labels chunks c0, c1, ... in result order and recovers the page from the filename', async () => {
    const { kb } = fakeKb([
      chunk('kb-9', 'guides__external-apis.md', 'first'),
      chunk('kb-3', 'concepts__permissions.md', 'second'),
      chunk('kb-7', 'index.md', 'third'),
    ])
    const out = await retrieve(kb, 'claim')
    expect(out).toEqual({
      chunks: [
        { chunkId: 'c0', page: 'guides/external-apis', text: 'first' },
        { chunkId: 'c1', page: 'concepts/permissions', text: 'second' },
        { chunkId: 'c2', page: 'index', text: 'third' },
      ],
    })
  })

  it('[T-004.2] drops chunks with a missing or unmappable filename and relabels without gaps', async () => {
    const { kb } = fakeKb([
      chunk('a', 'concepts__permissions.md', 'keep-1'),
      chunk('b', undefined, 'no filename'),
      chunk('c', 'stray-upload.txt', 'foreign file'),
      chunk('d', 'bindings__knowledge.md', 'keep-2'),
    ])
    const out = await retrieve(kb, 'claim')
    expect(out.chunks).toEqual([
      { chunkId: 'c0', page: 'concepts/permissions', text: 'keep-1' },
      { chunkId: 'c1', page: 'bindings/knowledge', text: 'keep-2' },
    ])
  })

  it('[T-004.2] returns an empty chunk list when nothing is retrieved', async () => {
    const { kb } = fakeKb([])
    expect(await retrieve(kb, 'claim')).toEqual({ chunks: [] })
  })

  it('[T-004.7] does not swallow an upstream knowledge failure', async () => {
    const search = vi.fn(async () => {
      throw new KnowledgeError(504, 'timeout', 'search timed out')
    })
    await expect(retrieve({ search } as unknown as Kb, 'claim')).rejects.toBeInstanceOf(KnowledgeError)
  })
})

describe('retrieve empty-result keyword fallback', () => {
  const OPTS = {
    folder: CONFIG.kb.folder,
    mode: CONFIG.kb.mode,
    limit: CONFIG.limits.kbLimit,
  }
  const HIT = [chunk('h1', 'guides__background-jobs.md', 'jobs text'), chunk('h2', 'bindings__knowledge.md', 'kb text')]
  const words = (q: string) => q.toLowerCase().split(/[^a-z0-9$.,]+/).filter(Boolean)

  /** External boundary: knowledge search that answers call N with responses[N] (empty once exhausted). */
  function seqKb(responses: KnowledgeSearchChunk[][]) {
    let i = 0
    const search = vi.fn(
      async (_query: string, _options?: unknown): Promise<KnowledgeSearchResult> => ({
        chunks: responses[i++] ?? [],
      }),
    )
    return { kb: { search } as unknown as Kb, search }
  }
  const queries = (search: { mock: { calls: unknown[][] } }) => search.mock.calls.map((c) => String(c[0]))

  it('[T-007] happy path: a non-empty first search makes exactly one call with the full claim text', async () => {
    const claim = 'Background jobs retry three times by default.'
    const { kb, search } = seqKb([HIT])
    const out = await retrieve(kb, claim)
    expect(search).toHaveBeenCalledTimes(1)
    expect(search.mock.calls[0]?.[0]).toBe(claim)
    expect(out.chunks).toHaveLength(2)
  })

  it('[T-007] zero first results triggers a shorter keyword query: stopwords removed, order kept', async () => {
    const claim = 'Background jobs retry three times by default.'
    const { kb, search } = seqKb([[], HIT])
    await retrieve(kb, claim)
    expect(search.mock.calls.length).toBeGreaterThanOrEqual(2)
    const q = queries(search)[1] ?? ''
    expect(q.length).toBeLessThan(claim.length)
    for (const w of ['Background', 'jobs', 'retry', 'default']) expect(q).toContain(w)
    expect(q).not.toContain(' by ')
    expect(q.endsWith('.')).toBe(false)
    expect(q.indexOf('Background')).toBeLessThan(q.indexOf('jobs'))
    expect(q.indexOf('jobs')).toBeLessThan(q.indexOf('retry'))
    expect(q.indexOf('retry')).toBeLessThan(q.indexOf('default'))

    const claim2 = 'The limits of the platform are documented by the team.'
    const second = seqKb([[], HIT])
    await retrieve(second.kb, claim2)
    const q2 = queries(second.search)[1] ?? ''
    expect(q2.length).toBeLessThan(claim2.length)
    for (const stop of ['the', 'by', 'of', 'are']) expect(words(q2)).not.toContain(stop)
    for (const w of ['limits', 'platform', 'documented', 'team']) expect(q2).toContain(w)
  })

  it('[T-007] keyword query hits are mapped as usual and no further searches are made', async () => {
    const { kb, search } = seqKb([[], HIT])
    const out = await retrieve(kb, 'Background jobs retry three times by default.')
    expect(search).toHaveBeenCalledTimes(2)
    expect(out).toEqual({
      chunks: [
        { chunkId: 'c0', page: 'guides/background-jobs', text: 'jobs text' },
        { chunkId: 'c1', page: 'bindings/knowledge', text: 'kb text' },
      ],
    })
  })

  it('[T-007] progressively shorter fallbacks: never longer, never empty or 1 char, <= 6 calls, stops at first hit', async () => {
    const claim = 'The context window is limited to 32,000 tokens at $0.825 per million tokens by default.'
    const empty = seqKb([])
    await retrieve(empty.kb, claim)
    const qs = queries(empty.search)
    expect(qs.length).toBeGreaterThanOrEqual(3)
    expect(qs.length).toBeLessThanOrEqual(6)
    for (let i = 1; i < qs.length; i++) {
      const q = qs[i] ?? ''
      expect(q.trim().length).toBeGreaterThan(1)
      expect(q.length).toBeLessThanOrEqual((qs[i - 1] ?? '').length)
    }
    // At some point numeric tokens are dropped.
    expect(qs.slice(1).some((q) => !q.includes('32,000') && !q.includes('$0.825'))).toBe(true)

    const stopAtThird = seqKb([[], [], HIT])
    const out = await retrieve(stopAtThird.kb, claim)
    expect(stopAtThird.search).toHaveBeenCalledTimes(3)
    expect(out.chunks).toHaveLength(2)
  })

  it('[T-007] every attempt empty resolves to { chunks: [] } after at most 6 calls', async () => {
    const { kb, search } = seqKb([])
    await expect(retrieve(kb, 'Background jobs retry three times by default.')).resolves.toEqual({ chunks: [] })
    expect(search.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(search.mock.calls.length).toBeLessThanOrEqual(6)
  })

  it('[T-007] every fallback call reuses the first call options (folder, mode, limit)', async () => {
    const { kb, search } = seqKb([])
    await retrieve(kb, 'Background jobs retry three times by default.')
    expect(search.mock.calls.length).toBeGreaterThanOrEqual(2)
    for (const call of search.mock.calls) expect(call[1]).toEqual(OPTS)
  })

  it('[T-007] a first search with only unmappable chunks also triggers the fallback', async () => {
    const junk = [chunk('x', undefined), chunk('y', 'stray-upload.txt')]
    const { kb, search } = seqKb([junk, HIT])
    const out = await retrieve(kb, 'Background jobs retry three times by default.')
    expect(search).toHaveBeenCalledTimes(2)
    expect(out.chunks.map((c) => c.chunkId)).toEqual(['c0', 'c1'])
  })

  it('[T-007] a KnowledgeError from the first search propagates and no fallback call is made', async () => {
    const search = vi.fn(async () => {
      throw new KnowledgeError(504, 'timeout', 'search timed out')
    })
    await expect(retrieve({ search } as unknown as Kb, 'Background jobs retry.')).rejects.toBeInstanceOf(KnowledgeError)
    expect(search).toHaveBeenCalledTimes(1)
  })
})
