/**
 * `sync-sources` (SPEC §8 steps 1-3): fetch each curated docs page, ingest changed pages into the
 * managed knowledge base, wait (bounded) for indexing, and bump `kb_state.version` when anything
 * changed. All I/O comes in through `SyncDeps`, so this module is pure orchestration.
 *
 * One bad page never fails the sync: it is marked `error`, reported in `result.errors`, and its old
 * hash and kb items are left alone so the next sync retries it.
 *
 * The new copy is uploaded first and the old one removed right after the add, before the new item is
 * indexed, so a page can briefly be unsearchable. A failed remove keeps the old id on the row
 * (after the current id) and is retried on a later sync. If the sync fails after a page changed, the
 * `kb_state` version bump is still persisted, because the page's new hash is already stored.
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

  /** Removes `ids` (never one in `keep`, e.g. an upsert that reused the id); returns those that failed. */
  async function removeAll(path: string, ids: string[], keep: string[]): Promise<string[]> {
    const failed: string[] = []
    for (const id of ids) {
      if (keep.includes(id)) continue
      try {
        await kb.remove(id)
      } catch (err) {
        if (signal?.aborted) throw err
        errors.push({ path, message: `could not remove previous copy ${id}: ${messageOf(err)}` })
        failed.push(id)
      }
    }
    return failed
  }

  async function ingestPages(): Promise<void> {
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
        // One uploaded file is one item, so ids after the first are leftovers from a failed remove.
        const [current, ...leftovers] = stored.kbItemIds
        const kept = await removeAll(path, leftovers, [])
        await writeSource(
          path,
          true,
          leftovers.length > 0 ? { lastFetchedAt: fetchedAt, kbItemIds: current ? [current, ...kept] : kept } : { lastFetchedAt: fetchedAt },
        )
        // A previous run may have left this page mid-indexing or errored: observe it again.
        if (stored.indexStatus !== 'completed' && current !== undefined) pending.set(path, [current])
        continue
      }

      // Upload the new copy first, then remove the old one(s).
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

      const leftovers = await removeAll(path, stored?.kbItemIds ?? [], newIds)

      await writeSource(path, existed, {
        contentHash,
        kbItemIds: [...newIds, ...leftovers],
        indexStatus: 'queued',
        lastFetchedAt: fetchedAt,
      })
      changedPages.push(path)
      pending.set(path, newIds)
    }
  }

  /** Polls kb.list until every pending page is completed or errored, or the wait budget runs out. */
  async function waitForIndexing(): Promise<string[]> {
    const outcome = new Map<string, IndexStatus>()
    if (pending.size === 0) return []
    const deadline = now().getTime() + CONFIG.job.syncIndexWaitMs
    /** Every item id any poll returned: an id never listed at all did not make it into the index. */
    const seen = new Set<string>()

    for (;;) {
      signal?.throwIfAborted()
      const items = await listAllItems()
      signal?.throwIfAborted()
      for (const id of items.keys()) seen.add(id)
      outcome.clear()
      for (const [path, ids] of pending) outcome.set(path, resolveStatus(ids, items))
      const waiting = [...outcome.values()].some((s) => s !== 'completed' && s !== 'error')
      if (!waiting) break
      const remaining = deadline - now().getTime()
      if (remaining <= 0) break
      await sleep(Math.min(CONFIG.job.syncPollMs, remaining))
      signal?.throwIfAborted()
    }

    const stillIndexing: string[] = []
    for (const [path, status] of outcome) {
      const neverListed = !(pending.get(path) ?? []).some((id) => seen.has(id))
      const final: IndexStatus =
        status === 'completed' || status === 'error' ? status : neverListed ? 'error' : 'indexing'
      if (final === 'indexing') stillIndexing.push(path)
      const failed = final === 'error'
      // An item that failed to index is not searchable: blank the hash so the next sync re-uploads it.
      await writeSource(path, true, failed ? { indexStatus: final, contentHash: '' } : { indexStatus: final })
      if (failed) {
        errors.push({
          path,
          message: neverListed && status !== 'error' ? 'knowledge item never appeared in the index' : 'knowledge indexing failed',
        })
      }
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

  /** Reads `kb_state`; when a page changed, bumps and persists it. Returns the current version. */
  async function commitVersion(): Promise<number> {
    const stateRes = await records.get('kb_state', KB_STATE_ID)
    let version = stateRes.success ? StoredKbState.parse(stateRes.data.record.data).version : 0
    if (changedPages.length === 0) return version
    version += 1
    const state = { version, lastSyncAt: now().toISOString(), lastChangedPages: changedPages }
    must(
      'write kb_state/global',
      stateRes.success
        ? await records.update('kb_state', KB_STATE_ID, state)
        : await records.create('kb_state', state, KB_STATE_ID),
    )
    return version
  }

  let indexing: string[]
  try {
    await ingestPages()
    indexing = await waitForIndexing()
  } catch (err) {
    // A changed page's new hash is already stored, so the next sync will see it as unchanged:
    // persist the bump now or the change never surfaces as drift. Never mask the original error.
    if (changedPages.length > 0) {
      await commitVersion().catch((e: unknown) =>
        console.error('[sync-sources] kb_state bump failed after sync error:', String(e)),
      )
    }
    throw err
  }

  const version = await commitVersion()
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
