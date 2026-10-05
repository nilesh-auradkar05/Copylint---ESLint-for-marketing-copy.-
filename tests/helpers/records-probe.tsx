// Test-only generic records probe (T-002 live RBAC matrix). Uses the real SDK hooks over the real
// records WebSocket, for ANY collection, so tests assert what the server allows or refuses.
// Inject after `page.goto('/home')`:
//   await page.evaluate(() => { window.recordsProbeConfig = { allowAnonymous: true } })   // optional
//   await page.addScriptTag({ type: 'module', url: '/tests/helpers/records-probe.tsx' })
// One probe per page: modules execute once, so open a fresh page for each identity.
import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import {
  DeepSpaceAuthProvider,
  RecordProvider,
  RecordScope,
  getAuthToken,
  useMutations,
  useQuery,
  useUser,
} from 'deepspace'
import { SCOPE_ID } from '../../src/constants'
import { schemas } from '../../src/schemas'

type Row = { recordId: string; createdBy: string; data: Record<string, unknown> }
type Mutations = ReturnType<typeof useMutations<Record<string, unknown>>>
type Slot = { rows: Row[]; status: string; error?: string; ready: boolean; mutations?: Mutations }
type WriteResult = { ok: true; id: string } | { ok: false; error: string }

export type RecordsProbe = {
  /** True once every collection is queried and every room accepts writes. */
  ready: () => boolean
  /** Per-collection query status: loading | ready | error. */
  status: (collection: string) => string
  error: (collection: string) => string | undefined
  rows: (collection: string) => Row[]
  /** The signed-in identity as the SDK sees it (role is the room role). */
  me: () => { id: string | null; role: string | null }
  create: (collection: string, data: Record<string, unknown>) => Promise<WriteResult>
  put: (collection: string, id: string, patch: Record<string, unknown>) => Promise<WriteResult>
  remove: (collection: string, id: string) => Promise<WriteResult>
  /** Bearer JWT for server routes. Never log it. */
  token: () => Promise<string | null>
}

declare global {
  interface Window {
    recordsProbeConfig?: { allowAnonymous?: boolean }
    recordsProbe?: RecordsProbe
  }
}

const COLLECTIONS = ['drafts', 'draft_versions', 'claims', 'signoffs', 'publications', 'sources', 'kb_state', 'users', 'settings']
const slots: Record<string, Slot> = {}
let user: { id: string | null; role: string | null } = { id: null, role: null }

function Collection({ name }: { name: string }) {
  const { records, status, error } = useQuery<Record<string, unknown>>(name)
  const mutations = useMutations<Record<string, unknown>>(name)
  useEffect(() => {
    slots[name] = {
      rows: records.map(r => ({ recordId: r.recordId, createdBy: r.createdBy, data: r.data })),
      status,
      error,
      ready: mutations.ready,
      mutations,
    }
  })
  return null
}

function Me() {
  const { user: u } = useUser()
  useEffect(() => {
    user = { id: u?.id ?? null, role: u?.role ?? null }
  })
  return null
}

async function attempt(run: () => Promise<string | void>): Promise<WriteResult> {
  try {
    const id = await run()
    return { ok: true, id: id ?? '' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function mutationsFor(collection: string): Mutations {
  const m = slots[collection]?.mutations
  if (!m) throw new Error(`probe: no mutations for ${collection}`)
  return m
}

window.recordsProbe = {
  ready: () => COLLECTIONS.every(c => slots[c]?.ready && slots[c].status !== 'loading'),
  status: c => slots[c]?.status ?? 'loading',
  error: c => slots[c]?.error,
  rows: c => slots[c]?.rows ?? [],
  me: () => user,
  create: (c, data) => attempt(() => mutationsFor(c).createConfirmed(data)),
  put: (c, id, patch) => attempt(() => mutationsFor(c).putConfirmed(id, patch)).then(r => (r.ok ? { ok: true, id } : r)),
  remove: (c, id) => attempt(() => mutationsFor(c).removeConfirmed(id)).then(r => (r.ok ? { ok: true, id } : r)),
  token: () => getAuthToken(),
}

createRoot(document.body.appendChild(document.createElement('div'))).render(
  <DeepSpaceAuthProvider>
    <RecordProvider allowAnonymous={window.recordsProbeConfig?.allowAnonymous === true}>
      <RecordScope roomId={SCOPE_ID} schemas={schemas}>
        <Me />
        {COLLECTIONS.map(name => <Collection key={name} name={name} />)}
      </RecordScope>
    </RecordProvider>
  </DeepSpaceAuthProvider>,
)
