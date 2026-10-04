/**
 * Groundtruth - publications (SPEC §3). Written only by the publishDraft action and the drift cron.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const publicationsSchema: CollectionSchema = {
  name: 'publications',
  columns: [
    { name: 'draftId', storage: 'text', interpretation: 'plain' },
    { name: 'versionId', storage: 'text', interpretation: 'plain' },
    { name: 'url', storage: 'text', interpretation: 'plain' },
    { name: 'kbVersionAtPublish', storage: 'number', interpretation: 'plain' },
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: ['live', 'stale'] },
    },
    { name: 'stalePages', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'staleSince', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: false },
  },
}
