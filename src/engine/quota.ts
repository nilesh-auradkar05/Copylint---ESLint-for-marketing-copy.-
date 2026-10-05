/** Per-user check quota (AGENTS.md §5 paid triggers): a rolling 24-hour window over `draft_versions.requestedAt`. */

import { CONFIG } from './config'

const DAY_MS = 24 * 60 * 60 * 1000

/** Rows requested within the 24 hours up to `now` (inclusive). Missing or unparseable timestamps do not count. */
export function recentChecks(rows: ReadonlyArray<{ requestedAt: string }>, now: Date): number {
  const since = now.getTime() - DAY_MS
  let n = 0
  for (const row of rows) {
    const t = typeof row.requestedAt === 'string' && row.requestedAt !== '' ? Date.parse(row.requestedAt) : NaN
    if (!Number.isNaN(t) && t >= since) n += 1
  }
  return n
}

/** True when one more check would exceed the daily limit. */
export function overQuota(rows: ReadonlyArray<{ requestedAt: string }>, now: Date): boolean {
  return recentChecks(rows, now) >= CONFIG.limits.checksPerUserPerDay
}
