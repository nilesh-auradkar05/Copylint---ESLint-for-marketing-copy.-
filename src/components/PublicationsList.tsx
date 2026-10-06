export type PublicationRow = {
  id: string; draftId: string; versionId: string; url: string; kbVersionAtPublish: number
  status: 'live' | 'stale'; stalePages?: string[]; staleSince?: string
}

const isWebUrl = (url: string) => /^https?:\/\//i.test(url.trim())

export function PublicationsList({ publications, drafts, ready }: {
  publications: PublicationRow[]; drafts: { id: string; title: string }[]; ready: boolean
}) {
  if (!ready) return <p role="status" aria-live="polite" className="proof-muted">Loading publications…</p>
  if (publications.length === 0) return <p className="proof-muted">No publications yet. Publish a ship-ready draft and it will appear here.</p>
  const rank = (p: PublicationRow) => (p.status === 'stale' ? 0 : 1)
  const rows = [...publications].sort((a, b) => rank(a) - rank(b))
  return <ul>{rows.map(p => {
    const title = drafts.find(d => d.id === p.draftId)?.title || 'Untitled draft (no access)'
    return <li key={p.id} className="proof-row">
      <div>
        <a className="proof-link" href={`/drafts/${p.draftId}`}>{title}</a>{' '}
        <p className="proof-muted">{p.status === 'stale' ? 'Stale' : 'Live'} · docs {p.kbVersionAtPublish}</p>
        {isWebUrl(p.url)
          ? <a className="proof-link" href={p.url} target="_blank" rel="noopener noreferrer">{p.url}</a>
          : <span className="proof-muted">{p.url}</span>}
        {p.status === 'stale' && Array.isArray(p.stalePages) && p.stalePages.length > 0 &&
          <ul aria-label="Changed docs pages">{p.stalePages.map(page => <li key={page}>{page}</li>)}</ul>}
      </div>
    </li>
  })}</ul>
}
