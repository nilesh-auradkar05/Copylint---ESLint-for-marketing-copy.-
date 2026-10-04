import type { Claim, Signoff, Version } from './contracts'

export function blockingClaims(claims: Claim[], signoffs: Signoff[]): Claim[] {
  const approved = new Set(signoffs.filter((s) => s.decision === 'approve').map((s) => s.claimId))
  return claims.filter((c) => c.verdict !== 'supported' && !approved.has(c.id))
}

export function shipReady(v: Version, claims: Claim[], signoffs: Signoff[], kbVersion: number): boolean {
  return v.status === 'checked' && v.kbVersion === kbVersion && blockingClaims(claims, signoffs).length === 0
}
