import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import type { Claim, Signoff } from '@/engine/contracts'

export type SignoffDecision = { claim: Claim; decision: 'approve' | 'cut'; note: string; existing?: Signoff }

type SignoffPanelProps = {
  claims: readonly Claim[]
  signoffs: readonly Signoff[]
  versionId: string
  isAdmin: boolean
  userId: string
  ready: boolean
  names: Record<string, string>
  onDecide: (input: SignoffDecision) => Promise<void>
}

// Presentational only: the server (schema permissions) is the real admin gate; hiding controls is UX.
function ClaimRow({ claim, signoffs, isAdmin, userId, ready, names, onDecide }: Omit<SignoffPanelProps, 'claims' | 'versionId'> & { claim: Claim }) {
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const existing = signoffs.find(s => s.reviewerId === userId)

  const decide = async (decision: 'approve' | 'cut') => {
    const trimmed = note.trim()
    if (!trimmed) { setError('Add a note explaining your decision.'); return }
    setError(''); setPending(true)
    try { await onDecide({ claim, decision, note: trimmed, existing }) }
    catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : 'Could not save the sign-off. Try again.') }
    finally { setPending(false) }
  }

  return <article className="proof-sheet proof-claim">
    <div className="proof-row"><Badge className={`proof-verdict proof-${claim.verdict}`}>{claim.verdict}</Badge></div>
    <h3>{claim.text}</h3>
    {signoffs.length > 0 && <ul aria-label="Existing sign-offs">{signoffs.map(s => <li key={s.id}>
      <strong>{names[s.reviewerId] ?? 'Engineer'}</strong>{' · '}{s.decision === 'cut' ? 'cut, edit required' : 'approved'}
      <p className="proof-muted">{s.note}</p>
    </li>)}</ul>}
    {isAdmin && <div>
      <Input aria-label="Sign-off note" placeholder="Why approve or cut this claim?" value={note} disabled={pending} onChange={event => setNote(event.target.value)} />
      <div className="proof-row" style={{ justifyContent: 'flex-start', gap: '0.5rem', marginTop: '0.5rem' }}>
        <Button size="sm" disabled={!ready || pending} onClick={() => void decide('approve')}>Approve</Button>
        <Button size="sm" variant="outline" disabled={!ready || pending} onClick={() => void decide('cut')}>Cut</Button>
      </div>
      {error && <p role="alert" className="proof-error">{error}</p>}
    </div>}
  </article>
}

export function SignoffPanel({ claims, signoffs, versionId, ...rest }: SignoffPanelProps) {
  const open = claims.filter(claim => claim.verdict !== 'supported')
  if (open.length === 0) return null
  const current = signoffs.filter(s => s.versionId === versionId)
  return <section className="proof-page" aria-label="Engineer sign-off">
    <h2 className="proof-kicker">Needs an engineer · {open.length}</h2>
    {open.map(claim => <ClaimRow key={claim.id} claim={claim} signoffs={current.filter(s => s.claimId === claim.id)} {...rest} />)}
  </section>
}
