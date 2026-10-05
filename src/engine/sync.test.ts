import { beforeEach, describe, expect, it } from 'vitest'
import { KnowledgeError } from 'deepspace/worker'
import type {
  ActionResult,
  KnowledgeItem,
  KnowledgeListResult,
  KnowledgeStatus,
} from 'deepspace/worker'
import { CONFIG } from './config'
import { syncSources } from './sync'
import type { SyncDeps } from './sync'

// ---------------------------------------------------------------------------------------------
// Fakes for the external boundaries only: fetch (docs site), kb (managed knowledge), records
// (ActionTools), clock. syncSources itself is never mocked.
// ---------------------------------------------------------------------------------------------

const rowId = (path: string): string => path.replaceAll('/', '__')
const fileFor = (path: string): string => `${rowId(path)}.md`
const ALL = [...CONFIG.sourcePages] as string[]
const ISO = (s: unknown): boolean => typeof s === 'string' && !Number.isNaN(Date.parse(s))

// Independent oracle so the tests do not depend on sha256hex being right.
async function oracle(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

type Data = Record<string, unknown>

class FakeRecords {
  readonly store = new Map<string, Map<string, Data>>()
  private col(c: string): Map<string, Data> {
    let m = this.store.get(c)
    if (!m) this.store.set(c, (m = new Map()))
    return m
  }
  rows(c: string): Array<{ id: string; data: Data }> {
    return [...this.col(c)].map(([id, data]) => ({ id, data }))
  }
  row(c: string, id: string): Data | undefined {
    return this.col(c).get(id)
  }
  private rec(c: string, id: string, data: Data) {
    return { recordId: id, data, createdBy: 'system', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
  }
  // Methods are arrow properties so they can be handed over as the ActionTools subset.
  get = (async (c: string, id: string) => {
    const d = this.col(c).get(id)
    return d ? { success: true, data: { record: this.rec(c, id, d) } } : { success: false, error: 'Record not found' }
  }) as unknown as SyncDeps['records']['get']
  query = (async (c: string, o?: { where?: Data; limit?: number }) => {
    let list = [...this.col(c)].filter(([, d]) => Object.entries(o?.where ?? {}).every(([k, v]) => d[k] === v))
    if (o?.limit !== undefined) list = list.slice(0, o.limit)
    return { success: true, data: { records: list.map(([id, d]) => this.rec(c, id, d)), count: list.length } }
  }) as unknown as SyncDeps['records']['query']
  create = (async (c: string, data: Data, id?: string): Promise<ActionResult<{ recordId: string }>> => {
    const recordId = id ?? `gen-${this.col(c).size + 1}`
    this.col(c).set(recordId, { ...data }) // upsert, as the ActionTools doc describes for a known key
    return { success: true, data: { recordId } }
  }) as unknown as SyncDeps['records']['create']
  update = (async (c: string, id: string, patch: Data): Promise<ActionResult<{ recordId: string }>> => {
    const d = this.col(c).get(id)
    if (!d) return { success: false, error: 'Record not found' }
    this.col(c).set(id, { ...d, ...patch }) // put/update merges
    return { success: true, data: { recordId: id } }
  }) as unknown as SyncDeps['records']['update']
}

interface AddCall {
  name: string
  type: string
  text: string
  folder: string | undefined
  itemId: string
}

class FakeKb {
  items = new Map<string, KnowledgeItem & { folder: string }>()
  adds: AddCall[] = []
  removes: string[] = []
  listOptions: Array<Record<string, unknown> | undefined> = []
  log: string[] = [] // ordered: `add:<file>`, `remove:<id>`
  private seq = 0
  private polls = new Map<string, number>()
  /** Status the item reports on its n-th list() appearance (1-based). Default: completed at once. */
  statusFor: (key: string, poll: number) => KnowledgeStatus = () => 'completed'
  /** Filenames whose add() throws a KnowledgeError. */
  failAdd = new Set<string>()

  add = async (file: File, options?: { folder?: string }) => {
    if (this.failAdd.has(file.name)) throw new KnowledgeError(500, 'ingest_failed', `boom on ${file.name}`)
    const id = `item-${++this.seq}`
    this.items.set(id, { id, key: file.name, status: 'queued', folder: options?.folder ?? '' })
    this.adds.push({ name: file.name, type: file.type, text: await file.text(), folder: options?.folder, itemId: id })
    this.log.push(`add:${file.name}`)
    return { items: [{ id, key: file.name, status: 'queued' as const }] }
  }
  remove = async (id: string) => {
    this.items.delete(id)
    this.removes.push(id)
    this.log.push(`remove:${id}`)
  }
  list = async (options?: { folder?: string; page?: number; perPage?: number; status?: KnowledgeStatus }) => {
    this.listOptions.push(options as Record<string, unknown> | undefined)
    let items = [...this.items.values()].filter((i) => options?.folder === undefined || i.folder === options.folder)
    items = items.map((i) => {
      const n = (this.polls.get(i.id) ?? 0) + 1
      this.polls.set(i.id, n)
      return { ...i, status: this.statusFor(i.key, n) }
    })
    if (options?.status) items = items.filter((i) => i.status === options.status)
    const perPage = options?.perPage ?? (items.length || 1)
    const page = options?.page ?? 1
    const out: KnowledgeListResult = {
      items: items.slice((page - 1) * perPage, page * perPage).map(({ folder: _f, ...rest }) => rest),
      page,
      perPage,
      total: items.length,
      totalPages: Math.max(1, Math.ceil(items.length / perPage)),
    }
    return out
  }
  idsFor(file: string): string[] {
    return this.adds.filter((a) => a.name === file).map((a) => a.itemId)
  }
}

interface Harness {
  records: FakeRecords
  kb: FakeKb
  bodies: Map<string, string>
  statuses: Map<string, number>
  fetchCalls: Array<{ url: string; signal: AbortSignal | undefined | null }>
  clock: { ms: number }
  sleeps: number[]
  deps: SyncDeps
}

function harness(): Harness {
  const records = new FakeRecords()
  const kb = new FakeKb()
  const bodies = new Map<string, string>()
  const statuses = new Map<string, number>()
  const fetchCalls: Harness['fetchCalls'] = []
  const clock = { ms: Date.parse('2026-10-04T12:00:00.000Z') }
  const sleeps: number[] = []
  const fetchFake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input)
    fetchCalls.push({ url, signal: init?.signal })
    const path = url.replace(CONFIG.docsBase, '').replace(/\.md$/, '')
    const status = statuses.get(path) ?? 200
    if (status !== 200) return new Response('nope', { status })
    return new Response(bodies.get(path) ?? `# ${path}\n\nOriginal content of ${path}.\n`, { status: 200 })
  }
  const deps: SyncDeps = {
    fetch: fetchFake as unknown as typeof fetch,
    kb: kb as unknown as SyncDeps['kb'],
    records: records as unknown as SyncDeps['records'],
    // A busy-polling implementation (no sleep) still reaches the deadline: every now() ticks 1ms.
    now: () => new Date((clock.ms += 1)),
    sleep: async (ms: number) => {
      sleeps.push(ms)
      if (sleeps.length > 10_000) throw new Error('runaway polling loop')
      clock.ms += ms
    },
  }
  return { records, kb, bodies, statuses, fetchCalls, clock, sleeps, deps }
}

