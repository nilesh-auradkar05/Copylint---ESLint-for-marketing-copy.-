/**
 * Groundtruth - drafts (SPEC §3). Writers own drafts; collaborators share them.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const draftsSchema: CollectionSchema = {
  name: 'drafts',
  columns: [
    { name: 'title', storage: 'text', interpretation: 'plain', required: true },
    {
      name: 'channel',
      storage: 'text',
      interpretation: { kind: 'select', options: ['blog', 'thread', 'landing', 'email'] },
    },
    { name: 'body', storage: 'text', interpretation: 'plain', required: true },
    { name: 'collaborators', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'latestVersionId', storage: 'text', interpretation: 'plain' },
  ],
  collaboratorsField: 'collaborators',
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    member: {
      read: 'shared',
      create: true,
      update: 'shared',
      delete: 'own',
      writableFields: ['title', 'channel', 'body', 'collaborators'],
    },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
