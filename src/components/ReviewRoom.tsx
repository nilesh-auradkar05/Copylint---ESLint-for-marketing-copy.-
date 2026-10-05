import { useId } from 'react'
import { Check, CircleHelp, FileText, X } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Claim, Signoff, Version } from '@/engine/contracts'
import { CONFIG } from '@/engine/config'
import { blockingClaims, shipReady } from '@/engine/gate'
import { segmentBySpans } from '@/engine/spans'

type ReviewRoomProps = {
  draft: { recordId: string; data: { title: string; channel: string; body: string } }
  version?: Version
  claims: readonly Claim[]
  signoffs: readonly Signoff[]
  kbVersion: number
  loading?: boolean
  failureReason?: string
  onRecheck?: () => void
}

const verdictOrder = { contradicted: 0, unsupported: 1, supported: 2 }
const verdictIcons = { contradicted: X, unsupported: CircleHelp, supported: Check }

export function ReviewRoom({ draft, version, claims, signoffs, kbVersion, loading = false, failureReason, onRecheck }: ReviewRoomProps) {
  const id = useId()
  const selected = version?.draftId === draft.recordId ? version : undefined
  const currentClaims = claims.filter(c => selected && c.versionId === selected.id && c.draftId === draft.recordId)
    .sort((a, b) => verdictOrder[a.verdict] - verdictOrder[b.verdict])
  const currentSignoffs = signoffs.filter(s => selected && s.versionId === selected.id)
  const body = selected?.body ?? draft.data.body
  const segments = segmentBySpans(body, currentClaims)
  const failed = selected?.status === 'failed' || !!failureReason
  const stale = selected && selected.kbVersion !== kbVersion
  const edited = selected && selected.body !== draft.data.body
  const checking = loading || selected?.status === 'checking'
  let gate = 'DRAFT'
  if (checking) gate = 'CHECKING'
  else if (failed) gate = 'FAILED'
  else if (stale) gate = 'STALE'
  else if (edited) gate = 'DRAFT · RE-CHECK NEEDED'
  else if (selected) gate = shipReady(selected, currentClaims, currentSignoffs, kbVersion)
    ? 'SHIP-READY' : `BLOCKED ${blockingClaims(currentClaims, currentSignoffs).length}`

  const cardId = (claim: Claim) => `${id}-card-${claim.id}`
  const spanId = (index: number) => `${id}-span-${index}`
  const focus = (target: string) => document.getElementById(target)?.focus()

  return <section className="proof-page proof-review">
    <header className="proof-row proof-review-header">
      <div><p className="proof-kicker">The review desk · {draft.data.channel}</p><h1>{draft.data.title}</h1>
        <p className="proof-muted proof-source">{selected ? `Snapshot ${selected.id.slice(0, 8)} · docs v${selected.kbVersion}` : 'No checked snapshot yet'}</p></div>
      <Badge role="status" variant="outline" className="proof-verdict">{gate}</Badge>
    </header>
    {stale && <p role="alert" className="proof-review-notice">Docs have changed. This snapshot is stale; re-check against docs v{kbVersion}.</p>}
    {edited && <p className="proof-review-notice">The draft has changed. These highlights belong to the saved snapshot; re-check the edited draft.</p>}
    {failed && <div role="alert" className="proof-error proof-review-notice">
      <p>{failureReason || 'The check failed before it could finish. Re-check to try again.'}</p>
      <Button variant="outline" size="sm" disabled={!onRecheck || checking} onClick={() => onRecheck?.()}>Re-check</Button>
    </div>}
    <div className="proof-review-columns">
      <div className="proof-sheet">
        <h2 className="proof-kicker">Draft snapshot</h2>
        <div role="region" aria-label="Draft snapshot" className="proof-snapshot">{segments.map((segment, index) => {
          const claim = currentClaims.find(c => segment.claimIds.includes(c.id))
          return claim ? <Button key={index} id={spanId(index)} variant="ghost" disabled={loading}
            className={`proof-highlight proof-${segment.verdict}`} aria-label={`${segment.verdict}: ${segment.text}`}
            aria-controls={cardId(claim)} onClick={() => focus(cardId(claim))}>{segment.text}</Button>
            : <span key={index}>{segment.text}</span>
        })}</div>
      </div>
      <div aria-label="Claim review" className="proof-claims" aria-busy={loading || undefined}>
        <h2 className="proof-kicker">Claims · {currentClaims.length}</h2>
        {loading ? <div role="status" aria-label="Loading claim review" className="proof-review-skeleton">
          {[0, 1, 2].map(n => <div key={n} className="proof-sheet motion-safe:animate-pulse" aria-hidden="true"><div className="h-4 w-1/3 bg-muted" /><div className="mt-4 h-20 bg-muted" /></div>)}
        </div> : currentClaims.map(claim => {
          const Icon = verdictIcons[claim.verdict]
          const index = segments.findIndex(segment => segment.claimIds.includes(claim.id))
          return <article key={claim.id} id={cardId(claim)} tabIndex={-1} aria-label={claim.text} className="proof-sheet proof-claim">
            <div className="proof-row">
              <Badge className={`proof-verdict proof-${claim.verdict}`}><Icon size={14} aria-hidden="true" />{claim.verdict}</Badge>{' '}
              <span className="proof-muted proof-kicker">{claim.confidence} confidence</span>
            </div>
            <h3>{claim.text}</h3>
            <blockquote className="proof-quote">{claim.quote}</blockquote>
            {index >= 0 && <Button variant="link" size="sm" aria-controls={spanId(index)} onClick={() => focus(spanId(index))}>Show in draft</Button>}
            <p>{claim.reason}</p>
            {claim.evidence.length ? claim.evidence.map((evidence, n) => <div key={`${evidence.chunkId}-${n}`} className="proof-evidence">
              <a className="proof-source" href={`${CONFIG.docsBase}${evidence.page}`} target="_blank" rel="noopener noreferrer">{evidence.page}</a>
              <blockquote>{evidence.excerpt}</blockquote>
            </div>) : <p className="proof-muted">No cited evidence.</p>}
            {claim.verdict === 'contradicted' && <div className="proof-evidence"><p className="proof-kicker">Suggested fix</p><p>{claim.fix || 'No fix suggested.'}</p></div>}
          </article>
        })}
        {!loading && !failed && currentClaims.length === 0 && <EmptyState icon={<FileText aria-hidden="true" />}
          title={selected?.status === 'checked' ? 'No checkable claims found' : checking ? 'Checking claims' : 'Ready for a first check'}
          description={checking ? 'Claims will appear as the check progresses.' : selected ? 'This snapshot has no claim cards to review.' : 'Check the draft to bring its evidence here.'} />}
      </div>
    </div>
  </section>
}
