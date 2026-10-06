// @vitest-environment jsdom
// T-016.2 (publication cards) and T-016.4 (role revert): additive, backward-compatible contracts.
// Same harness as tests/t016-publications-users.test.tsx, which must keep passing untouched.
//
// src/components/UsersTable.tsx
//   new OPTIONAL prop onMakeWriter?: (userId: string) => void | Promise<void>
//   - admin rows that are not the current user get a <button> "Make writer" (accessible name contains the
//     user's name); click calls onMakeWriter(user.id) exactly once; disabled while !ready
//   - the current user's own admin row never has it (self-demotion lockout guard); member rows never have it
//   - without the prop, no Make writer button exists anywhere
//   - a rejection renders role="alert" and the button is enabled again
//
// src/components/PublicationsList.tsx
//   drafts items may carry channel?: 'blog'|'thread'|'landing'|'email'; publications may carry publishedAt?: ISO string
//   - each publication is its own <article> (title, status word, links inside)
//   - channel label shown as text when known; no channel word at all when unknown/unreadable
//   - <time dateTime={publishedAt}> when given, none otherwise
//   - the card (the <article> or a descendant) carries data-status="live"|"stale" as a non-colour styling hook
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
async function mount(file: string, exportName: string, props: object) {
  const path = resolve(file)
  expect(existsSync(path), `Missing T-016 component ${file}`).toBe(true)
  const mod = await import(path)
  const Component = mod[exportName]
  expect(Component, `${file} must export ${exportName}`).toBeTypeOf('function')
  if (!root) {
    document.body.innerHTML = '<div id="test-root"></div>'
    root = createRoot(document.getElementById('test-root')!)
  }
  await act(async () => root!.render(<Component {...props} />))
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  document.body.innerHTML = ''
})
const label = (el: Element) => el.getAttribute('aria-label') ?? el.textContent ?? ''

// ---------------------------------------------------------------- UsersTable: role revert
const users = [
  { id: 'u_ada', name: 'Ada Lovelace', role: 'admin' },
  { id: 'u_hedy', name: 'Hedy Lamarr', role: 'admin' },
  { id: 'u_grace', name: 'Grace Hopper', role: 'member' },
]
const renderUsers = (over: object = {}) =>
  mount('src/components/UsersTable.tsx', 'UsersTable', {
    users, currentUserId: 'u_ada', ready: true, onMakeEngineer: async () => {}, onMakeWriter: async () => {}, ...over,
  })
const writerButtons = () => [...document.querySelectorAll('button')].filter(b => /make writer/i.test(label(b)))
const writerButtonFor = (name: string) => writerButtons().find(b => label(b).includes(name))
const engineerButtons = () => [...document.querySelectorAll('button')].filter(b => /make engineer/i.test(label(b)))

test('[T-016.4] an admin row that is not the current user has a Make writer button that calls onMakeWriter once with its id', async () => {
  const onMakeWriter = vi.fn(async () => {})
  const onMakeEngineer = vi.fn(async () => {})
  await renderUsers({ onMakeWriter, onMakeEngineer })
  const btn = writerButtonFor('Hedy Lamarr')
  expect(btn, 'Make writer button naming Hedy Lamarr').toBeDefined()
  await act(async () => btn!.click())
  expect(onMakeWriter).toHaveBeenCalledTimes(1)
  expect(onMakeWriter).toHaveBeenCalledWith('u_hedy')
  expect(onMakeEngineer).not.toHaveBeenCalled()
})

test('[T-016.4] the current user own admin row has no Make writer button (self-demotion guard)', async () => {
  await renderUsers()
  expect(writerButtonFor('Ada Lovelace')).toBeUndefined()
  // Guard is meaningful only if the button exists for the other admin.
  expect(writerButtonFor('Hedy Lamarr')).toBeDefined()
  expect(writerButtons()).toHaveLength(1)
})

test('[T-016.4] member rows never have Make writer and still have Make engineer', async () => {
  await renderUsers()
  expect(writerButtonFor('Grace Hopper')).toBeUndefined()
  const eng = engineerButtons()
  expect(eng).toHaveLength(1)
  expect(label(eng[0])).toContain('Grace Hopper')
  // No admin row offers Make engineer.
  expect(engineerButtons().some(b => /Ada Lovelace|Hedy Lamarr/.test(label(b)))).toBe(false)
})

test('[T-016.4] Make writer is disabled until mutations are ready and a click makes no call', async () => {
  const onMakeWriter = vi.fn(async () => {})
  await renderUsers({ onMakeWriter, ready: false })
  expect(writerButtons().length).toBeGreaterThan(0)
  for (const b of writerButtons()) expect((b as HTMLButtonElement).disabled).toBe(true)
  await act(async () => writerButtons()[0].click())
  expect(onMakeWriter).not.toHaveBeenCalled()
})

test('[T-016.4] without the onMakeWriter prop no Make writer button exists anywhere (backward compatible)', async () => {
  await renderUsers({ onMakeWriter: undefined })
  expect(writerButtons()).toHaveLength(0)
  expect(engineerButtons()).toHaveLength(1)
})

test('[T-016.4] a rejected onMakeWriter shows a role=alert error and the button is usable again', async () => {
  const onMakeWriter = vi.fn(async () => { throw new Error('boom') })
  await renderUsers({ onMakeWriter })
  await act(async () => writerButtonFor('Hedy Lamarr')!.click())
  expect(document.querySelector('[role="alert"]')?.textContent ?? '').toMatch(/boom|fail|could not|error/i)
  expect((writerButtonFor('Hedy Lamarr') as HTMLButtonElement).disabled).toBe(false)
})

