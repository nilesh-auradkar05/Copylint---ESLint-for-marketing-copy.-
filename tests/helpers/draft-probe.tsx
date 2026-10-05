// Test-only observer: real SDK reads and confirmed cleanup, no wire-format assumptions.
import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { DeepSpaceAuthProvider, RecordProvider, RecordScope, useMutations, useQuery } from 'deepspace'
import { SCOPE_ID } from '../../src/constants'
import { schemas } from '../../src/schemas'

type DraftData = { title: string; body: string; channel: string; collaborators: string[] }
declare global {
  interface Window {
    draftProbe?: {
      ready: boolean
      status: string
      records: Array<{ recordId: string; data: DraftData }>
      remove: (id: string) => Promise<void>
    }
  }
}
function Probe() {
  const { records, status } = useQuery<DraftData>('drafts')
  const { ready, removeConfirmed } = useMutations<DraftData>('drafts')
  useEffect(() => { window.draftProbe = { records, status, ready, remove: removeConfirmed } }, [records, status, ready, removeConfirmed])
  return null
}
createRoot(document.body.appendChild(document.createElement('div'))).render(
  <DeepSpaceAuthProvider><RecordProvider><RecordScope roomId={SCOPE_ID} schemas={schemas}><Probe /></RecordScope></RecordProvider></DeepSpaceAuthProvider>,
)
