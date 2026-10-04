// @vitest-environment jsdom
// Fixture UI contracts; live member persistence requires the T-002 draft schema.
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
const seed = readFileSync(resolve('seed/launch-thread.md'), 'utf8')
async function load(file: string, name = 'default') {
  const path = resolve('src', file)
  expect(existsSync(path), `Missing T-010 implementation: ${path}`).toBe(true)
  return (await import(path))[name]
}
async function render(element: React.ReactNode) {
  if (!root) { document.body.innerHTML = '<div id="test-root"></div>'; root = createRoot(document.getElementById('test-root')!) }
  await act(async () => root!.render(element))
}
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ''; vi.restoreAllMocks() })
function field(text: string) {
  const label = [...document.querySelectorAll('label')].find(l => l.textContent?.toLowerCase().includes(text))
  expect(label?.control, `Accessible ${text} field`).toBeTruthy()
  return label!.control as HTMLInputElement | HTMLTextAreaElement
}
async function fill(text: string, value: string) {
  const input = field(text)
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, value)
  await act(async () => input.dispatchEvent(new Event('input', { bubbles: true })))
}
async function submit() { await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))) }
function sampleButton() { return [...document.querySelectorAll('button')].find(b => b.textContent?.includes('Create from sample'))! }

test('[T-010.1] signed-out landing renders without providers or network and offers sign-in', async () => {
  const Landing = await load('pages/index.tsx')
  const fetch = vi.spyOn(globalThis, 'fetch')
  await render(<Landing />)
  expect(document.querySelector('h1')?.textContent?.trim()).toBeTruthy()
  expect([...document.querySelectorAll('a,button')].some(e => /sign in/i.test(e.textContent ?? ''))).toBe(true)
  expect(fetch).not.toHaveBeenCalled()
  expect(readFileSync(resolve('src/pages/index.tsx'), 'utf8')).not.toMatch(/\buse(?:Auth|Records|Query|Mutations|Users|Jobs)\s*\(/)
})

test('[T-010.2] required title and the 20000-character boundary prevent invalid creation', async () => {
  const DraftForm = await load('components/DraftForm.tsx', 'DraftForm')
  const create = vi.fn().mockResolvedValue(undefined)
  await render(<DraftForm ready onCreate={create} />)
  await fill('body', 'Draft body'); await submit()
  expect(create).not.toHaveBeenCalled()
  await fill('title', 'Launch'); await fill('body', 'x'.repeat(20_001)); await submit()
  expect(create).not.toHaveBeenCalled()
  await fill('body', 'x'.repeat(20_000))
  expect(document.body.textContent?.replaceAll(',', '')).toMatch(/20000\s*\/\s*20000/)
  await submit()
  expect(create).toHaveBeenCalledExactlyOnceWith({ title: 'Launch', channel: expect.stringMatching(/^(blog|thread|landing|email)$/), body: 'x'.repeat(20_000) })
})

test('[T-010.2] live count follows edits and a created fixture is visible in the list', async () => {
  const DraftForm = await load('components/DraftForm.tsx', 'DraftForm')
  const DraftList = await load('components/DraftList.tsx', 'DraftList')
  const create = vi.fn().mockResolvedValue(undefined)
  await render(<DraftForm ready onCreate={create} />)
  await fill('title', 'Launch'); await fill('body', 'abc')
  expect(document.body.textContent?.replaceAll(',', '')).toMatch(/3\s*\/\s*20000/)
  await submit()
  const data = create.mock.calls[0][0]
  await render(<DraftList ready drafts={[{ recordId: 'draft-1', updatedAt: '2026-10-04T12:00:00Z', data }]} onCreate={create} />)
  expect(document.body.textContent).toContain('Launch')
  expect(document.body.textContent?.toLowerCase()).toContain(data.channel)
  expect(document.querySelector('a[href="/drafts/draft-1"]')).toBeTruthy()
})

test('[T-010.3] empty state creates the exact launch-thread sample', async () => {
  const DraftList = await load('components/DraftList.tsx', 'DraftList')
  const create = vi.fn().mockResolvedValue(undefined)
  await render(<DraftList ready drafts={[]} onCreate={create} />)
  expect(sampleButton()).toBeTruthy()
  await act(async () => sampleButton().click())
  expect(create).toHaveBeenCalledExactlyOnceWith({ title: 'DeepSpace launch thread', channel: 'thread', body: seed })
})

test('[T-010.4] create and sample controls stay disabled until mutation readiness', async () => {
  const DraftForm = await load('components/DraftForm.tsx', 'DraftForm')
  const DraftList = await load('components/DraftList.tsx', 'DraftList')
  const create = vi.fn().mockResolvedValue(undefined)
  await render(<DraftForm ready={false} onCreate={create} />)
  await fill('title', 'Launch'); await fill('body', 'Ready to write')
  expect((document.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true)
  await submit(); expect(create).not.toHaveBeenCalled()
  await render(<DraftForm ready onCreate={create} />)
  expect((document.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false)
  await render(<DraftList ready={false} drafts={[]} onCreate={create} />)
  expect(sampleButton().disabled).toBe(true)
  await render(<DraftList ready drafts={[]} onCreate={create} />)
  expect(sampleButton().disabled).toBe(false)
})

test('[T-010.2] slow creation prevents duplicate submissions; failed creation retries in place', async () => {
  const DraftForm = await load('components/DraftForm.tsx', 'DraftForm')
  let reject!: (reason: Error) => void
  const create = vi.fn().mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail })).mockResolvedValue(undefined)
  await render(<DraftForm ready onCreate={create} />)
  await fill('title', 'Unsaved launch'); await fill('body', 'Keep this body'); await submit()
  expect((document.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true)
  await submit(); expect(create).toHaveBeenCalledTimes(1)
  await act(async () => reject(new Error('Integration unavailable')))
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Integration unavailable')
  expect(field('title').value).toBe('Unsaved launch'); expect(field('body').value).toBe('Keep this body')
  await submit(); expect(create).toHaveBeenCalledTimes(2)
})

function luminance(hex: string) {
  expect(hex).toMatch(/^#[\da-f]{6}$/i)
  const channels = hex.slice(1).match(/../g)!.map(c => parseInt(c, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
}
test.each(['proof-desk', 'proof-desk-dark'])('[T-010.5] %s text and verdict chip token pairs meet WCAG AA', theme => {
  const path = resolve('src/themes.css')
  expect(existsSync(path), 'Missing T-010 theme CSS').toBe(true)
  const css = readFileSync(path, 'utf8')
  const block = css.match(new RegExp(`\\[data-theme=["']${theme}["']\\]\\s*\\{([^}]+)\\}`))?.[1]
  expect(block, `Theme selector ${theme}`).toBeTruthy()
  const tokens = Object.fromEntries([...block!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))
  for (const name of ['background', 'verdict-supported', 'verdict-contradicted', 'verdict-unsupported']) {
    const bg = luminance(tokens[`--color-${name}`])
    const fg = luminance(tokens[`--color-${name === 'background' ? 'foreground' : name + '-foreground'}`])
    expect((Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05), `${theme}: ${name}`).toBeGreaterThanOrEqual(4.5)
  }
  if (theme === 'proof-desk') {
    expect(tokens['--color-background'].toUpperCase()).toBe('#FBFAF7')
    expect(tokens['--color-foreground'].toUpperCase()).toBe('#1B1B1F')
    for (const accent of ['#C92A2A', '#E8590C', '#2F9E44']) expect(css.toUpperCase()).toContain(accent)
  }
})
