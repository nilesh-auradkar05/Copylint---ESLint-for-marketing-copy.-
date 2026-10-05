// @vitest-environment jsdom
// T-012 sign-off panel: presentational contract only (no DeepSpace hooks, no mocks except onDecide).
// SignoffPanel({claims, signoffs, versionId, isAdmin, userId, ready, names, onDecide}) lists the
// non-supported claims of `versionId`; admins get a note field + Approve/Cut per claim.
// Accessible queries only: role/name/text.
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import fixture from '../eval/fixtures/review-room.json'
import type { Claim, Signoff } from '../src/engine/contracts'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const flat = <T,>(rows: { recordId: string; data: object }[]) => rows.map(({ recordId, data }) => ({ id: recordId, ...data }) as T)
const versionId = fixture.expected.latestVersionId
const claims = flat<Claim>(fixture.claims).filter(c => c.versionId === versionId)
const [supported, auth, scale] = [claims[0], claims[1], claims[2]] // supported, contradicted, unsupported
const mine = { id: 's_mine', claimId: auth.id, versionId, reviewerId: 'me', decision: 'approve', note: 'Checked against docs.' } as Signoff
const theirs = { id: 's_theirs', claimId: scale.id, versionId, reviewerId: 'them', decision: 'cut', note: 'Rewrite it.' } as Signoff
const old = { id: 's_old', claimId: auth.id, versionId: 'old-version', reviewerId: 'zed', decision: 'approve', note: 'Old.' } as Signoff
const names = { me: 'Ada Lovelace', them: 'Grace Hopper', zed: 'Zed Old' }
const defaults = { claims, signoffs: [] as Signoff[], versionId, isAdmin: true, userId: 'me', ready: true, names, onDecide: async () => {} }
type Props = Partial<typeof defaults> & { onDecide?: (i: never) => Promise<void> }
let root: Root | undefined
async function render(overrides: Props = {}) {
  const path = resolve('src/components/SignoffPanel.tsx')
  expect(existsSync(path), 'Missing T-012 SignoffPanel component').toBe(true)
  const { SignoffPanel } = await import(path)
  if (!root) {
    document.body.innerHTML = '<div id="test-root"></div>'
    root = createRoot(document.getElementById('test-root')!)
  }
  await act(async () => root!.render(<SignoffPanel {...defaults} {...overrides} />))
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  document.body.innerHTML = ''
})
const text = () => document.body.textContent ?? ''
const buttons = (re: RegExp) => [...document.querySelectorAll('button')].filter(b => re.test(b.textContent ?? ''))
const noteFields = () => [...document.querySelectorAll<HTMLInputElement>('input:not([type=button]):not([type=submit]), textarea, [role="textbox"]')]
function name(el: Element) {
  const labelled = (el.getAttribute('aria-labelledby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent ?? '').join(' ')
  const label = el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent : ''
  return [el.getAttribute('aria-label'), labelled, label, el.closest('label')?.textContent, el.getAttribute('placeholder')].filter(Boolean).join(' ')
}
// Smallest element holding the claim text and exactly one note field: that claim's row.
function row(claim: Claim) {
  const rows = [...document.querySelectorAll<HTMLElement>('*')].filter(el => el.textContent?.includes(claim.text) && el.querySelectorAll('input, textarea, [role="textbox"]').length === 1)
  expect(rows.length, `Row for ${claim.id}`).toBeGreaterThan(0)
  return rows.sort((a, b) => a.textContent!.length - b.textContent!.length)[0]
}
async function decide(claim: Claim, label: RegExp, note: string) {
  const r = row(claim)
  const field = r.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')!
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')!.set!
  await act(async () => { setter.call(field, note); field.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => [...r.querySelectorAll('button')].find(b => label.test(b.textContent ?? ''))!.click())
}

test('[T-012.1] lists only contradicted and unsupported claims by text; nothing when all are supported', async () => {
  await render()
  expect(text()).toContain(auth.text)
  expect(text()).toContain(scale.text)
  expect(text()).not.toContain(supported.text)
  await render({ claims: [supported] })
  expect(document.body.textContent).toBe('')
})

test('[T-012.1] non-admin sees no Approve/Cut buttons or note field, but still sees existing sign-offs', async () => {
  await render({ isAdmin: false, signoffs: [mine, theirs] })
  expect(buttons(/approve|cut/i)).toHaveLength(0)
  expect(noteFields()).toHaveLength(0)
  expect(text()).toContain('Ada Lovelace')
  expect(text()).toContain('Grace Hopper')
})

test('[T-012.1] admin gets a note field, Approve and Cut for each listed claim', async () => {
  await render()
  expect(noteFields()).toHaveLength(2)
  for (const claim of [auth, scale]) {
    const r = row(claim)
    expect(name(r.querySelector('input, textarea, [role="textbox"]')!)).toMatch(/note/i)
    expect(buttons(/approve/i).filter(b => r.contains(b))).toHaveLength(1)
    expect(buttons(/cut/i).filter(b => r.contains(b))).toHaveLength(1)
  }
})

test.each([[''], ['   \n ']])('[T-012.1] a blank note %j blocks the decision and shows a role=alert', async note => {
  const onDecide = vi.fn(async () => {})
  await render({ onDecide })
  await decide(auth, /approve/i, note)
  expect(onDecide).not.toHaveBeenCalled()
  expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/note/i)
  await decide(auth, /cut/i, note)
  expect(onDecide).not.toHaveBeenCalled()
})

test.each([['approve', /approve/i], ['cut', /cut/i]] as const)('[T-012.1] %s with a note calls onDecide once with the trimmed note and no existing', async (decision, label) => {
  const onDecide = vi.fn(async () => {})
  await render({ onDecide })
  await decide(scale, label, '  Reviewed the docs.  ')
  expect(onDecide).toHaveBeenCalledTimes(1)
  const input = onDecide.mock.calls[0][0] as { claim: Claim; decision: string; note: string; existing?: Signoff }
  expect(input).toMatchObject({ claim: scale, decision, note: 'Reviewed the docs.' })
  expect(input.existing).toBeUndefined()
})

test('[T-012.1] the signed-in reviewer\'s own sign-off on that version is passed as existing; others and old versions are not', async () => {
  const onDecide = vi.fn(async () => {})
  await render({ onDecide, signoffs: [mine, theirs, { ...mine, id: 's_old_mine', versionId: 'old-version' }] })
  await decide(auth, /cut/i, 'Changed my mind.')
  expect((onDecide.mock.calls[0][0] as { existing?: Signoff }).existing).toEqual(mine)
  await decide(scale, /approve/i, 'Fine.')
  expect((onDecide.mock.calls[1][0] as { existing?: Signoff }).existing).toBeUndefined()
})

test('[T-012.1] controls are disabled until mutations are ready', async () => {
  await render({ ready: false })
  const all = buttons(/approve|cut/i)
  expect(all).toHaveLength(4)
  expect(all.every(b => b.disabled)).toBe(true)
})

test('[T-012.3] an approve sign-off shows the reviewer name and decision, not "edit required"', async () => {
  await render({ isAdmin: false, signoffs: [mine] })
  expect(text()).toContain('Ada Lovelace')
  expect(text()).toMatch(/approve/i)
  expect(text()).not.toMatch(/edit required/i)
})

test('[T-012.3] a cut sign-off shows the reviewer name and "edit required"', async () => {
  await render({ isAdmin: false, signoffs: [theirs] })
  expect(text()).toContain('Grace Hopper')
  expect(text()).toMatch(/edit required/i)
})

test('[T-012.3] unknown reviewer ids render as "Engineer" (never the raw id); sign-offs of other versions are hidden', async () => {
  await render({ isAdmin: false, signoffs: [{ ...theirs, reviewerId: 'user_raw_77' }, old] })
  expect(text()).toContain('Engineer')
  expect(text()).not.toContain('user_raw_77')
  expect(text()).not.toContain('Zed Old')
  expect(text()).not.toContain(old.note)
})

test('[T-012.3] a rejecting onDecide surfaces its message in a role=alert and the panel stays usable', async () => {
  const onDecide = vi.fn(async () => { throw new Error('Forbidden by server') })
  await render({ onDecide })
  await decide(auth, /approve/i, 'Looks right.')
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Forbidden by server')
  expect(buttons(/approve/i).length).toBeGreaterThan(0)
})
