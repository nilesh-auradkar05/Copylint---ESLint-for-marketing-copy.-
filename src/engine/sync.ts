/**
 * `sync-sources` (SPEC §8 steps 1-3): fetch each curated docs page, ingest changed pages into the
 * managed knowledge base, wait (bounded) for indexing, and bump `kb_state.version` when anything
 * changed. All I/O comes in through `SyncDeps`, so this module is pure orchestration.
 *
 * One bad page never fails the sync: it is marked `error`, reported in `result.errors`, and its old
 * hash and kb items are left alone so the next sync retries it.
 */

import { z } from 'zod'
import type { ActionResult, ActionTools, KnowledgeClient, KnowledgeItem } from 'deepspace/worker'
import { CONFIG } from './config'
import { sha256hex } from './ids'
import { filenameForPath } from './retrieve'

export interface SyncDeps {
  fetch: typeof fetch
  kb: Pick<KnowledgeClient, 'add' | 'list' | 'remove'>
  records: Pick<ActionTools, 'get' | 'query' | 'create' | 'update'>
  signal?: AbortSignal
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  pages?: readonly string[]
}

export interface SyncResult {
  version: number
  changedPages: string[]
  added: number
  skipped: number
  errors: Array<{ path: string; message: string }>
  indexing: string[]
}

type IndexStatus = 'queued' | 'indexing' | 'completed' | 'error'

const StoredSource = z.object({
  contentHash: z.string().default(''),
  kbItemIds: z.array(z.string()).default([]),
  indexStatus: z.string().default(''),
})
type StoredSource = z.infer<typeof StoredSource>

const StoredKbState = z.object({ version: z.number().default(0) })

const sourceId = (path: string): string => path.replaceAll('/', '__')
const KB_STATE_ID = 'global'

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** A record-tool failure is infrastructure, not a page problem: let it fail (and retry) the job. */
function must<T>(what: string, result: ActionResult<T>): T {
  if (!result.success) throw new Error(`${what}: ${result.error}`)
  return result.data
}

