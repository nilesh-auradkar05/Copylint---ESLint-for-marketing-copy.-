import { useState } from 'react'
import { useMutations, useQuery } from 'deepspace'
import { DraftList, type PublicationRow } from '@/components/DraftList'
import type { DraftInput } from '@/components/DraftForm'
import { Button } from '@/components/ui/Button'
import type { Claim, Signoff, Version } from '@/engine/contracts'

export default function DraftsPage() {
  const [attempt, setAttempt] = useState(0)
  return <LiveDrafts key={attempt} retry={() => setAttempt(n => n + 1)} />
}

function LiveDrafts({ retry }: { retry: () => void }) {
  const drafts = useQuery<DraftInput & { latestVersionId?: string }>('drafts')
  const versions = useQuery<Omit<Version, 'id'>>('draft_versions')
  const claims = useQuery<Omit<Claim, 'id'>>('claims')
  const signoffs = useQuery<Omit<Signoff, 'id'>>('signoffs')
  const publications = useQuery<PublicationRow['data']>('publications')
  const kb = useQuery<{ version: number }>('kb_state')
  const { ready, createConfirmed } = useMutations<DraftInput & { collaborators: string[] }>('drafts')
  const queries = [drafts, versions, claims, signoffs, publications, kb]
  const failed = queries.find(query => query.status === 'error')
  const dataReady = queries.every(query => query.status === 'ready')
  return <>
    {failed && <div className="proof-page" role="alert"><p className="proof-error">Could not load drafts and review status. {failed.error}</p><Button onClick={retry}>Try loading again</Button></div>}
    {drafts.status === 'loading' ? <section className="proof-page" aria-busy="true" role="status">
      <p>Loading drafts…</p>
      <div aria-hidden="true" className="animate-pulse space-y-4">{[0, 1, 2].map(row => <div key={row} className="h-16 rounded border border-border bg-muted" />)}</div>
    </section> : drafts.status === 'ready' && <DraftList
      drafts={[...drafts.records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))}
      ready={ready} dataReady={dataReady}
      onCreate={async data => { await createConfirmed({ ...data, collaborators: [] }) }}
      versions={versions.records.map(record => ({ ...record.data, id: record.recordId }))}
      claims={claims.records.map(record => ({ ...record.data, id: record.recordId }))}
      signoffs={signoffs.records.map(record => ({ ...record.data, id: record.recordId }))}
      publications={publications.records}
      kbVersion={kb.records.find(record => record.recordId === 'global')?.data.version}
    />}
  </>
}
