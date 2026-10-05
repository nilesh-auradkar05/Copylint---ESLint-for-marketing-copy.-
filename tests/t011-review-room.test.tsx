// @vitest-environment jsdom
// T-011 fixture presentation only; HTTP/auth/jobs/two-user sync belong to T-011b.
// Public contract: ReviewRoom({draft, version?, claims, signoffs, kbVersion,
// loading?, failureReason?, onRecheck?}); canonical flattened engine types.
// Accessibility: region "Draft snapshot", named claim articles, native span
// buttons controlling their card, and card buttons controlling their span.
// The gate is a status; verdicts have visible words and an icon.
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import fixture from '../eval/fixtures/review-room.json'
import type { Claim, Signoff, Version } from '../src/engine/contracts'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const versions = fixture.versions.map(({ recordId, data }) => ({ id: recordId, ...data }) as Version)
const claims = fixture.claims.map(({ recordId, data }) => ({ id: recordId, ...data }) as Claim)
const signoffs = fixture.signoffs.map(({ recordId, data }) => ({ id: recordId, ...data }) as Signoff)
const current = versions[1]
const currentClaims = claims.filter(c => c.versionId === current.id)
const base = { draft: fixture.draft, version: current, claims, signoffs, kbVersion: fixture.expected.currentKbVersion }
let root: Root | undefined
async function render(overrides: Partial<typeof base> & { loading?: boolean; failureReason?: string; onRecheck?: () => void } = {}) {
  const path = resolve('src/components/ReviewRoom.tsx')
  expect(existsSync(path), 'Missing T-011 ReviewRoom presentation component').toBe(true)
  const { ReviewRoom } = await import(path)
  if (!root) {
    document.body.innerHTML = '<div id="test-root"></div>'
    root = createRoot(document.getElementById('test-root')!)
  }
  await act(async () => root!.render(<ReviewRoom {...base} {...overrides} />))
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})
function snapshot() {
  const panel = document.querySelector<HTMLElement>('[role="region"][aria-label="Draft snapshot"]')
  expect(panel, 'Accessible immutable draft snapshot region').toBeTruthy()
  return panel!
}
function cards() { return [...document.querySelectorAll<HTMLElement>('article')] }
function card(claim: Claim) {
  const article = cards().find(el => el.textContent?.includes(claim.text))
  expect(article, `Card for ${claim.id}`).toBeTruthy()
  expect(article!.getAttribute('aria-label') || document.getElementById(article!.getAttribute('aria-labelledby') ?? '')?.textContent).toContain(claim.text)
  return article!
}
function span(claim: Claim) {
  const button = [...snapshot().querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent === claim.quote)
  expect(button, `Highlighted quoted span for ${claim.id}`).toBeTruthy()
  return button!
}
function gate() {
  const status = [...document.querySelectorAll<HTMLElement>('[role="status"]')].find(el => /SHIP-READY|BLOCKED|CHECKING|STALE|DRAFT|FAILED/.test(el.textContent ?? ''))
  expect(status, 'Accessible derived gate status').toBeTruthy()
  return status!.textContent!
}

test.each(versions)('[T-011.1] immutable $id spans exclude other versions and ignore edited draft text', async version => {
  await render({ version, draft: { ...fixture.draft, data: { ...fixture.draft.data, body: 'Unsaved replacement body' } } })
  expect(snapshot().textContent).toBe(version.body)
  const selected = claims.filter(c => c.versionId === version.id)
  expect(cards()).toHaveLength(selected.length)
  expect(snapshot().querySelectorAll('button')).toHaveLength(selected.length)
  for (const claim of selected) {
    expect(span(claim).textContent).toBe(version.body.slice(...claim.span))
    card(claim)
  }
  for (const other of claims.filter(c => c.versionId !== version.id && !selected.some(s => s.text === c.text))) {
    expect(cards().some(el => el.textContent?.includes(other.text))).toBe(false)
  }
})

test('[T-011.1] span and card actions move focus in both directions', async () => {
  await render()
  const claim = currentClaims.find(c => c.verdict === 'contradicted')!
  const highlight = span(claim)
  const article = card(claim)
  expect(highlight.getAttribute('aria-controls')).toBe(article.id)
  expect(article.id).toBeTruthy()
  await act(async () => highlight.click())
  expect(article.contains(document.activeElement)).toBe(true)
  const back = article.querySelector<HTMLButtonElement>(`button[aria-controls="${highlight.id}"]`)
  expect(back, 'Card action identifies its original draft span').toBeTruthy()
  await act(async () => back!.click())
  expect(document.activeElement).toBe(highlight)
})

test('[T-011.1] span and card focus controls are native keyboard-operable buttons', async () => {
  await render()
  for (const claim of currentClaims) {
    const highlight = span(claim)
    expect(highlight.disabled).toBe(false)
    expect(highlight.tabIndex).toBeGreaterThanOrEqual(0)
    highlight.focus()
    expect(document.activeElement).toBe(highlight)
    const back = card(claim).querySelector<HTMLButtonElement>(`button[aria-controls="${highlight.id}"]`)!
    expect(back).toBeTruthy()
    expect(back.disabled).toBe(false)
    expect(back.tabIndex).toBeGreaterThanOrEqual(0)
  }
  // jsdom does not synthesize native Enter/Space clicks; real-browser smoke does.
})

