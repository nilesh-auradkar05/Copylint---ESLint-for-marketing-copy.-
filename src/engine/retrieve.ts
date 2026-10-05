/**
 * Knowledge retrieval adapter (SPEC §4.4): one search per claim, chunks relabelled c0, c1, ...
 * so the judge can cite them and `validateCitations` can check the ids.
 */

import type { KnowledgeSearchOptions, ScopedKnowledgeClient } from 'deepspace/worker'
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

export async function retrieve(
  kb: Pick<ScopedKnowledgeClient, 'search'>,
  claimText: string,
): Promise<{ chunks: RetrievedChunk[] }> {
  // The folder is passed explicitly: callers hand in the unscoped client, whose options include it.
  const options: KnowledgeSearchOptions = {
    folder: CONFIG.kb.folder,
    mode: CONFIG.kb.mode,
    limit: CONFIG.limits.kbLimit,
  }
  const result = await kb.search(claimText.slice(0, CONFIG.kb.maxQueryChars), options)
  const chunks: RetrievedChunk[] = []
  for (const chunk of result.chunks) {
    const page = chunk.filename === undefined ? null : pageFromFilename(chunk.filename)
    if (page === null) continue
    chunks.push({ chunkId: `c${chunks.length}`, page, text: chunk.text })
  }
  return { chunks }
}
