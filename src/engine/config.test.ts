import { describe, expect, it } from 'vitest'
import { CONFIG } from './config'

describe('CONFIG (AGENTS.md section 7 cost guardrails and SPEC section 2)', () => {
  it('[T-003.config] model ids are the pinned extraction and judge models', () => {
    expect(CONFIG.models.extract).toBe('claude-haiku-4-5')
    expect(CONFIG.models.judge).toBe('claude-sonnet-5')
  })

  it('[T-003.config] per-check limits match the cost guardrails', () => {
    expect(CONFIG.limits.maxClaims).toBe(25)
    expect(CONFIG.limits.kbLimit).toBe(5)
    expect(CONFIG.limits.judgeConcurrency).toBe(5)
    expect(CONFIG.limits.judgeMaxOutputTokens).toBe(1_200)
  })

  it('[T-003.config] request limits: 20,000-char body cap, 20 checks per user per day', () => {
    expect(CONFIG.limits.maxBodyChars).toBe(20_000)
    expect(CONFIG.limits.checksPerUserPerDay).toBe(20)
  })

  it('[T-003.config] the claim cap never exceeds what ExtractOut allows the model to return (40)', () => {
    expect(CONFIG.limits.maxClaims).toBeLessThanOrEqual(40)
  })

  it('[T-003.config] excerpts fit the Evidence contract (<= 300 chars)', () => {
    expect(CONFIG.limits.excerptChars).toBeLessThanOrEqual(300)
  })

  it('[T-003.config] kb search settings: docs folder, hybrid mode', () => {
    expect(CONFIG.kb.folder).toBe('docs')
    expect(CONFIG.kb.mode).toBe('hybrid')
  })

  it('[T-003.config] cron task is the daily docs-drift check in America/New_York', () => {
    expect(CONFIG.cron.name).toBe('docs-drift')
    expect(CONFIG.cron.schedule).toBe('0 6 * * *')
    expect(CONFIG.cron.timezone).toBe('America/New_York')
  })

  it('[T-003.config] docsBase is the docs origin with a trailing slash', () => {
    expect(CONFIG.docsBase).toBe('https://docs.deep.space/')
  })

  it('[T-003.config] sourcePages has no duplicates and is a clean list of page paths', () => {
    const pages: readonly string[] = CONFIG.sourcePages
    expect(pages.length).toBeGreaterThan(0)
    expect(new Set(pages).size).toBe(pages.length)
    for (const p of pages) {
      expect(p, p).toMatch(/^[a-z0-9][a-z0-9\-/]*$/)
      expect(p.endsWith('.md')).toBe(false)
      expect(p.endsWith('/')).toBe(false)
    }
  })

  it('[T-003.config] every source page maps to a unique knowledge filename within the 128-char limit', () => {
    const names = (CONFIG.sourcePages as readonly string[]).map((p) => p.replaceAll('/', '__') + '.md')
    expect(new Set(names).size).toBe(names.length)
    for (const n of names) expect(`${CONFIG.kb.folder}/${n}`.length).toBeLessThanOrEqual(128)
  })

  it('[T-003.config] the source list includes the pages the golden set and probes depend on', () => {
    const pages: readonly string[] = CONFIG.sourcePages
    for (const p of ['index', 'concepts/permissions', 'guides/external-apis', 'guides/scheduled-jobs', 'sdk-reference/worker/ai']) {
      expect(pages).toContain(p)
    }
  })
})