test('[T-011.1] overlapping claims share the priority highlight and each card can focus it', async () => {
  const contradicted = currentClaims.find(c => c.verdict === 'contradicted')!
  const overlap: Claim = { ...contradicted, id: 'overlap', text: 'Another claim at the same span', verdict: 'unsupported' }
  await render({ claims: [overlap, contradicted], signoffs: [] })
  expect(snapshot().textContent).toBe(current.body)
  const highlight = span(contradicted)
  expect(highlight.getAttribute('aria-label')).toMatch(/contradicted/i)
  await act(async () => highlight.click())
  expect(card(contradicted).contains(document.activeElement)).toBe(true)
  for (const claim of [overlap, contradicted]) {
    const back = card(claim).querySelector<HTMLButtonElement>(`button[aria-controls="${highlight.id}"]`)
    expect(back).toBeTruthy()
    await act(async () => back!.click())
    expect(document.activeElement).toBe(highlight)
  }
})

test('[T-011.2] draft and model-produced evidence render literal text without interpreting HTML', async () => {
  const markup = '<img src="unsafe-markup" onerror="alert(1)">'
  await render({ version: { ...current, body: current.body + markup }, claims: currentClaims.map(c => ({ ...c, reason: markup, evidence: [{ chunkId: 'c0', page: 'index', excerpt: markup }] })) })
  expect(snapshot().textContent).toBe(current.body + markup)
  expect(cards()[0].textContent).toContain(markup)
  expect(document.querySelector('img[src="unsafe-markup"]')).toBeNull()
})

test('[T-011.2] ordered cards expose verdict words/icons, quotes, reasons, fixes and cited excerpts', async () => {
  await render()
  const ordered = ['contradicted', 'unsupported', 'supported'].map(v => currentClaims.find(c => c.verdict === v)!)
  expect(cards()).toEqual(ordered.map(card))
  for (const claim of ordered) {
    const article = card(claim)
    expect(article.textContent).toMatch(new RegExp(`\\b${claim.verdict}\\b`, 'i'))
    expect(article.querySelector('svg, img, [role="img"], [aria-hidden="true"]'), 'Verdict has an icon as well as a word').toBeTruthy()
    expect(article.textContent).toContain(claim.quote)
    expect(article.textContent).toContain(claim.reason)
    if (claim.fix) expect(article.textContent).toContain(claim.fix)
    for (const evidence of claim.evidence) {
      const link = [...article.querySelectorAll('a')].find(a => a.href === `https://docs.deep.space/${evidence.page}`)
      expect(link, 'Cited official docs page link').toBeTruthy()
      expect(link!.textContent).toContain(evidence.page)
      expect(article.textContent).toContain(evidence.excerpt)
    }
  }
})

test('[T-011.2] gate keeps cut blocked and derives new approvals while excluding old-version claims', async () => {
  await render()
  expect(gate()).toContain(`BLOCKED ${fixture.expected.blockingClaimIdsLatest.length}`)
  const approved = signoffs.map(s => ({ ...s, decision: 'approve' as const }))
  await render({ signoffs: approved })
  expect(gate()).toContain('SHIP-READY')
  await render({ signoffs })
  expect(gate()).toContain('BLOCKED 1')
})

test('[T-011.2] a foreign-version approval cannot clear a current-version claim', async () => {
  await render({ signoffs: signoffs.map(s => ({ ...s, versionId: versions[0].id, decision: 'approve' as const })) })
  expect(gate()).toContain('BLOCKED 2')
})

test('[T-011.5] loading has a busy skeleton and never reports an empty checked result or ship-ready', async () => {
  await render({ loading: true, claims: [], signoffs: [] })
  expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
  expect(document.body.textContent).not.toContain('No checkable claims found')
  expect(document.body.textContent).not.toContain('SHIP-READY')
})

test('[T-011.5] a checked empty version is ship-ready even when older claims remain', async () => {
  await render({ claims: claims.filter(c => c.versionId !== current.id), signoffs: [] })
  expect(document.body.textContent).toContain('No checkable claims found')
  expect(cards()).toHaveLength(0)
  expect(gate()).toContain('SHIP-READY')
})

test('[T-011.5] failed check exposes reason and a re-check callback in the same review room', async () => {
  const recheck = vi.fn()
  await render({ version: { ...current, status: 'failed' }, failureReason: 'Knowledge integration unavailable', onRecheck: recheck })
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Knowledge integration unavailable')
  expect(gate()).not.toContain('SHIP-READY')
  const original = snapshot()
  const retry = [...document.querySelectorAll('button')].find(b => /re-check|retry/i.test(b.textContent ?? ''))
  expect(retry).toBeTruthy()
  await act(async () => retry!.click())
  expect(recheck).toHaveBeenCalledExactlyOnceWith()
  expect(snapshot()).toBe(original)
})

test('[T-011.5] a slow checking version cannot become ship-ready from partial cards', async () => {
  await render({ version: { ...current, status: 'checking' }, claims: currentClaims.filter(c => c.verdict === 'supported'), signoffs: [] })
  expect(gate()).toContain('CHECKING')
  expect(gate()).not.toContain('SHIP-READY')
  expect(cards()).toHaveLength(1)
})

test('[T-011.5] newer docs render a stale banner and withhold ship-ready despite approvals', async () => {
  await render({ kbVersion: 2, signoffs: signoffs.map(s => ({ ...s, decision: 'approve' as const })) })
  expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/stale|docs.*chang/i)
  expect(gate()).not.toContain('SHIP-READY')
  expect(snapshot().textContent).toBe(current.body)
})