let h: Harness
beforeEach(() => {
  h = harness()
})

const kbVersion = (): unknown => h.records.row('kb_state', 'global')?.version

// ---------------------------------------------------------------------------------------------

describe('syncSources: first sync (T-004.2)', () => {
  it('[T-004.2] fetches every sourcePages entry from docsBase + path + .md and ingests all 25', async () => {
    const result = await syncSources(h.deps)
    expect(ALL).toHaveLength(25)
    expect(h.fetchCalls.map((c) => c.url).sort()).toEqual(ALL.map((p) => `${CONFIG.docsBase}${p}.md`).sort())
    expect(h.kb.adds).toHaveLength(25)
    expect(result.added).toBe(25)
    expect(result.skipped).toBe(0)
    expect(result.errors).toEqual([])
    expect([...result.changedPages].sort()).toEqual([...ALL].sort())
  })

  it('[T-004.2] uploads each page as a markdown File named path__with__underscores.md into folder docs', async () => {
    await syncSources(h.deps)
    expect(h.kb.adds.map((a) => a.name).sort()).toEqual(ALL.map(fileFor).sort())
    for (const add of h.kb.adds) {
      expect(add.folder).toBe('docs')
      expect(add.type.startsWith('text/markdown')).toBe(true)
    }
    const external = h.kb.adds.find((a) => a.name === 'guides__external-apis.md')
    expect(external?.text).toBe('# guides/external-apis\n\nOriginal content of guides/external-apis.\n')
  })

  it('[T-004.2] stores one sources row per page, keyed by path with / replaced by __, with hash and item ids', async () => {
    await syncSources(h.deps)
    const rows = h.records.rows('sources')
    expect(rows.map((r) => r.id).sort()).toEqual(ALL.map(rowId).sort())
    for (const path of ALL) {
      const data = h.records.row('sources', rowId(path))
      expect(data?.path).toBe(path)
      expect(data?.contentHash).toBe(await oracle(`# ${path}\n\nOriginal content of ${path}.\n`))
      expect(data?.kbItemIds).toEqual(h.kb.idsFor(fileFor(path)))
      expect((data?.kbItemIds as string[]).length).toBeGreaterThan(0)
      expect(data?.indexStatus).toBe('completed')
      expect(ISO(data?.lastFetchedAt)).toBe(true)
    }
  })

  it('[T-004.2] sets kb_state.version to 1, lastChangedPages to every page, and lastSyncAt', async () => {
    const result = await syncSources(h.deps)
    const state = h.records.row('kb_state', 'global')
    expect(state?.version).toBe(1)
    expect(result.version).toBe(1)
    expect([...(state?.lastChangedPages as string[])].sort()).toEqual([...ALL].sort())
    expect(ISO(state?.lastSyncAt)).toBe(true)
    expect(h.records.rows('kb_state')).toHaveLength(1)
  })

  it('[T-004.2] polls kb.list in folder docs and waits until a slow item reaches completed', async () => {
    h.kb.statusFor = (key, poll) => (key === 'guides__messaging.md' && poll < 4 ? 'running' : 'completed')
    const result = await syncSources(h.deps)
    expect(h.kb.listOptions.length).toBeGreaterThan(0)
    for (const o of h.kb.listOptions) expect(o?.folder).toBe('docs')
    expect(h.sleeps.length).toBeGreaterThan(0)
    expect(result.indexing).toEqual([])
    expect(h.records.row('sources', 'guides__messaging')?.indexStatus).toBe('completed')
  })

  it.each<KnowledgeStatus>(['running', 'queued'])(
    '[T-004.2] times out after syncIndexWaitMs with indexStatus=indexing when an item stays %s, and still resolves',
    async (stuck) => {
      h.kb.statusFor = (key) => (key === 'guides__messaging.md' ? stuck : 'completed')
      const start = h.clock.ms
      const result = await syncSources(h.deps)
      expect(result.indexing).toEqual(['guides/messaging'])
      expect(h.records.row('sources', 'guides__messaging')?.indexStatus).toBe('indexing')
      expect(h.records.row('sources', 'index')?.indexStatus).toBe('completed')
      // Waited on the injected clock for at least the configured budget, but did not wait forever.
      expect(h.clock.ms - start).toBeGreaterThanOrEqual(CONFIG.job.syncIndexWaitMs)
      expect(h.clock.ms - start).toBeLessThan(CONFIG.job.syncIndexWaitMs * 3)
      // A page that was ingested but is not searchable yet still counts as a change.
      expect(result.version).toBe(1)
      expect(kbVersion()).toBe(1)
      expect(result.changedPages).toContain('guides/messaging')
    },
  )

  it('[T-004.2] honours a restricted pages list', async () => {
    const result = await syncSources({ ...h.deps, pages: ['index', 'concepts/permissions'] })
    expect(h.kb.adds.map((a) => a.name).sort()).toEqual(['concepts__permissions.md', 'index.md'])
    expect(result.added).toBe(2)
    expect(h.records.rows('sources')).toHaveLength(2)
  })

  it('[T-004.2] forwards the abort signal to every docs fetch', async () => {
    const controller = new AbortController()
    await syncSources({ ...h.deps, signal: controller.signal })
    expect(h.fetchCalls).toHaveLength(25)
    for (const call of h.fetchCalls) expect(call.signal).toBe(controller.signal)
  })

  it('[T-004.2] reverify is accepted and does not change ingestion behavior', async () => {
    const result = await syncSources(h.deps, { reverify: true })
    expect(result.added).toBe(25)
    expect(result.version).toBe(1)
  })
})

