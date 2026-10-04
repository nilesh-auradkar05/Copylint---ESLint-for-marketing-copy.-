import { describe, expect, it } from 'vitest'
import { blockingClaims, shipReady } from './gate'
import fixture from '../../eval/fixtures/review-room.json'

// Types are derived from the gate's own signature so these tests do not depend on type names.
type V = Parameters<typeof shipReady>[0]
type C = Parameters<typeof shipReady>[1][number]
type S = Parameters<typeof shipReady>[2][number]

type Verdict = 'supported' | 'contradicted' | 'unsupported'

const KB = 4

const version = (over: Record<string, unknown> = {}): V =>
  ({
    id: 'v1',
    draftId: 'd1',
    body: 'body',
    bodyHash: 'h',
    kbVersion: KB,
    status: 'checked',
    requestedBy: 'u1',
    requestedAt: '2026-10-04T00:00:00.000Z',
    mode: 'full',
    jobId: 'j1',
    ...over,
  }) as unknown as V

const claim = (id: string, verdict: Verdict): C =>
  ({
    id,
    versionId: 'v1',
    draftId: 'd1',
    claimHash: id,
    text: `claim ${id}`,
    quote: `quote ${id}`,
    span: [0, 1],
    kind: 'capability',
    verdict,
    confidence: 'high',
    evidence: [],
    reason: 'r',
    fix: null,
    carriedFrom: null,
  }) as unknown as C

const signoff = (claimId: string, decision: 'approve' | 'cut', reviewerId = 'admin1'): S =>
  ({
    id: `s-${claimId}-${decision}-${reviewerId}`,
    claimId,
    versionId: 'v1',
    reviewerId,
    decision,
    note: 'n',
  }) as unknown as S

const ids = (cs: C[]) => cs.map((c) => (c as unknown as { id: string }).id)

describe('shipReady truth table', () => {
  it('[T-003.6] unchecked version (checking) -> false, even with no blockers', () => {
    expect(shipReady(version({ status: 'checking' }), [claim('a', 'supported')], [], KB)).toBe(false)
    expect(shipReady(version({ status: 'checking' }), [], [], KB)).toBe(false)
  })

  it('[T-003.6] unchecked version (failed) -> false', () => {
    expect(shipReady(version({ status: 'failed' }), [claim('a', 'supported')], [], KB)).toBe(false)
    expect(shipReady(version({ status: 'failed' }), [], [], KB)).toBe(false)
  })

  it('[T-003.6] stale kbVersion (version older than current docs) -> false even if every claim is supported', () => {
    expect(shipReady(version({ kbVersion: KB - 1 }), [claim('a', 'supported')], [], KB)).toBe(false)
  })

  it('[T-003.6] kbVersion mismatch in the other direction -> false too (must be equal)', () => {
    expect(shipReady(version({ kbVersion: KB + 1 }), [claim('a', 'supported')], [], KB)).toBe(false)
  })

  it('[T-003.6] stale kbVersion stays false even when all blockers are approved', () => {
    const claims = [claim('a', 'contradicted')]
    expect(shipReady(version({ kbVersion: KB - 1 }), claims, [signoff('a', 'approve')], KB)).toBe(false)
  })

  it('[T-003.6] contradicted without approve -> false', () => {
    expect(shipReady(version(), [claim('a', 'contradicted')], [], KB)).toBe(false)
  })

  it('[T-003.6] contradicted with approve -> true', () => {
    expect(shipReady(version(), [claim('a', 'contradicted')], [signoff('a', 'approve')], KB)).toBe(true)
  })

  it('[T-003.6] cut is not approve: contradicted with only a cut -> false', () => {
    expect(shipReady(version(), [claim('a', 'contradicted')], [signoff('a', 'cut')], KB)).toBe(false)
  })

  it('[T-003.6] cut is not approve: unsupported with only a cut -> false', () => {
    expect(shipReady(version(), [claim('a', 'unsupported')], [signoff('a', 'cut')], KB)).toBe(false)
  })

  it('[T-003.6] unsupported without signoff -> false; with approve -> true', () => {
    expect(shipReady(version(), [claim('a', 'unsupported')], [], KB)).toBe(false)
    expect(shipReady(version(), [claim('a', 'unsupported')], [signoff('a', 'approve')], KB)).toBe(true)
  })

  it('[T-003.6] zero claims and checked -> true', () => {
    expect(shipReady(version(), [], [], KB)).toBe(true)
  })

  it('[T-003.6] only supported claims, no signoffs -> true', () => {
    expect(shipReady(version(), [claim('a', 'supported'), claim('b', 'supported')], [], KB)).toBe(true)
  })

  it('[T-003.6] every blocking claim needs its own approve: approving one of two is not enough', () => {
    const claims = [claim('a', 'contradicted'), claim('b', 'unsupported')]
    expect(shipReady(version(), claims, [signoff('a', 'approve')], KB)).toBe(false)
    expect(shipReady(version(), claims, [signoff('a', 'approve'), signoff('b', 'approve')], KB)).toBe(true)
  })

  it('[T-003.6] an approve on a different claim id does not clear this claim', () => {
    expect(shipReady(version(), [claim('a', 'contradicted')], [signoff('zzz', 'approve')], KB)).toBe(false)
  })

  it('[T-003.6] a cut alongside an approve on the same claim still clears it (approve is what counts)', () => {
    const signoffs = [signoff('a', 'cut', 'admin1'), signoff('a', 'approve', 'admin2')]
    expect(shipReady(version(), [claim('a', 'contradicted')], signoffs, KB)).toBe(true)
  })

  it('[T-003.6] is pure: does not mutate its inputs', () => {
    const v = version()
    const claims = [claim('a', 'contradicted'), claim('b', 'supported')]
    const signoffs = [signoff('a', 'cut')]
    const snapshot = JSON.stringify([v, claims, signoffs])
    shipReady(v, claims, signoffs, KB)
    expect(JSON.stringify([v, claims, signoffs])).toBe(snapshot)
  })
})

