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
