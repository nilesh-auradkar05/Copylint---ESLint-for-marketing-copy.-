import { useQuery } from 'deepspace'
import { PublicationsList, type PublicationRow } from '@/components/PublicationsList'

type PublicationData = Omit<PublicationRow, 'id'>

export default function PublicationsPage() {
  const publications = useQuery<PublicationData>('publications')
  const drafts = useQuery<{ title: string }>('drafts')
  // Members only receive the drafts they may read (server RBAC); the list shows a neutral title for the rest.
  return <section className="proof-page">
    <header><p className="proof-kicker">Ground truth</p><h1>Publications</h1></header>
    {(publications.status === 'error' || drafts.status === 'error') && <p role="alert" className="proof-error">Could not load publications. <a className="proof-link" href="/publications">Try again</a></p>}
    <PublicationsList
      ready={publications.status === 'ready' && drafts.status === 'ready'}
      publications={publications.records.map(r => ({ ...r.data, id: r.recordId }))}
      drafts={drafts.records.map(r => ({ id: r.recordId, title: r.data.title }))} />
  </section>
}
