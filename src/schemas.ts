/**
 * Collection Schemas
 *
 * All collections with columns and RBAC permissions.
 * Single source of truth — imported by both worker and frontend.
 *
 * Add schemas by creating a file in src/schemas/ and importing it here.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import { draftsSchema } from './schemas/drafts-schema'
import { draftVersionsSchema } from './schemas/draft-versions-schema'
import { claimsSchema } from './schemas/claims-schema'
import { signoffsSchema } from './schemas/signoffs-schema'
import { publicationsSchema } from './schemas/publications-schema'
import { sourcesSchema } from './schemas/sources-schema'
import { kbStateSchema } from './schemas/kb-state-schema'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  draftsSchema,
  draftVersionsSchema,
  claimsSchema,
  signoffsSchema,
  publicationsSchema,
  sourcesSchema,
  kbStateSchema,
]
