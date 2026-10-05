import { useEffect, useRef, useState } from 'react'
import { blockingClaims } from '@/engine/gate'
import { applyFixes } from '@/engine/fixes'
import type { Claim, Signoff, Version } from '@/engine/contracts'

type VersionRow = { recordId: string; data: Omit<Version, 'id'> }
type Pending = { url: string; versionId: string }

type Options = {
  draftBody: string | undefined
  /** Newest version of this draft, if any. */
  version: VersionRow | undefined
  versions: VersionRow[]
  claims: Claim[]
  signoffs: Signoff[]
  kbVersion: number
  ready: boolean
  save: (body: string) => Promise<void>
  /** Runs the check route; resolves to the version id it returned, or undefined after reporting its own error. */
  check: () => Promise<string | undefined>
  publish: (versionId: string, url: string) => Promise<void>
  setError: (message: string) => void
  setNotice: (message: string) => void
}

/**
 * One button, two modes: "Publish", or "Fix and publish" (apply suggested fixes, re-check, then publish if the
 * new check is clean). The server gate stays the authority; this only decides when to ask it.
 */
export function useFixAndPublish(o: Options) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [working, setWorking] = useState(false)
  const fired = useRef<Pending | null>(null)
  const forVersion = (versionId: string) => ({
    claims: o.claims.filter(claim => claim.versionId === versionId),
    signoffs: o.signoffs.filter(signoff => signoff.versionId === versionId),
  })
  const checked = o.version?.data.status === 'checked' ? o.version : undefined
  const current = !!checked && checked.data.body === o.draftBody && checked.data.kbVersion === o.kbVersion
  const scoped = checked ? forVersion(checked.recordId) : { claims: [], signoffs: [] }
  const blocking = current ? blockingClaims(scoped.claims, scoped.signoffs) : []
  const fixable = current && o.draftBody !== undefined ? applyFixes(o.draftBody, blocking).applied.length : 0
  const mode = current && blocking.length === 0 ? 'publish' : current && fixable > 0 ? 'fix' : 'blocked'
  const reason = mode !== 'blocked' ? '' : current ? `Blocked: ${blocking.length} claim(s) need an engineer sign-off or an edit.` : 'Re-check the draft before publishing.'

  // Step 5: once the re-check we started has finished, publish at most once per click.
  useEffect(() => {
    if (!pending || fired.current === pending) return
    const target = o.versions.find(row => row.recordId === pending.versionId)
    if (!target || target.data.status === 'checking') return
    fired.current = pending
    setPending(null); o.setNotice('')
    if (target.data.status === 'failed') return o.setError('The re-check of the fixed text failed. Re-check the draft and try again.')
    if (target.data.body !== o.draftBody || target.data.kbVersion !== o.kbVersion) return o.setError('The draft changed during the re-check. Re-check the draft before publishing.')
    const left = forVersion(target.recordId)
    const remaining = blockingClaims(left.claims, left.signoffs).length
    if (remaining > 0) return o.setNotice(`Fixes applied, but ${remaining} claim(s) still need an engineer sign-off or an edit.`)
    void o.publish(target.recordId, pending.url)
  })

  const fixAndPublish = async (url: string) => {
    if (o.draftBody === undefined) return
    const fixed = applyFixes(o.draftBody, blocking)
    if (!fixed.applied.length || fixed.body === o.draftBody) return
    setWorking(true); o.setError(''); o.setNotice('')
    try {
      await o.save(fixed.body)
      const versionId = await o.check()
      // The check's own error is already shown; say the text did change so the user is not left guessing.
      if (!versionId) { o.setNotice('Your fixes were saved, but the re-check did not start. Re-check when ready.'); return }
      setPending({ url, versionId })
      o.setNotice(`Applied ${fixed.applied.length} fix${fixed.applied.length === 1 ? '' : 'es'}. Re-checking the fixed text…`)
    } catch (error) {
      o.setError(error instanceof Error ? error.message : 'Could not save the fixes.')
    } finally { setWorking(false) }
  }
  const submit = (url: string) => {
    if (mode === 'fix') void fixAndPublish(url)
    else if (mode === 'publish' && checked) void o.publish(checked.recordId, url)
  }
  return {
    label: mode === 'fix' ? 'Fix and publish' : 'Publish', reason, submit,
    active: working || !!pending,
    disabled: mode === 'blocked' || working || !!pending || (mode === 'fix' && !o.ready),
  }
}
