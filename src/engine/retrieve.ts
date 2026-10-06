/**
 * Knowledge retrieval adapter (SPEC §4.4): one search per claim, chunks relabelled c0, c1, ...
 * so the judge can cite them and `validateCitations` can check the ids.
 */

import type { KnowledgeClient } from 'deepspace/worker'
import { CONFIG } from './config'

const SUFFIX = '.md'

/** `'concepts/permissions'` -> `'concepts__permissions.md'` (the file name used at upload). */
export function filenameForPath(path: string): string {
  return `${path.replaceAll('/', '__')}${SUFFIX}`
}

/** Inverse of {@link filenameForPath}; `null` for a file name that is not one of the curated pages. */
export function pageFromFilename(filename: string): string | null {
  if (!filename.endsWith(SUFFIX) || filename.length === SUFFIX.length) return null
  const page = filename.slice(0, -SUFFIX.length).replaceAll('__', '/')
  return CONFIG.sourcePages.some((p) => p === page) ? page : null
}

export interface RetrievedChunk {
  chunkId: string
  page: string
  text: string
}

const STOPWORDS = new Set(
  ('the a an of to in on for by with and or is are was were be been being can could will would should ' +
    'you your it its that this these those every each all per as at from up than').split(' '),
)
const NUMERIC = /^\$?\d[\d,.]*$/

// ponytail: naive keyword ladder for empty searches; upgrade path is ingesting docs by section (smaller chunks) or having the extractor emit a search query.
function fallbackQueries(claim: string): string[] {
  const words = claim
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((w) => w.length > 0 && !STOPWORDS.has(w.toLowerCase()))
  const text = words.filter((w) => !NUMERIC.test(w))
  // Stops at four words: shorter queries ("DeepSpace scales") return generic chunks for claims the docs do not cover.
  const ladder = [words, text, text.slice(0, 4)].map((l) => l.join(' '))
  return ladder.filter((q, i) => q.length > 1 && !ladder.slice(0, i).includes(q))
}

export async function retrieve(
  kb: Pick<KnowledgeClient, 'search'>,
  claimText: string,
): Promise<{ chunks: RetrievedChunk[] }> {
  const claim = claimText.slice(0, CONFIG.kb.maxQueryChars)
  // The folder is passed explicitly: callers hand in the unscoped client, whose options include it.
  const options = { folder: CONFIG.kb.folder, mode: CONFIG.kb.mode, limit: CONFIG.limits.kbLimit }
  const attempts = [claim, ...fallbackQueries(claim)].slice(0, CONFIG.limits.kbMaxSearchAttempts)
  for (const query of attempts) {
    const result = await kb.search(query, options)
    const chunks: RetrievedChunk[] = []
    for (const chunk of result.chunks) {
      const page = chunk.filename === undefined ? null : pageFromFilename(chunk.filename)
      if (page === null) continue
      chunks.push({ chunkId: `c${chunks.length}`, page, text: chunk.text })
    }
    if (chunks.length > 0) return { chunks }
  }
  return { chunks: [] }
}
