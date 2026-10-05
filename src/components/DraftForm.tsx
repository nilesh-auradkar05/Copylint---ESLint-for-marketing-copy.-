import { useId, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Textarea } from '@/components/ui/Textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { CONFIG } from '@/engine/config'

export type DraftInput = { title: string; channel: 'blog' | 'thread' | 'landing' | 'email'; body: string }
export type DraftCreate = (data: DraftInput) => Promise<void>
export const BODY_LIMIT = CONFIG.limits.maxBodyChars

export function DraftForm({ ready, onCreate }: { ready: boolean; onCreate: DraftCreate }) {
  const id = useId()
  const [title, setTitle] = useState('')
  const [channel, setChannel] = useState<DraftInput['channel']>('blog')
  const [body, setBody] = useState('')
  const [pending, setPending] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const titleError = submitted && !title.trim() ? 'Give this draft a title.' : ''
  const bodyError = body.length > BODY_LIMIT ? `Keep the body within ${BODY_LIMIT.toLocaleString('en-US')} characters.` : submitted && !body.trim() ? 'Paste your draft body.' : ''

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready || pending) return
    setSubmitted(true)
    if (!title.trim() || !body.trim() || body.length > BODY_LIMIT) return
    setPending(true); setError(''); setSaved(false)
    try {
      await onCreate({ title: title.trim(), channel, body })
      setSaved(true)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not create the draft. Try again.')
    } finally { setPending(false) }
  }

  return <section className="proof-page">
    <p className="proof-kicker">The writing desk</p><h1>New draft</h1>
    <p className="proof-muted">Paste the copy you want to check against the DeepSpace docs.</p>
    <form onSubmit={submit} noValidate className="proof-form">
      <div><Label htmlFor={`${id}-title`}>Title</Label>
        <Input id={`${id}-title`} value={title} onChange={e => { setTitle(e.target.value); setSaved(false) }} required disabled={pending} aria-invalid={!!titleError} aria-describedby={titleError ? `${id}-title-error` : undefined} placeholder="e.g. DeepSpace launch thread" />
        {titleError && <p id={`${id}-title-error`} className="proof-error">{titleError}</p>}</div>
      <div><Label htmlFor={`${id}-channel`}>Channel</Label>
        <Select value={channel} onValueChange={value => { setChannel(value as DraftInput['channel']); setSaved(false) }} disabled={pending}>
          <SelectTrigger id={`${id}-channel`}><SelectValue /></SelectTrigger>
          <SelectContent>{(['blog', 'thread', 'landing', 'email'] as const).map(value => <SelectItem key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</SelectItem>)}</SelectContent>
        </Select></div>
      <div><Label htmlFor={`${id}-body`}>Body</Label>
        <Textarea id={`${id}-body`} rows={12} value={body} onChange={e => { setBody(e.target.value); setSaved(false) }} maxLength={BODY_LIMIT} required disabled={pending} aria-invalid={!!bodyError} aria-describedby={`${id}-count ${id}-body-error`} placeholder="Your launch post, thread, or product page…" />
        <p id={`${id}-count`} className="proof-count" aria-live="polite">{body.length.toLocaleString('en-US')} / {BODY_LIMIT.toLocaleString('en-US')} characters</p>
        <p id={`${id}-body-error`} className="proof-error">{bodyError}</p></div>
      {error && <p role="alert" className="proof-error">{error} Your draft is still here. Try again below.</p>}
      {saved && <p role="status">Draft created. <a href="/drafts">View drafts →</a></p>}
      <Button type="submit" disabled={!ready} loading={pending}>{error ? 'Try creating again' : 'Create draft'}</Button>
      {!ready && <p role="status" className="proof-muted">Draft creation is unavailable until the writing desk connects.</p>}
    </form>
  </section>
}
