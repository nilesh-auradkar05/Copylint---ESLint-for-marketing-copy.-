/**
 * Groundtruth - sources (SPEC §3). One row per curated docs page; written only by sync code.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const sourcesSchema: CollectionSchema = {
  name: 'sources',
  columns: [
    { name: 'path', storage: 'text', interpretation: 'plain' },
    { name: 'contentHash', storage: 'text', interpretation: 'plain' },
    { name: 'kbItemIds', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'lastFetchedAt', storage: 'text', interpretation: 'plain' },
    {
      name: 'indexStatus',
      storage: 'text',
      interpretation: {
        kind: 'select',
        options: ['queued', 'indexing', 'completed', 'error'],
      },
    },
  ],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: false },
  },
}