export async function syncSources(
  deps: SyncDeps,
  // Accepted for the job contract; staleness handling is T-020.
  _opts: { reverify?: boolean } = {},
): Promise<SyncResult> {
  const { kb, records, signal } = deps
  const now = deps.now ?? ((): Date => new Date())
  const sleep = deps.sleep ?? defaultSleep
  const pages = deps.pages ?? CONFIG.sourcePages

  const changedPages: string[] = []
  const errors: SyncResult['errors'] = []
  let skipped = 0
  /** path -> kb item ids whose indexing we still need to observe. */
  const pending = new Map<string, string[]>()

  async function readSource(path: string): Promise<StoredSource | null> {
    const res = await records.get('sources', sourceId(path))
    if (!res.success) return null
    return StoredSource.parse(res.data.record.data)
  }

  async function writeSource(path: string, existed: boolean, data: Record<string, unknown>): Promise<void> {
    const id = sourceId(path)
    const res = existed
      ? await records.update('sources', id, data)
      : await records.create('sources', { path, ...data }, id)
    must(`write sources/${id}`, res)
  }

  for (const path of pages) {
    const stored = await readSource(path)
    const existed = stored !== null
    const fetchedAt = now().toISOString()

    let body: string
    try {
      const res = await deps.fetch(`${CONFIG.docsBase}${path}.md`, { signal })
      if (!res.ok) throw new Error(`docs fetch for ${path} returned HTTP ${res.status}`)
      body = await res.text()
    } catch (err) {
      if (signal?.aborted) throw err
      errors.push({ path, message: messageOf(err) })
      await writeSource(
        path,
        existed,
        existed
          ? { indexStatus: 'error', lastFetchedAt: fetchedAt }
          : { contentHash: '', kbItemIds: [], indexStatus: 'error', lastFetchedAt: fetchedAt },
      )
      continue
    }

    const contentHash = await sha256hex(body)
    if (stored && stored.contentHash === contentHash) {
      skipped += 1
      await writeSource(path, true, { lastFetchedAt: fetchedAt })
      // A previous run may have left this page mid-indexing or errored: observe it again.
      if (stored.indexStatus !== 'completed' && stored.kbItemIds.length > 0) {
        pending.set(path, stored.kbItemIds)
      }
      continue
    }

    // Upload the new copy first, remove the old one after: the page is never unsearchable.
    let newIds: string[]
    try {
      const file = new File([body], filenameForPath(path), { type: 'text/markdown' })
      const added = await kb.add(file, { folder: CONFIG.kb.folder })
      newIds = added.items.map((item) => item.id)
    } catch (err) {
      if (signal?.aborted) throw err
      errors.push({ path, message: messageOf(err) })
      await writeSource(
        path,
        existed,
        existed
          ? { indexStatus: 'error', lastFetchedAt: fetchedAt }
          : { contentHash: '', kbItemIds: [], indexStatus: 'error', lastFetchedAt: fetchedAt },
      )
      continue
    }

    for (const oldId of stored?.kbItemIds ?? []) {
      try {
        await kb.remove(oldId)
      } catch (err) {
        if (signal?.aborted) throw err
        errors.push({ path, message: `could not remove previous copy ${oldId}: ${messageOf(err)}` })
      }
    }

    await writeSource(path, existed, {
      contentHash,
      kbItemIds: newIds,
      indexStatus: 'queued',
      lastFetchedAt: fetchedAt,
    })
    changedPages.push(path)
    pending.set(path, newIds)
  }

  /** Polls kb.list until every pending page is completed or errored, or the wait budget runs out. */
  async function waitForIndexing(): Promise<string[]> {
    const outcome = new Map<string, IndexStatus>()
    if (pending.size === 0) return []
    const deadline = now().getTime() + CONFIG.job.syncIndexWaitMs

    for (;;) {
      const items = await listAllItems()
      outcome.clear()
      for (const [path, ids] of pending) outcome.set(path, resolveStatus(ids, items))
      const waiting = [...outcome.values()].some((s) => s !== 'completed' && s !== 'error')
      if (!waiting) break
      const remaining = deadline - now().getTime()
      if (remaining <= 0) break
      await sleep(Math.min(CONFIG.job.syncPollMs, remaining))
    }

    const stillIndexing: string[] = []
    for (const [path, status] of outcome) {
      const final: IndexStatus = status === 'completed' || status === 'error' ? status : 'indexing'
      if (final === 'indexing') stillIndexing.push(path)
      const failed = final === 'error'
      // An item that failed to index is not searchable: blank the hash so the next sync re-uploads it.
      await writeSource(path, true, failed ? { indexStatus: final, contentHash: '' } : { indexStatus: final })
      if (failed) errors.push({ path, message: 'knowledge indexing failed' })
    }
    return stillIndexing
  }

  async function listAllItems(): Promise<Map<string, KnowledgeItem>> {
    const items = new Map<string, KnowledgeItem>()
    const perPage = CONFIG.job.syncListPerPage
    for (let page = 1; ; page += 1) {
      const res = await kb.list({ folder: CONFIG.kb.folder, page, perPage })
      for (const item of res.items) items.set(item.id, item)
      const last = res.totalPages !== undefined ? page >= res.totalPages : res.items.length < perPage
      if (last || res.items.length === 0) return items
    }
  }

  const indexing = await waitForIndexing()

  let version = 0
  const stateRes = await records.get('kb_state', KB_STATE_ID)
  const stateExists = stateRes.success
  if (stateRes.success) version = StoredKbState.parse(stateRes.data.record.data).version
  if (changedPages.length > 0) {
    version += 1
    const state = { version, lastSyncAt: now().toISOString(), lastChangedPages: changedPages }
    must(
      'write kb_state/global',
      stateExists
        ? await records.update('kb_state', KB_STATE_ID, state)
        : await records.create('kb_state', state, KB_STATE_ID),
    )
  }

  return { version, changedPages, added: changedPages.length, skipped, errors, indexing }
}

/** Collapses the SDK's per-item statuses (running -> indexing, etc.) into one source status. */
function resolveStatus(ids: string[], items: Map<string, KnowledgeItem>): IndexStatus {
  let sawError = false
  let allCompleted = true
  for (const id of ids) {
    const status = items.get(id)?.status
    if (status === 'error') sawError = true
    if (status !== 'completed' && status !== 'skipped') allCompleted = false
  }
  if (sawError) return 'error'
  return allCompleted ? 'completed' : 'indexing'
}
