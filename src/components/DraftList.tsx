import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import sample from '../../seed/launch-thread.md?raw'
import type { DraftCreate, DraftInput } from './DraftForm'
import type { Claim, Signoff, Version } from '@/engine/contracts'
import { blockingClaims, shipReady } from '@/engine/gate'

export type DraftRow = { recordId: string; updatedAt: string; data: DraftInput & { latestVersionId?: string } }
export type PublicationRow = { recordId: string; data: { draftId: string; versionId: string; status: 'live' | 'stale' } }
export function DraftList({ drafts, ready, onCreate, versions = [], claims = [], signoffs = [], publications = [], kbVersion, dataReady = true }: {
  drafts: DraftRow[]; ready: boolean; onCreate: DraftCreate; versions?: Version[]; claims?: Claim[];
  signoffs?: Signoff[]; publications?: PublicationRow[]; kbVersion?: number; dataReady?: boolean
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  function badge(draft: DraftRow) {
    if (!dataReady) return '… LOADING'
    const version = versions.find(v => v.id === draft.data.latestVersionId && v.draftId === draft.recordId && v.body === draft.data.body)
    if (!version) return '○ DRAFT'
    if (version.status === 'checking') return '◌ CHECKING'
    if (version.status !== 'checked') return '○ DRAFT'
    const currentPublications = publications.filter(p => p.data.draftId === draft.recordId && p.data.versionId === version.id)
    if (currentPublications.some(p => p.data.status === 'stale') || (kbVersion !== undefined && version.kbVersion !== kbVersion)) return '! STALE'
    if (currentPublications.some(p => p.data.status === 'live')) return '✓ PUBLISHED'
    if (kbVersion === undefined) return '○ DRAFT'
    const currentClaims = claims.filter(c => c.draftId === draft.recordId && c.versionId === version.id)
    const currentSignoffs = signoffs.filter(s => s.versionId === version.id)
    return shipReady(version, currentClaims, currentSignoffs, kbVersion) ? '✓ SHIP-READY' : `! BLOCKED ${blockingClaims(currentClaims, currentSignoffs).length}`
  }
  async function createSample() {
    if (!ready || pending) return
    setPending(true); setError(''); setSaved(false)
    try { await onCreate({ title: 'DeepSpace launch thread', channel: 'thread', body: sample }); setSaved(true) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not create the sample. Try again.') }
    finally { setPending(false) }
  }
  return <section className="proof-page">
    <header className="proof-row"><div><p className="proof-kicker">The writing desk</p><h1>Drafts</h1></div><a className="proof-link" href="/drafts/new">New draft →</a></header>
    <p className="proof-muted">A place for your next technical claim. Start with the words; bring the evidence next.</p>
    {error && <p role="alert" className="proof-error">{error} Retry with “Create from sample”.</p>}
    {saved && <p role="status">Sample draft created.</p>}
    {drafts.length === 0 ? <div className="proof-empty">
      <EmptyState title="Your first draft starts here" description="Paste something you're writing, or try the DeepSpace launch thread." />
      <Button disabled={!ready} loading={pending} onClick={createSample}>Create from sample</Button>
      {!ready && <p className="proof-muted" role="status">Draft creation is currently unavailable.</p>}
    </div> : <ul className="proof-list">{drafts.map(record => <li key={record.recordId} className="proof-row">
      <div><a href={`/drafts/${encodeURIComponent(record.recordId)}`} className="proof-draft-title">{record.data.title}</a><p className="proof-muted">{record.data.channel} · Updated <time dateTime={record.updatedAt}>{new Date(record.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</time></p></div>
      <Badge variant="outline" className="proof-verdict">{badge(record)}</Badge>
    </li>)}</ul>}
  </section>
}
