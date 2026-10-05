// Test-only Vite mount for local visual/keyboard smoke; not a production route.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ReviewRoom } from '../../src/components/ReviewRoom'
import type { Claim, Signoff, Version } from '../../src/engine/contracts'
import fixture from '../../eval/fixtures/review-room.json'
import '../../src/styles.css'

const { recordId, data } = fixture.versions[1]
document.documentElement.dataset.theme = 'proof-desk'
createRoot(document.body.appendChild(document.createElement('div'))).render(
  <ReviewRoom
    draft={fixture.draft}
    version={{ id: recordId, ...data } as Version}
    claims={fixture.claims.map(({ recordId: id, data }) => ({ id, ...data }) as Claim)}
    signoffs={fixture.signoffs.map(({ recordId: id, data }) => ({ id, ...data }) as Signoff)}
    kbVersion={fixture.expected.currentKbVersion}
  />,
)
