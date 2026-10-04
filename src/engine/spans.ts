import type { Verdict } from './contracts'

const PRIORITY: Record<Verdict, number> = { supported: 1, unsupported: 2, contradicted: 3 }

const QUOTES: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '‟': '"',
}

/**
 * Whitespace-collapsed, quote-straightened copy of `s`. `starts[i]` / `ends[i]` give the
 * original [start, end) offsets of normalized char i (a collapsed whitespace run maps to one space).
 */
function normalizeWithMap(s: string): { text: string; starts: number[]; ends: number[] } {
  let text = ''
  const starts: number[] = []
  const ends: number[] = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (/\s/.test(ch)) {
      let j = i + 1
      while (j < s.length && /\s/.test(s[j])) j++
      text += ' '
      starts.push(i)
      ends.push(j)
      i = j
    } else {
      text += QUOTES[ch] ?? ch
      starts.push(i)
      ends.push(i + 1)
      i++
    }
  }
  return { text, starts, ends }
}

/** Locates `quote` in `body`; returns [start, end) offsets into the ORIGINAL body, or null. */
export function locateQuote(body: string, quote: string, from = 0): [number, number] | null {
  if (quote.length === 0) return null

  // 1. Exact match from `from`, then from 0.
  const exact = body.indexOf(quote, from)
  const at = exact !== -1 ? exact : body.indexOf(quote, 0)
  if (at !== -1) return [at, at + quote.length]

  // 2. Whitespace- and quote-normalized match, mapped back to original offsets.
  const nb = normalizeWithMap(body)
  const nq = normalizeWithMap(quote).text.trim()
  if (nq.length === 0) return null
  let fromNorm = nb.starts.findIndex((st) => st >= from)
  if (fromNorm === -1) fromNorm = nb.text.length
  let n = nb.text.indexOf(nq, fromNorm)
  if (n === -1) n = nb.text.indexOf(nq, 0)
  if (n === -1) return null
  return [nb.starts[n], nb.ends[n + nq.length - 1]]
}

export function segmentBySpans(
  body: string,
  claims: ReadonlyArray<{ id: string; span: readonly [number, number]; verdict: Verdict }>,
): Array<{ text: string; claimIds: string[]; verdict: Verdict | null }> {
  const clamped = claims
    .map((c) => ({
      id: c.id,
      verdict: c.verdict,
      start: Math.max(0, Math.min(body.length, c.span[0])),
      end: Math.max(0, Math.min(body.length, c.span[1])),
    }))
    .filter((c) => c.start < c.end)

  const cuts = [...new Set([0, body.length, ...clamped.flatMap((c) => [c.start, c.end])])].sort((a, b) => a - b)

  const segments: Array<{ text: string; claimIds: string[]; verdict: Verdict | null }> = []
  for (let k = 0; k + 1 < cuts.length; k++) {
    const [a, b] = [cuts[k], cuts[k + 1]]
    const covering = clamped.filter((c) => c.start <= a && c.end >= b)
    let verdict: Verdict | null = null
    for (const c of covering) {
      if (verdict === null || PRIORITY[c.verdict] > PRIORITY[verdict]) verdict = c.verdict
    }
    segments.push({ text: body.slice(a, b), claimIds: covering.map((c) => c.id), verdict })
  }
  return segments
}