describe('blockingClaims', () => {
  it('[T-003.6] returns non-supported claims that have no approve, preserving input order', () => {
    const claims = [
      claim('a', 'unsupported'),
      claim('b', 'supported'),
      claim('c', 'contradicted'),
      claim('d', 'contradicted'),
    ]
    const out = blockingClaims(claims, [signoff('d', 'approve'), signoff('c', 'cut')])
    expect(ids(out)).toEqual(['a', 'c'])
  })

  it('[T-003.6] supported claims never block, even with a cut signoff', () => {
    expect(blockingClaims([claim('a', 'supported')], [signoff('a', 'cut')])).toEqual([])
  })

  it('[T-003.6] returns an empty list when there are no claims', () => {
    expect(blockingClaims([], [])).toEqual([])
  })

  it('[T-003.6] returns the very claim objects it was given (so the UI can render them)', () => {
    const a = claim('a', 'unsupported')
    const out = blockingClaims([a], [])
    expect(out[0]).toBe(a)
  })
})

describe('eval/fixtures/review-room.json gate values (Lane B fixture)', () => {
  const flatVersions = fixture.versions.map((v) => ({ id: v.recordId, ...v.data }) as unknown as V)
  const flatClaims = fixture.claims.map((c) => ({ id: c.recordId, ...c.data }) as unknown as C)
  const flatSignoffs = fixture.signoffs.map((s) => ({ id: s.recordId, ...s.data }) as unknown as S)
  const kbVersion = fixture.kbState.data.version
  const latest = flatVersions.find((v) => (v as unknown as { id: string }).id === fixture.draft.data.latestVersionId)!
  const claimsOf = (versionId: string) =>
    flatClaims.filter((c) => (c as unknown as { versionId: string }).versionId === versionId)

  it('[T-003.6] covers the required variety: contradicted with fix, unsupported, supported, approve, cut', () => {
    const verdicts = fixture.claims.map((c) => c.data.verdict)
    expect(verdicts).toContain('contradicted')
    expect(verdicts).toContain('unsupported')
    expect(verdicts).toContain('supported')
    expect(fixture.claims.some((c) => c.data.verdict === 'contradicted' && c.data.fix.length > 0)).toBe(true)
    const decisions = fixture.signoffs.map((s) => s.data.decision)
    expect(decisions).toContain('approve')
    expect(decisions).toContain('cut')
  })

  it('[T-003.6] supported and contradicted claims carry at least one evidence item; fix only on contradicted', () => {
    for (const c of fixture.claims) {
      if (c.data.verdict !== 'unsupported') expect(c.data.evidence.length, c.recordId).toBeGreaterThan(0)
      if (c.data.verdict !== 'contradicted') expect(c.data.fix, c.recordId).toBe('')
    }
  })

  it('[T-003.6] every signoff references a claim and version that exist, with reviewerId = createdBy', () => {
    const claimIds = new Set(fixture.claims.map((c) => c.recordId))
    const versionIds = new Set(fixture.versions.map((v) => v.recordId))
    for (const s of fixture.signoffs) {
      expect(claimIds.has(s.data.claimId)).toBe(true)
      expect(versionIds.has(s.data.versionId)).toBe(true)
      expect(s.data.reviewerId).toBe(s.createdBy)
      expect(s.data.note.length).toBeGreaterThan(0)
    }
  })

  it('[T-003.6] the draft\'s latestVersionId is the newest version, and the draft body equals its body', () => {
    expect(latest).toBeDefined()
    expect((latest as unknown as { body: string }).body).toBe(fixture.draft.data.body)
    expect(fixture.expected.latestVersionId).toBe(fixture.draft.data.latestVersionId)
    expect(fixture.expected.currentKbVersion).toBe(kbVersion)
  })

  it('[T-003.6] shipReady over the latest version is false: one contradicted claim has only a cut', () => {
    expect(fixture.expected.shipReadyLatest).toBe(false)
    expect(shipReady(latest, claimsOf(fixture.draft.data.latestVersionId), flatSignoffs, kbVersion)).toBe(false)
    expect(ids(blockingClaims(claimsOf(fixture.draft.data.latestVersionId), flatSignoffs))).toEqual(
      fixture.expected.blockingClaimIdsLatest,
    )
  })

  it('[T-003.6] swapping the cut for an approve makes the latest version ship-ready', () => {
    const swapped = flatSignoffs.map((s) =>
      (s as unknown as { decision: string }).decision === 'cut' ? ({ ...s, decision: 'approve' } as unknown as S) : s,
    )
    expect(shipReady(latest, claimsOf(fixture.draft.data.latestVersionId), swapped, kbVersion)).toBe(true)
  })

  it('[T-003.6] the same latest version is not ship-ready once the docs version moves on', () => {
    const swapped = flatSignoffs.map((s) => ({ ...s, decision: 'approve' }) as unknown as S)
    expect(shipReady(latest, claimsOf(fixture.draft.data.latestVersionId), swapped, kbVersion + 1)).toBe(false)
  })

  it('[T-003.6] the older version has blockers and no signoffs, so it is not ship-ready', () => {
    const older = flatVersions.find((v) => (v as unknown as { id: string }).id !== fixture.draft.data.latestVersionId)!
    const olderId = (older as unknown as { id: string }).id
    expect(claimsOf(olderId).length).toBeGreaterThan(0)
    expect(shipReady(older, claimsOf(olderId), flatSignoffs, kbVersion)).toBe(false)
  })
})
