/**
 * Groundtruth - draft_versions (SPEC §3). Frozen bodies; written only by job / action code.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const draftVersionsSchema: CollectionSchema = {
  name: 'draft_versions',
  columns: [
    { name: 'draftId', storage: 'text', interpretation: 'plain' },
    { name: 'body', storage: 'text', interpretation: 'plain' },
    { name: 'bodyHash', storage: 'text', interpretation: 'plain' },
    { name: 'kbVersion', storage: 'number', interpretation: 'plain' },
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: ['checking', 'checked', 'failed'] },
    },
    { name: 'requestedBy', storage: 'text', interpretation: 'plain' },
    { name: 'requestedAt', storage: 'text', interpretation: 'plain' },
    {
      name: 'mode',
      storage: 'text',
      interpretation: { kind: 'select', options: ['full', 'reverify'] },
    },
    { name: 'jobId', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: false },
  },
}
