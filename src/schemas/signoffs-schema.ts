/**
 * Groundtruth - signoffs (SPEC §3, ADR-0003). Admin-only writes; `reviewerId` is stamped
 * server-side from the verified identity and cannot be changed or spoofed.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const signoffsSchema: CollectionSchema = {
  name: 'signoffs',
  columns: [
    { name: 'claimId', storage: 'text', interpretation: 'plain', immutable: true },
    { name: 'versionId', storage: 'text', interpretation: 'plain', immutable: true },
    {
      name: 'reviewerId',
      storage: 'text',
      interpretation: 'plain',
      userBound: true,
      immutable: true,
    },
    {
      name: 'decision',
      storage: 'text',
      interpretation: { kind: 'select', options: ['approve', 'cut'] },
    },
    { name: 'note', storage: 'text', interpretation: 'plain', required: true },
  ],
  ownerField: 'reviewerId',
  uniqueOn: ['claimId', 'reviewerId'],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: true, update: 'own', delete: 'own' },
  },
}