// ---------------------------------------------------------------- PublicationsList: cards
// Titles deliberately avoid channel words (blog/thread/landing/email) and status words.
type Pub = { id: string; draftId: string; versionId: string; url: string; kbVersionAtPublish: string; status: 'live' | 'stale'; stalePages?: string[]; staleSince?: string; publishedAt?: string }
type Channel = 'blog' | 'thread' | 'landing' | 'email'
const pub = (id: string, draftId: string, status: 'live' | 'stale', extra: Partial<Pub> = {}): Pub => ({
  id, draftId, versionId: `v_${id}`, url: `https://example.com/${id}`, kbVersionAtPublish: 'kb-1', status, ...extra,
})
const CHANNEL_WORDS = ['blog', 'thread', 'landing', 'email'] as const
const renderList = (publications: Pub[], drafts: { id: string; title: string; channel?: Channel }[]) =>
  mount('src/components/PublicationsList.tsx', 'PublicationsList', { publications, drafts, ready: true })
const cards = () => [...document.querySelectorAll<HTMLElement>('article')]
function cardFor(title: string) {
  const found = cards().filter(c => (c.textContent ?? '').includes(title))
  expect(found, `exactly one <article> for ${title}`).toHaveLength(1)
  return found[0]
}
const statusAttrs = (card: HTMLElement) =>
  [card, ...card.querySelectorAll<HTMLElement>('[data-status]')].map(e => e.getAttribute('data-status')).filter((v): v is string => v !== null)

test('[T-016.2] each publication renders as its own <article> holding its title, status word and links', async () => {
  const drafts = [
    { id: 'd_a', title: 'Alpha rollout', channel: 'blog' as const },
    { id: 'd_b', title: 'Bravo storage', channel: 'thread' as const },
  ]
  await renderList([
    pub('p1', 'd_a', 'live'),
    pub('p2', 'd_b', 'stale', { stalePages: ['docs/storage.md'] }),
  ], drafts)
  expect(cards()).toHaveLength(2)
  const a = cardFor('Alpha rollout')
  expect(a.textContent).toMatch(/\blive\b/i)
  expect(a.querySelector('a[href$="/drafts/d_a"]')).not.toBeNull()
  expect(a.querySelector('a[href="https://example.com/p1"]')).not.toBeNull()
  const b = cardFor('Bravo storage')
  expect(b.textContent).toMatch(/\bstale\b/i)
  expect(b.textContent).toContain('docs/storage.md')
  expect(b.querySelector('a[href$="/drafts/d_b"]')).not.toBeNull()
  expect(b.querySelector('a[href="https://example.com/p2"]')).not.toBeNull()
})

test('[T-016.2] a card shows the draft channel as a text label, and only its own channel', async () => {
  const drafts = [
    { id: 'd_t', title: 'Alpha rollout', channel: 'thread' as const },
    { id: 'd_l', title: 'Bravo storage', channel: 'landing' as const },
  ]
  await renderList([pub('p1', 'd_t', 'live'), pub('p2', 'd_l', 'live')], drafts)
  const t = cardFor('Alpha rollout').textContent!
  expect(t).toMatch(/thread/i)
  for (const w of ['blog', 'landing', 'email']) expect(t).not.toMatch(new RegExp(w, 'i'))
  const l = cardFor('Bravo storage').textContent!
  expect(l).toMatch(/landing/i)
  for (const w of ['blog', 'thread', 'email']) expect(l).not.toMatch(new RegExp(w, 'i'))
})

test('[T-016.2] an unreadable draft or one without a channel shows no channel word and does not crash', async () => {
  const secret = 'd_secret_42'
  const drafts = [{ id: 'd_n', title: 'Charlie guide' }] // readable but no channel
  await renderList([pub('p1', 'd_n', 'live'), pub('p2', secret, 'stale', { stalePages: ['docs/auth.md'] })], drafts)
  expect(cards()).toHaveLength(2)
  const noChannel = cardFor('Charlie guide').textContent!
  const unreadable = cards().find(c => c !== cardFor('Charlie guide'))!.textContent!
  for (const text of [noChannel, unreadable])
    for (const w of CHANNEL_WORDS) expect(text).not.toMatch(new RegExp(w, 'i'))
  expect(unreadable).not.toContain(secret)
})

test('[T-016.2] publishedAt renders a <time> whose dateTime is the ISO string; absent publishedAt renders none', async () => {
  const iso = '2026-10-03T14:30:00.000Z'
  const drafts = [
    { id: 'd_a', title: 'Alpha rollout', channel: 'blog' as const },
    { id: 'd_b', title: 'Bravo storage', channel: 'email' as const },
  ]
  await renderList([pub('p1', 'd_a', 'live', { publishedAt: iso }), pub('p2', 'd_b', 'live')], drafts)
  const withTime = cardFor('Alpha rollout').querySelectorAll('time')
  expect(withTime).toHaveLength(1)
  expect((withTime[0] as HTMLTimeElement).dateTime).toBe(iso)
  expect(cardFor('Bravo storage').querySelector('time')).toBeNull()
})

test('[T-016.2] each card carries data-status matching its publication (non-colour styling hook)', async () => {
  const drafts = [
    { id: 'd_a', title: 'Alpha rollout', channel: 'blog' as const },
    { id: 'd_b', title: 'Bravo storage', channel: 'thread' as const },
  ]
  await renderList([
    pub('p1', 'd_a', 'live'),
    pub('p2', 'd_b', 'stale', { stalePages: ['docs/storage.md'] }),
  ], drafts)
  const live = statusAttrs(cardFor('Alpha rollout'))
  expect(live.length).toBeGreaterThan(0)
  expect(live.every(v => v === 'live')).toBe(true)
  const stale = statusAttrs(cardFor('Bravo storage'))
  expect(stale.length).toBeGreaterThan(0)
  expect(stale.every(v => v === 'stale')).toBe(true)
})