describe('syncSources: second sync with no changes (T-004.3)', () => {
  it('[T-004.3] makes 0 kb.add and 0 kb.remove calls and reports every page skipped', async () => {
    await syncSources(h.deps)
    const addsBefore = h.kb.adds.length
    const result = await syncSources(h.deps)
    expect(h.kb.adds.length).toBe(addsBefore)
    expect(h.kb.removes).toEqual([])
    expect(result.added).toBe(0)
    expect(result.skipped).toBe(25)
    expect(result.changedPages).toEqual([])
    expect(result.errors).toEqual([])
  })

  it('[T-004.3] does not bump kb_state.version and leaves lastChangedPages and item ids alone', async () => {
    await syncSources(h.deps)
    const before = structuredClone(h.records.row('kb_state', 'global'))
    const idsBefore = h.records.rows('sources').map((r) => [r.id, r.data.kbItemIds])
    const result = await syncSources(h.deps)
    expect(result.version).toBe(1)
    expect(h.records.row('kb_state', 'global')?.version).toBe(1)
    expect(h.records.row('kb_state', 'global')?.lastChangedPages).toEqual(before?.lastChangedPages)
    expect(h.records.rows('sources').map((r) => [r.id, r.data.kbItemIds])).toEqual(idsBefore)
  })

  it('[T-004.3] still fetches every page (that is how change is detected)', async () => {
    await syncSources(h.deps)
    h.fetchCalls.length = 0
    await syncSources(h.deps)
    expect(h.fetchCalls).toHaveLength(25)
  })
})

