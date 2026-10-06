// @vitest-environment jsdom
// T-016.2 and T-016.4: presentational contracts only (no DeepSpace hooks, no mocks except callbacks).
// The pages under src/pages/(app)/... are thin adapters that feed these components.
//
// src/components/PublicationsList.tsx
//   export function PublicationsList({ publications, drafts, ready })
//     publications: { id, draftId, versionId, url, kbVersionAtPublish, status: 'live'|'stale',
//                     stalePages?: string[], staleSince?: string }[]
//     drafts:       { id, title }[]    (only drafts the viewer can read)
//     ready:        boolean            (false = loading)
//   - each row: draft title, a status WORD ("Live" / "Stale"), an anchor to `/drafts/<draftId>`,
//     the published url as an <a href=url target="_blank" rel~"noopener"> (http/https only; any other
//     scheme is rendered as plain text, never as an href); stale rows list every stalePages entry
//   - stale rows sort before live rows
//   - ready + empty => text matching /no publications/i
//   - !ready => an element with role="status" whose text matches /loading/i, and NO empty-state text
//   - publication whose draft is not in `drafts` => neutral fallback title (matches
//     /untitled|unknown|unavailable|restricted|private|no access/i), never the raw draft id as text
//
// src/components/UsersTable.tsx
//   export function UsersTable({ users, currentUserId, ready, onMakeEngineer })
//     users: { id, name, role }[]      (NO email: the page adapter strips it, AGENTS.md section 6)
//     onMakeEngineer(userId: string): void | Promise<void>
//   - one row per user: name + role word ("Engineer" for admin, "Writer" for member)
//   - <button> "Make engineer" only on non-admin rows; accessible name (aria-label or text) contains
//     the user's name; disabled while !ready; click calls onMakeEngineer(user.id) exactly once
//   - current user's row shows "(you)"
//   - empty name => fallback text matching /unnamed|unknown|anonymous|no name/i, never the raw id
//   - onMakeEngineer rejection => element with role="alert" (text matches /boom|fail|could not|error/i),
//     and the button is enabled again
//
// Accessible queries only: role/name/text.
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
const text = () => document.body.textContent ?? ''
const label = (el: Element) => el.getAttribute('aria-label') ?? el.textContent ?? ''

// ---------------------------------------------------------------- PublicationsList
type Pub = { id: string; draftId: string; versionId: string; url: string; kbVersionAtPublish: string; status: 'live' | 'stale'; stalePages?: string[]; staleSince?: string }
const pub = (id: string, draftId: string, status: 'live' | 'stale', extra: Partial<Pub> = {}): Pub => ({
  id, draftId, versionId: `v_${id}`, url: `https://example.com/${id}`, kbVersionAtPublish: 'kb-1', status, ...extra,
})
const drafts = [
  { id: 'd_a', title: 'Alpha launch post' },
  { id: 'd_b', title: 'Bravo storage thread' },
  { id: 'd_c', title: 'Charlie auth guide' },
  { id: 'd_d', title: 'Delta pricing note' },
]
const pubs: Pub[] = [
  pub('p1', 'd_a', 'live'),
  pub('p2', 'd_b', 'stale', { stalePages: ['docs/storage.md', 'docs/limits.md'], staleSince: '2026-10-01T00:00:00Z' }),
  pub('p3', 'd_c', 'live'),
  pub('p4', 'd_d', 'stale', { stalePages: ['docs/auth.md'], staleSince: '2026-10-02T00:00:00Z' }),
]
const renderList = (over: object = {}) =>
  mount('src/components/PublicationsList.tsx', 'PublicationsList', { publications: pubs, drafts, ready: true, ...over })

// Smallest element holding the title, a status word and an anchor to the draft: that row.
function pubRow(title: string, draftId: string) {
  const rows = [...document.querySelectorAll<HTMLElement>('*')].filter(el =>
    (el.textContent ?? '').includes(title) &&
    /\b(live|stale)\b/i.test(el.textContent ?? '') &&
    [...el.querySelectorAll('a[href]')].some(a => a.getAttribute('href')!.endsWith(`/drafts/${draftId}`)))
  expect(rows.length, `Row for ${title}`).toBeGreaterThan(0)
  return rows.sort((a, b) => a.textContent!.length - b.textContent!.length)[0]
}

test('[T-016.2] each row shows the draft title and a Live/Stale status word as text', async () => {
  await renderList()
  for (const [p, d] of [[pubs[0], drafts[0]], [pubs[1], drafts[1]], [pubs[2], drafts[2]], [pubs[3], drafts[3]]] as const) {
    const row = pubRow(d.title, p.draftId)
    expect(row.textContent).toMatch(p.status === 'live' ? /\blive\b/i : /\bstale\b/i)
  }
})

