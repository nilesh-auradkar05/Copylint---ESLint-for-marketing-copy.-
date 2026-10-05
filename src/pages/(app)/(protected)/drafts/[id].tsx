import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { getAuthToken, useJobs, useMutations, useQuery, useUser, useUsers } from 'deepspace'
import { ReviewRoom } from '@/components/ReviewRoom'
import { SignoffPanel, type SignoffDecision } from '@/components/SignoffPanel'
import type { DraftInput } from '@/components/DraftForm'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { useFixAndPublish } from '@/components/useFixAndPublish'
import { CONFIG } from '@/engine/config'
import type { Claim, Signoff, Version } from '@/engine/contracts'
import { SCOPE_ID } from '@/constants'

// ponytail: thin live adapter so draft links resolve; T-011b (Lane B) adds useJobs progress and per-status copy.
export default function DraftPage() {
  const { id = '' } = useParams()
  const drafts = useQuery<DraftInput & { latestVersionId?: string }>('drafts')
  const versions = useQuery<Omit<Version, 'id'>>('draft_versions')
  const claims = useQuery<Omit<Claim, 'id'>>('claims')
  const signoffs = useQuery<Omit<Signoff, 'id'>>('signoffs')
  const kb = useQuery<{ version: number }>('kb_state')
  const { jobs } = useJobs(SCOPE_ID)
  const { user } = useUser()
  const { users } = useUsers()
  // reviewerId is userBound: the server stamps it, so the client never sends it.
  const signoffWrites = useMutations<Omit<Signoff, 'id' | 'reviewerId'>>('signoffs')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [publishedUrl, setPublishedUrl] = useState('')
  const [url, setUrl] = useState('')
  const draftWrites = useMutations<Partial<DraftInput>>('drafts')
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const queries = [drafts, versions, claims, signoffs, kb]
  // Newest version for this draft, not `latestVersionId`: the job links that only once a check succeeds,
  // which hid `checking` and `failed` checks entirely.
  const version = versions.records.filter(record => record.data.draftId === id)
    .sort((a, b) => b.data.requestedAt.localeCompare(a.data.requestedAt))[0]
  const job = jobs.find(candidate => candidate.id === version?.data.jobId)
  const check = async () => {
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/drafts/${encodeURIComponent(id)}/check`, { method: 'POST', headers: { Authorization: `Bearer ${await getAuthToken()}` } })
      const result = await response.json().catch(() => null) as { error?: string; cached?: boolean; versionId?: string } | null
      if (!response.ok) { setError(result?.error ?? `Check failed (${response.status}).`); return undefined }
      // Same text and same docs version resolve to the same snapshot, so the route returns it without a model call.
      else if (result?.cached) setNotice('Nothing to re-check: this exact text was already checked against the current docs. Edit the draft, or wait for a docs update, to run a new check.')
      return result?.versionId
    } catch { setError('Could not reach the server. Try again.'); return undefined } finally { setBusy(false) }
  }
  // ponytail: inline publish control so the gate is reachable; T-016 (Lane B) owns the modal and /publications page.
  const publish = async (versionId: string, url: string) => {
    setBusy(true); setError(''); setNotice(''); setPublishedUrl('')
    try {
      const response = await fetch('/api/actions/publishDraft', { method: 'POST', headers: { Authorization: `Bearer ${await getAuthToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ draftId: id, versionId, url }) })
      const result = await response.json().catch(() => null) as { success?: boolean; error?: string; data?: { ok: boolean; blocking?: string[] } } | null
      if (result?.data?.ok) setPublishedUrl(url)
      else if (result?.data) setError(result.data.blocking?.length ? `Not ship-ready: ${result.data.blocking.length} claim(s) still need an engineer sign-off.` : 'Not ship-ready: this check is out of date. Re-check the draft first.')
      else setError(result?.error ?? `Publish failed (${response.status}).`)
    } catch { setError('Could not reach the server. Try again.') } finally { setBusy(false) }
  }
  const draftRecord = drafts.records.find(record => record.recordId === id)
  const claimRows = claims.records.map(record => ({ ...record.data, id: record.recordId }))
  const signoffRows = signoffs.records.map(record => ({ ...record.data, id: record.recordId }))
  const kbVersion = kb.records.find(record => record.recordId === 'global')?.data.version ?? 0
  const flow = useFixAndPublish({
    draftBody: draftRecord?.data.body, version, versions: versions.records, claims: claimRows, signoffs: signoffRows, kbVersion,
    ready: draftWrites.ready, save: body => draftWrites.putConfirmed(id, { body }), check, publish, setError, setNotice,
  })
  const failed = queries.find(query => query.status === 'error')
  if (failed) return <section className="proof-page" role="alert"><p className="proof-error">Could not load this draft. {failed.error}</p></section>
  if (drafts.status !== 'ready') return <section className="proof-page" aria-busy="true" role="status"><p>Loading draft…</p></section>
  const draft = draftRecord
  if (!draft) return <section className="proof-page"><h1>Draft not found</h1><p className="proof-muted">It may have been removed, or you may not have access. <a className="proof-link" href="/drafts">Back to drafts →</a></p></section>
  // Errors keep the editor open with the text intact.
  const save = async () => {
    setSaving(true); setError('')
    try { await draftWrites.putConfirmed(id, { body: text }); setEditing(false) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the draft.') } finally { setSaving(false) }
  }
  const names = Object.fromEntries(users.map(({ id, name }) => [id, name]))
  const decide = async ({ claim, decision, note, existing }: SignoffDecision) => {
    if (existing) await signoffWrites.putConfirmed(existing.id, { decision, note })
    else await signoffWrites.createConfirmed({ claimId: claim.id, versionId: version.recordId, decision, note })
  }
  return <>
    <div className="proof-page proof-row">
      <a className="proof-link" href="/drafts">← Drafts</a>
      <Button variant="outline" disabled={editing} onClick={() => { setText(draft.data.body); setEditing(true) }}>Edit draft</Button>
      <Button disabled={busy || flow.active || version?.data.status === 'checking'} onClick={() => void check()}>{version ? 'Re-check claims' : 'Check claims'}</Button>
    </div>
    {editing && <form className="proof-page" onSubmit={event => { event.preventDefault(); void save() }}>
      <label className="proof-muted" htmlFor="draft-body">Draft text</label>
      <Textarea id="draft-body" rows={12} value={text} onChange={event => setText(event.target.value)} />
      <div className="proof-row">
        <span className={text.length > CONFIG.limits.maxBodyChars ? 'proof-error' : 'proof-muted'}>{text.length.toLocaleString()} / {CONFIG.limits.maxBodyChars.toLocaleString()} characters</span>
        <span className="proof-row" style={{ gap: '0.5rem' }}>
          <Button type="button" variant="outline" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>
          <Button type="submit" disabled={!draftWrites.ready || saving || text.trim() === '' || text.length > CONFIG.limits.maxBodyChars || text === draft.data.body}>{saving ? 'Saving…' : 'Save'}</Button>
        </span>
      </div>
    </form>}
    {version?.data.status === 'checked' && <form className="proof-page proof-row" onSubmit={event => { event.preventDefault(); flow.submit(url) }}>
      <Input type="url" required aria-label="Published URL" placeholder="https://… where this will be published" value={url} onChange={event => setUrl(event.target.value)} />
      <Button type="submit" variant="outline" disabled={busy || flow.disabled}>{flow.label}</Button>
    </form>}
    {version?.data.status === 'checked' && flow.reason && <p className="proof-page proof-muted">{flow.reason}</p>}
    {error && <p role="alert" className="proof-page proof-error">{error}</p>}
    {notice && <p role="status" className="proof-page proof-muted">{notice}</p>}
    {/* The app records where the copy is published; it does not host it. The server only accepts http(s) URLs. */}
    {publishedUrl && <p role="status" className="proof-page proof-muted">Recorded as published at <a className="proof-link" href={publishedUrl} target="_blank" rel="noopener noreferrer">{publishedUrl}</a> (opens in a new window). This app does not host the page.</p>}
    {(busy || version?.data.status === 'checking') && <p role="status" aria-live="polite" className="proof-page proof-row" style={{ justifyContent: 'flex-start', gap: '0.75rem' }}>
      <span aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
      <span>{job?.progressMessage ?? 'Starting the check…'}{job?.progress != null && ` · ${Math.round(job.progress * 100)}%`}</span>
    </p>}
    {version?.data.status === 'checked' && <SignoffPanel versionId={version.recordId} isAdmin={user?.role === 'admin'} userId={user?.id ?? ''}
      ready={signoffWrites.ready} names={names} onDecide={decide}
      claims={claimRows.filter(claim => claim.versionId === version.recordId)} signoffs={signoffRows} />}
    <ReviewRoom draft={draft} version={version && { ...version.data, id: version.recordId }} loading={busy && !version}
      claims={claimRows} signoffs={signoffRows} kbVersion={kbVersion} onRecheck={() => void check()} />
  </>
}