describe('syncSources: a page changes (T-004.4)', () => {
  const PAGE = 'guides/external-apis'
  const MODIFIED = '# guides/external-apis\n\nAnonymous callers may now trigger developer-billed calls.\n'

  it('[T-004.4] re-ingests only the changed page, with the new body, and removes only its old item ids', async () => {
    await syncSources(h.deps)
    const oldIds = h.kb.idsFor(fileFor(PAGE))
    expect(oldIds.length).toBeGreaterThan(0)
    const addsBefore = h.kb.adds.length

    h.bodies.set(PAGE, MODIFIED)
    const result = await syncSources(h.deps)

    const newAdds = h.kb.adds.slice(addsBefore)
    expect(newAdds).toHaveLength(1)
    expect(newAdds[0]?.name).toBe('guides__external-apis.md')
    expect(newAdds[0]?.text).toBe(MODIFIED)
    expect(newAdds[0]?.folder).toBe('docs')
    expect(h.kb.removes).toEqual(oldIds)
    expect(result.added).toBe(1)
    expect(result.skipped).toBe(24)
    expect(result.changedPages).toEqual([PAGE])
    expect(result.errors).toEqual([])
  })

  it('[T-004.4] uploads the new copy before removing the old one (never leaves the page unsearchable)', async () => {
    await syncSources(h.deps)
    h.kb.log.length = 0
    h.bodies.set(PAGE, MODIFIED)
    await syncSources(h.deps)
    const addAt = h.kb.log.indexOf('add:guides__external-apis.md')
    const removeAt = h.kb.log.findIndex((e) => e.startsWith('remove:'))
    expect(addAt).toBeGreaterThanOrEqual(0)
    expect(removeAt).toBeGreaterThan(addAt)
  })

  it('[T-004.4] updates that sources row (new hash, new ids) and leaves all other rows unchanged', async () => {
    await syncSources(h.deps)
    const snapshot = new Map(h.records.rows('sources').map((r) => [r.id, structuredClone(r.data)]))
    h.bodies.set(PAGE, MODIFIED)
    await syncSources(h.deps)

    const changed = h.records.row('sources', rowId(PAGE))
    expect(changed?.contentHash).toBe(await oracle(MODIFIED))
    expect(changed?.kbItemIds).toEqual([h.kb.idsFor(fileFor(PAGE)).at(-1)])
    expect(changed?.kbItemIds).not.toEqual(snapshot.get(rowId(PAGE))?.kbItemIds)
    expect(changed?.indexStatus).toBe('completed')
    for (const path of ALL.filter((p) => p !== PAGE)) {
      expect(h.records.row('sources', rowId(path))?.contentHash).toBe(snapshot.get(rowId(path))?.contentHash)
      expect(h.records.row('sources', rowId(path))?.kbItemIds).toEqual(snapshot.get(rowId(path))?.kbItemIds)
    }
    expect(h.records.rows('sources')).toHaveLength(25)
  })

  it('[T-004.4] bumps kb_state.version to 2 and records lastChangedPages = [that page]', async () => {
    await syncSources(h.deps)
    h.bodies.set(PAGE, MODIFIED)
    const result = await syncSources(h.deps)
    expect(result.version).toBe(2)
    const state = h.records.row('kb_state', 'global')
    expect(state?.version).toBe(2)
    expect(state?.lastChangedPages).toEqual([PAGE])
  })

  it('[T-004.4] a further sync with the change already ingested is a no-op (version stays 2)', async () => {
    await syncSources(h.deps)
    h.bodies.set(PAGE, MODIFIED)
    await syncSources(h.deps)
    const addsBefore = h.kb.adds.length
    const result = await syncSources(h.deps)
    expect(h.kb.adds.length).toBe(addsBefore)
    expect(result.version).toBe(2)
    expect(h.records.row('kb_state', 'global')?.lastChangedPages).toEqual([PAGE])
  })

  it('[T-004.4] two pages changing in one sync bump the version once and record both', async () => {
    await syncSources(h.deps)
    h.bodies.set(PAGE, MODIFIED)
    h.bodies.set('concepts/permissions', 'permissions rewritten')
    const result = await syncSources(h.deps)
    expect(result.version).toBe(2)
    expect([...(h.records.row('kb_state', 'global')?.lastChangedPages as string[])].sort()).toEqual(
      ['concepts/permissions', PAGE].sort(),
    )
    expect(result.added).toBe(2)
  })
})

