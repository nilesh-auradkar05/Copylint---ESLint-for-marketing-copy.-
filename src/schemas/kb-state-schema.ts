/**
 * Groundtruth - kb_state (SPEC §3). Singleton row with id `global`; written only by sync code.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const kbStateSchema: CollectionSchema = {
  name: 'kb_state',
  columns: [
    { name: 'version', storage: 'number', interpretation: 'plain' },
    { name: 'lastSyncAt', storage: 'text', interpretation: 'plain' },
    { name: 'lastChangedPages', storage: 'text', interpretation: { kind: 'json' } },
  ],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: false },
  },
}
