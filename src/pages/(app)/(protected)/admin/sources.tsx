import { useState } from 'react'
import { getAuthToken, useJobs, useQuery, useUser } from 'deepspace'
import { Button } from '@/components/ui/Button'
import { SCOPE_ID } from '@/constants'

type Source = { path: string; indexStatus?: string; lastFetchedAt?: string }

// ponytail: minimal T-016.3 so the docs knowledge base can be loaded; cron row and Run now come with T-020.
export default function SourcesPage() {
  const { user, isLoading } = useUser()
  const sources = useQuery<Source>('sources')
  const kb = useQuery<{ version: number }>('kb_state')
  const { jobs } = useJobs(SCOPE_ID)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (isLoading) return <section className="proof-page" aria-busy="true" role="status"><p>Loading…</p></section>
  // UX only: the route itself answers 403 to non-admins.
  if (user?.role !== 'admin') return <section className="proof-page"><h1>Admins only</h1><p className="proof-muted">Syncing the docs is limited to engineers. <a className="proof-link" href="/drafts">Back to drafts →</a></p></section>
  const job = jobs.find(candidate => candidate.type === 'sync-sources' && (candidate.status === 'queued' || candidate.status === 'running'))
  const sync = async () => {
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/admin/sync', { method: 'POST', headers: { Authorization: `Bearer ${await getAuthToken()}` } })
      if (!response.ok) setError((await response.json().catch(() => null) as { error?: string } | null)?.error ?? `Sync failed (${response.status}).`)
    } catch { setError('Could not reach the server. Try again.') } finally { setBusy(false) }
  }
  const rows = [...sources.records].sort((a, b) => a.data.path.localeCompare(b.data.path))
  return <section className="proof-page">
    <header className="proof-row"><div><p className="proof-kicker">Ground truth</p><h1>Docs sources</h1>
      <p className="proof-muted">{rows.length} pages · docs v{kb.records.find(record => record.recordId === 'global')?.data.version ?? 0}</p></div>
      <Button disabled={busy || !!job} onClick={sync}>Sync now</Button></header>
    {error && <p role="alert" className="proof-error">{error}</p>}
    {job && <p role="status" aria-live="polite">Syncing… {job.progressMessage ?? ''}{job.progress != null && ` ${Math.round(job.progress * 100)}%`}</p>}
    {sources.status === 'ready' && rows.length === 0 && !job && <p className="proof-muted">No docs synced yet. Checks have nothing to cite until you sync.</p>}
    {rows.length > 0 && <table><thead><tr><th scope="col">Page</th><th scope="col">Index</th><th scope="col">Last fetched</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.recordId}><td>{row.data.path}</td><td>{row.data.indexStatus ?? ''}</td><td>{row.data.lastFetchedAt ? new Date(row.data.lastFetchedAt).toLocaleString() : ''}</td></tr>)}</tbody></table>}
  </section>
}