describe('syncSources: one page fails (T-004.7)', () => {
  const BAD = 'guides/secrets'

  it('[T-004.7] a KnowledgeError from kb.add marks only that source error; everything else is processed', async () => {
    h.kb.failAdd.add(fileFor(BAD))
    const result = await syncSources(h.deps) // must resolve, not reject

    expect(h.records.row('sources', rowId(BAD))?.indexStatus).toBe('error')
    for (const path of ALL.filter((p) => p !== BAD)) {
      expect(h.records.row('sources', rowId(path))?.indexStatus).toBe('completed')
    }
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.path).toBe(BAD)
    expect(result.errors[0]?.message).toContain('boom')
    expect(result.changedPages).not.toContain(BAD)
    expect(result.changedPages).toHaveLength(24)
    expect(result.added).toBeLessThanOrEqual(25)
    expect(h.kb.adds.filter((a) => a.name === fileFor(BAD))).toEqual([])
    // The other 24 changed, so the version still moves.
    expect(result.version).toBe(1)
  })

  it('[T-004.7] a non-OK docs response marks only that source error and makes no kb.add for it', async () => {
    h.statuses.set(BAD, 404)
    const result = await syncSources(h.deps)
    expect(h.records.row('sources', rowId(BAD))?.indexStatus).toBe('error')
    expect(result.errors.map((e) => e.path)).toEqual([BAD])
    expect(result.changedPages).not.toContain(BAD)
    expect(h.kb.adds.map((a) => a.name)).not.toContain(fileFor(BAD))
    expect(h.kb.adds).toHaveLength(24)
    for (const path of ALL.filter((p) => p !== BAD)) {
      expect(h.records.row('sources', rowId(path))?.indexStatus).toBe('completed')
    }
  })

  it('[T-004.7] a failed re-ingest keeps the page\'s old kb items (nothing removed) and its old hash', async () => {
    await syncSources(h.deps)
    const before = structuredClone(h.records.row('sources', rowId(BAD)))
    h.kb.failAdd.add(fileFor(BAD))
    h.bodies.set(BAD, 'secrets page rewritten')
    const result = await syncSources(h.deps)

    expect(h.kb.removes).toEqual([])
    const row = h.records.row('sources', rowId(BAD))
    expect(row?.indexStatus).toBe('error')
    expect(row?.kbItemIds).toEqual(before?.kbItemIds)
    expect(row?.contentHash).toBe(before?.contentHash)
    expect(result.errors.map((e) => e.path)).toEqual([BAD])
    expect(result.changedPages).toEqual([])
    expect(result.version).toBe(1) // nothing was ingested, so no bump
  })

  it('[T-004.7] a failed page is retried on the next sync and recovers, touching only that page', async () => {
    h.kb.failAdd.add(fileFor(BAD))
    await syncSources(h.deps)
    h.kb.failAdd.clear()
    const addsBefore = h.kb.adds.length
    const result = await syncSources(h.deps)

    expect(h.kb.adds.slice(addsBefore).map((a) => a.name)).toEqual([fileFor(BAD)])
    expect(result.changedPages).toEqual([BAD])
    expect(result.errors).toEqual([])
    expect(h.records.row('sources', rowId(BAD))?.indexStatus).toBe('completed')
    expect(result.version).toBe(2)
  })

  it('[T-004.7] when every page fails the sync still resolves, with all errors and no version bump', async () => {
    for (const p of ALL) h.statuses.set(p, 500)
    const result = await syncSources(h.deps)
    expect(result.errors).toHaveLength(25)
    expect(result.changedPages).toEqual([])
    expect(h.kb.adds).toEqual([])
    expect(h.records.rows('kb_state').find((r) => r.id === 'global')?.data.version ?? 0).toBe(0)
  })
})