test('[T-016.2] the published URL is a link that opens in a new window with rel noopener', async () => {
  await renderList()
  const a = pubRow(drafts[0].title, 'd_a').querySelector<HTMLAnchorElement>('a[href="https://example.com/p1"]')
  expect(a, 'anchor to published url').not.toBeNull()
  expect(a!.getAttribute('target')).toBe('_blank')
  expect(a!.getAttribute('rel') ?? '').toMatch(/noopener/)
})

test('[T-016.2] a stale row lists every changed page; a live row lists none of them', async () => {
  await renderList()
  const stale = pubRow(drafts[1].title, 'd_b').textContent!
  expect(stale).toContain('docs/storage.md')
  expect(stale).toContain('docs/limits.md')
  expect(stale).not.toContain('docs/auth.md')
  const live = pubRow(drafts[0].title, 'd_a').textContent!
  for (const page of ['docs/storage.md', 'docs/limits.md', 'docs/auth.md']) expect(live).not.toContain(page)
})

test('[T-016.2] every row links to /drafts/<draftId>', async () => {
  await renderList()
  for (const d of drafts) {
    const hrefs = [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')!)
    expect(hrefs.some(h => h.endsWith(`/drafts/${d.id}`)), `link to ${d.id}`).toBe(true)
  }
})

test('[T-016.2] stale rows sort before live rows', async () => {
  await renderList()
  const at = (t: string) => text().indexOf(t)
  const stalePos = [at(drafts[1].title), at(drafts[3].title)]
  const livePos = [at(drafts[0].title), at(drafts[2].title)]
  expect([...stalePos, ...livePos].every(i => i >= 0)).toBe(true)
  expect(Math.max(...stalePos)).toBeLessThan(Math.min(...livePos))
})

test('[T-016.2] ready with no publications shows an empty-state message', async () => {
  await renderList({ publications: [] })
  expect(text()).toMatch(/no publications/i)
  expect(document.querySelector('[role="status"]')?.textContent ?? '').not.toMatch(/loading/i)
})

test('[T-016.2] not ready shows a loading status and no empty-state message', async () => {
  await renderList({ publications: [], ready: false })
  expect(document.querySelector('[role="status"]')?.textContent ?? '').toMatch(/loading/i)
  expect(text()).not.toMatch(/no publications/i)
})

test('[T-016.2] a publication whose draft the viewer cannot read renders with a neutral title, never the raw draft id', async () => {
  const secret = 'd_secret_99'
  await renderList({ publications: [pub('p9', secret, 'live', { url: 'https://example.com/p9' })], drafts: [] })
  expect(text()).toMatch(/\blive\b/i)
  expect(text()).toMatch(/untitled|unknown|unavailable|restricted|private|no access/i)
  expect(text()).not.toContain(secret)
  for (const el of document.querySelectorAll('[aria-label],[title]'))
    expect(`${el.getAttribute('aria-label')} ${el.getAttribute('title')}`).not.toContain(secret)
})

test('[T-016.2] a non-http(s) url is never rendered as a clickable href', async () => {
  const evil = 'javascript:alert(1)'
  await renderList({ publications: [pub('p8', 'd_a', 'live', { url: evil })] })
  expect(text()).toContain(drafts[0].title)
  const hrefs = [...document.querySelectorAll('[href]')].map(el => el.getAttribute('href')!.trim().toLowerCase())
  expect(hrefs.some(h => h.startsWith('javascript:'))).toBe(false)
  expect(document.querySelector('a[target="_blank"]')).toBeNull()
})

// ---------------------------------------------------------------- UsersTable
const users = [
  { id: 'u_ada', name: 'Ada Lovelace', role: 'admin' },
  { id: 'u_grace', name: 'Grace Hopper', role: 'member' },
  { id: 'u_linus', name: 'Linus Torvalds', role: 'member' },
]
const renderUsers = (over: object = {}) =>
  mount('src/components/UsersTable.tsx', 'UsersTable', { users, currentUserId: 'u_ada', ready: true, onMakeEngineer: async () => {}, ...over })
const makeButtons = () => [...document.querySelectorAll('button')].filter(b => /make engineer/i.test(label(b)))
const makeButtonFor = (name: string) => makeButtons().find(b => label(b).includes(name))
// Smallest element holding the name and a role word (button text excluded from the role check).
function userRow(name: string) {
  const rows = [...document.querySelectorAll<HTMLElement>('*')].filter(el => (el.textContent ?? '').includes(name) && /engineer|writer/i.test(withoutButtons(el)))
  expect(rows.length, `Row for ${name}`).toBeGreaterThan(0)
  return rows.sort((a, b) => a.textContent!.length - b.textContent!.length)[0]
}
function withoutButtons(el: Element) {
  const clone = el.cloneNode(true) as Element
  clone.querySelectorAll('button').forEach(b => b.remove())
  return clone.textContent ?? ''
}

test('[T-016.4] one row per user with name and role word (Engineer for admin, Writer for member)', async () => {
  await renderUsers()
  const admin = withoutButtons(userRow('Ada Lovelace'))
  expect(admin).toMatch(/engineer/i)
  expect(admin).not.toMatch(/writer/i)
  for (const n of ['Grace Hopper', 'Linus Torvalds']) {
    const member = withoutButtons(userRow(n))
    expect(member).toMatch(/writer/i)
    expect(member).not.toMatch(/engineer/i)
  }
})

test('[T-016.4] Make engineer exists only for non-admin rows, each named for its user', async () => {
  await renderUsers()
  expect(makeButtons()).toHaveLength(2)
  expect(makeButtonFor('Grace Hopper')).toBeDefined()
  expect(makeButtonFor('Linus Torvalds')).toBeDefined()
  expect(makeButtonFor('Ada Lovelace')).toBeUndefined()
  expect(userRow('Ada Lovelace').querySelectorAll('button')).toHaveLength(0)
})

test('[T-016.4] clicking Make engineer calls onMakeEngineer with that user id exactly once', async () => {
  const onMakeEngineer = vi.fn(async () => {})
  await renderUsers({ onMakeEngineer })
  await act(async () => makeButtonFor('Grace Hopper')!.click())
  expect(onMakeEngineer).toHaveBeenCalledTimes(1)
  expect(onMakeEngineer).toHaveBeenCalledWith('u_grace')
})

test('[T-016.4] Make engineer is disabled until mutations are ready', async () => {
  const onMakeEngineer = vi.fn(async () => {})
  await renderUsers({ onMakeEngineer, ready: false })
  expect(makeButtons().length).toBeGreaterThan(0)
  for (const b of makeButtons()) expect((b as HTMLButtonElement).disabled).toBe(true)
  await act(async () => makeButtons()[0].click())
  expect(onMakeEngineer).not.toHaveBeenCalled()
})

test('[T-016.4] the current user row is marked (you); other rows are not', async () => {
  await renderUsers({ currentUserId: 'u_grace' })
  expect(userRow('Grace Hopper').textContent).toMatch(/\(you\)/i)
  expect(userRow('Ada Lovelace').textContent).not.toMatch(/\(you\)/i)
  expect(userRow('Linus Torvalds').textContent).not.toMatch(/\(you\)/i)
})

test('[T-016.4] a user with an empty name shows a neutral fallback, never the raw id', async () => {
  await renderUsers({ users: [{ id: 'u_noname_77', name: '', role: 'member' }], currentUserId: 'someone-else' })
  expect(text()).toMatch(/unnamed|unknown|anonymous|no name/i)
  expect(text()).not.toContain('u_noname_77')
  for (const el of document.querySelectorAll('[aria-label],[title]'))
    expect(`${el.getAttribute('aria-label')} ${el.getAttribute('title')}`).not.toContain('u_noname_77')
  expect(makeButtons()).toHaveLength(1)
})

test('[T-016.4] email is never rendered even if a caller passes it through', async () => {
  const withEmail = users.map(u => ({ ...u, email: `${u.id}@secret.example` }))
  await renderUsers({ users: withEmail })
  expect(text()).not.toContain('@')
  expect(document.body.innerHTML).not.toContain('secret.example')
})

test('[T-016.4] a rejected onMakeEngineer shows a role=alert error and the button is usable again', async () => {
  const onMakeEngineer = vi.fn(async () => { throw new Error('boom') })
  await renderUsers({ onMakeEngineer })
  await act(async () => makeButtonFor('Grace Hopper')!.click())
  expect(document.querySelector('[role="alert"]')?.textContent ?? '').toMatch(/boom|fail|could not|error/i)
  expect((makeButtonFor('Grace Hopper') as HTMLButtonElement).disabled).toBe(false)
  await act(async () => makeButtonFor('Grace Hopper')!.click())
  expect(onMakeEngineer).toHaveBeenCalledTimes(2)
})
