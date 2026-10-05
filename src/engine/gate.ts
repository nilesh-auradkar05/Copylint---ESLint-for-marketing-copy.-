import type { Claim, Signoff, Version } from './contracts'

/** Only the fields the gate reads, so callers can pass lean rows. */
type GateClaim = Pick<Claim, 'id' | 'verdict'>
type GateSignoff = Pick<Signoff, 'claimId' | 'decision'>

export function blockingClaims<C extends GateClaim>(claims: C[], signoffs: GateSignoff[]): C[] {
  const approved = new Set(signoffs.filter((s) => s.decision === 'approve').map((s) => s.claimId))
  return claims.filter((c) => c.verdict !== 'supported' && !approved.has(c.id))
}

export function shipReady(v: Pick<Version, 'status' | 'kbVersion'>, claims: GateClaim[], signoffs: GateSignoff[], kbVersion: number): boolean {
  return v.status === 'checked' && v.kbVersion === kbVersion && blockingClaims(claims, signoffs).length === 0
}
