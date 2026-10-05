import { describe, expect, it } from 'vitest'
import { CONFIG } from './config'
import { overQuota, recentChecks } from './quota'

const NOW = new Date('2026-10-05T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const at = (offsetMs: number) => ({ requestedAt: new Date(NOW.getTime() + offsetMs).toISOString() })
const many = (n: number, offsetMs: number) => Array.from({ length: n }, () => at(offsetMs))

describe('recentChecks', () => {
  it('[T-006.2] counts rows requested at or after now - 24h; one millisecond earlier is outside the window', () => {
    expect(recentChecks([at(-DAY), at(-DAY + 1), at(-1), at(0)], NOW)).toBe(4)
    expect(recentChecks([at(-DAY - 1), at(-2 * DAY)], NOW)).toBe(0)
  })

  it('[T-006.2] rows with a missing, empty or unparseable requestedAt do not count', () => {
    const rows = [at(-1000), { requestedAt: '' }, { requestedAt: 'not-a-date' }, {} as unknown as { requestedAt: string }]
    expect(recentChecks(rows, NOW)).toBe(1)
  })

  it('[T-006.2] an empty list is zero', () => {
    expect(recentChecks([], NOW)).toBe(0)
  })
})

describe('overQuota', () => {
  const limit = CONFIG.limits.checksPerUserPerDay

  it('[T-006.2] the limit boundary: limit - 1 recent checks is allowed, limit is refused (the next check is the limit + 1th)', () => {
    expect(overQuota(many(limit - 1, -1000), NOW)).toBe(false)
    expect(overQuota(many(limit, -1000), NOW)).toBe(true)
    expect(overQuota(many(limit + 5, -1000), NOW)).toBe(true)
  })

  it('[T-006.2] checks older than 24h do not use up quota', () => {
    expect(overQuota([...many(limit, -DAY - 1), ...many(limit - 1, -1000)], NOW)).toBe(false)
  })

  it('[T-006.2] a check exactly 24h old still counts', () => {
    expect(overQuota(many(limit, -DAY), NOW)).toBe(true)
  })
})
