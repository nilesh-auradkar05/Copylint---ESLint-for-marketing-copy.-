export type ChannelName = 'blog' | 'thread' | 'landing' | 'email'
export type PublicationRow = {
  id: string; draftId: string; versionId: string; url: string; kbVersionAtPublish: number
  status: 'live' | 'stale'; stalePages?: string[]; staleSince?: string; publishedAt?: string
}

const isWebUrl = (url: string) => /^https?:\/\//i.test(url.trim())
const CHANNELS: readonly string[] = ['blog', 'thread', 'landing', 'email']
const readableDate = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { dateStyle: 'medium' }) }

export function PublicationsList({ publications, drafts, ready }: {
  publications: PublicationRow[]; drafts: { id: string; title: string; channel?: ChannelName }[]; ready: boolean
}) {
  if (!ready) return <p role="status" aria-live="polite" className="proof-muted">Loading publications…</p>
  if (publications.length === 0) return <p className="proof-muted">No publications yet. Publish a ship-ready draft and it will appear here.</p>
  const rank = (p: PublicationRow) => (p.status === 'stale' ? 0 : 1)
  const rows = [...publications].sort((a, b) => rank(a) - rank(b))
  return <ul className="proof-pub-grid">{rows.map(p => {
    const draft = drafts.find(d => d.id === p.draftId)
    const title = draft?.title || 'Untitled draft (no access)'
    const channel = draft?.channel && CHANNELS.includes(draft.channel) ? draft.channel : null
    const date = p.publishedAt ? readableDate(p.publishedAt) : null
    return <li key={p.id}>
      <article className="proof-pub-card" data-status={p.status}>
        {channel && <p className="proof-pub-channel">{channel}</p>}
        <a className="proof-link proof-pub-title" href={`/drafts/${p.draftId}`}>{title}</a>{' '}
        <p className="proof-muted">
          <strong className="proof-pub-status">{p.status === 'stale' ? 'Stale' : 'Live'}</strong> · docs v{p.kbVersionAtPublish}
          {date && <> · <time dateTime={p.publishedAt}>{date}</time></>}
        </p>
        {isWebUrl(p.url)
          ? <a className="proof-link proof-pub-url" href={p.url} target="_blank" rel="noopener noreferrer">{p.url}</a>
          : <span className="proof-muted proof-pub-url">{p.url}</span>}
        {p.status === 'stale' && Array.isArray(p.stalePages) && p.stalePages.length > 0 &&
          <ul aria-label="Changed docs pages">{p.stalePages.map(page => <li key={page}>{page}</li>)}</ul>}
      </article>
    </li>
  })}</ul>
}
