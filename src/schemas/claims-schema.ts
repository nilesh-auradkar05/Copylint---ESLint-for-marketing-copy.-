/**
 * Groundtruth - claims (SPEC §3). Written only by job / cron code.
 * `fix` and `carriedFrom` are "nullable" by not being required; '' and missing mean the same.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const claimsSchema: CollectionSchema = {
  name: 'claims',
  columns: [
    { name: 'versionId', storage: 'text', interpretation: 'plain' },
    { name: 'draftId', storage: 'text', interpretation: 'plain' },
    { name: 'claimHash', storage: 'text', interpretation: 'plain' },
    { name: 'text', storage: 'text', interpretation: 'plain' },
    { name: 'quote', storage: 'text', interpretation: 'plain' },
    { name: 'span', storage: 'text', interpretation: { kind: 'json' } },
    {
      name: 'kind',
      storage: 'text',
      interpretation: {
        kind: 'select',
        options: [
          'capability',
          'limit',
          'number',
          'default',
          'security',
          'pricing',
          'deployment',
          'comparison',
        ],
      },
    },
    {
      name: 'verdict',
      storage: 'text',
      interpretation: { kind: 'select', options: ['supported', 'contradicted', 'unsupported'] },
    },
    {
      name: 'confidence',
      storage: 'text',
      interpretation: { kind: 'select', options: ['high', 'medium', 'low'] },
    },
    { name: 'evidence', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'reason', storage: 'text', interpretation: 'plain' },
    { name: 'fix', storage: 'text', interpretation: 'plain' },
    { name: 'carriedFrom', storage: 'text', interpretation: 'plain' },
  ],
  uniqueOn: ['versionId', 'claimHash'],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: false },
  },
}
