/**
 * T-002 Layer 1: schema + RBAC contract tests (SPEC §3, §11; ADR-0003, ADR-0004; AGENTS.md §6).
 *
 * These run today under Node. They import the REAL `schemas` array from `src/schemas.ts` and
 * evaluate it with the SDK's OWN permission engine from `deepspace/worker`
 * (`canRead`, `canCreate`, `canUpdate`, `canDelete`, `lintSchemas`). Nothing is mocked.
 * The live, over-the-wire half of the matrix is in `tests/api.spec.ts`.
 *
 * Run: npx vitest run --config node_modules/.gt-vitest.config.mjs src/schemas
 *
 * Role facts, verified from `node_modules/deepspace/dist/worker.js` (the .d.ts/JS beat the docs):
 *  - `getRolePermissions(schema, role)` returns `schema.permissions[role]`, else
 *    `schema.permissions['*']`, else all-false.
 *  - A signed-out WebSocket connection is attached with role `ROLE_ANONYMOUS`, which is the string
 *    'viewer' (RecordRoom.onConnect), NOT the '*' key. '*' is only the fallback for a role with
 *    no entry. So "signed-out gets nothing" has to hold for BOTH the role the room really assigns
 *    ('viewer') and the '*' key itself. If a schema declared a permissive `viewer` entry, signed-out
 *    callers would get it, even though SPEC §11 note 4 says they match '*'.
 *  - Ownership is `record.createdBy === userId` unless the schema sets `ownerField`.
 */
import { describe, expect, it } from 'vitest'
import {
  ROLE_ANONYMOUS,
  canCreate,
  canDelete,
  canRead,
  canUpdate,
  getRolePermissions,
  lintSchema,
  lintSchemas,
} from 'deepspace/worker'
import type { CollectionSchema, ColumnDefinition } from 'deepspace/schema'
import { schemas } from './schemas'

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const NEW_COLLECTIONS = [
  'drafts',
  'draft_versions',
  'claims',
  'signoffs',
  'publications',
  'sources',
  'kb_state',
] as const
type NewCollection = (typeof NEW_COLLECTIONS)[number]

/** Collections whose rows are written only by job / cron / action code (SPEC §3, AGENTS.md §6). */
const SERVER_ONLY = [
  'draft_versions',
  'claims',
  'signoffs',
  'publications',
  'sources',
  'kb_state',
] as const

/** Roles a signed-out or unknown caller can end up with. See header note. */
const SIGNED_OUT_ROLES = ['*', ROLE_ANONYMOUS, 'no-such-role'] as const

const ALICE = 'user-alice'
const BOB = 'user-bob'
const ADMIN_1 = 'user-admin-1'
const ADMIN_2 = 'user-admin-2'
const ANON = 'anon-0000-1111'

interface Rec {
  recordId: string
  createdBy: string
  data: Record<string, unknown>
}
const rec = (createdBy: string, data: Record<string, unknown> = {}): Rec => ({
  recordId: 'rec-1',
  createdBy,
  data,
})

function schemaOf(name: string): CollectionSchema {
  const s = schemas.find((x) => x.name === name)
  if (!s) throw new Error(`collection '${name}' is not registered in src/schemas.ts`)
  return s
}

function colOf(collection: string, name: string): ColumnDefinition {
  const c = schemaOf(collection).columns.find((x) => x.name === name)
  if (!c) throw new Error(`column '${collection}.${name}' is missing`)
  return c
}

/** `interpretation` may be a bare string ('plain') or `{ kind }`. */
function interpKind(col: ColumnDefinition): string {
  return typeof col.interpretation === 'string' ? col.interpretation : col.interpretation.kind
}

function selectOptions(col: ColumnDefinition): string[] {
  const i = col.interpretation
  if (typeof i === 'string' || i.kind !== 'select') {
    throw new Error(`column '${col.name}' is not a select column`)
  }
  return [...i.options]
}

// ---------------------------------------------------------------------------------------------
// SPEC §3 column table, transcribed. `text` = storage 'text'; `number` = storage 'number' (§11).
// ---------------------------------------------------------------------------------------------

type ColSpec =
  | { name: string; type: 'text'; required?: boolean }
  | { name: string; type: 'number' }
  | { name: string; type: 'json' }
  | { name: string; type: 'select'; options: string[] }

const t = (name: string, required?: boolean): ColSpec => ({ name, type: 'text', required })
const n = (name: string): ColSpec => ({ name, type: 'number' })
const j = (name: string): ColSpec => ({ name, type: 'json' })
const sel = (name: string, ...options: string[]): ColSpec => ({ name, type: 'select', options })

const SPEC_COLUMNS: Record<NewCollection, ColSpec[]> = {
  drafts: [
    t('title', true),
    sel('channel', 'blog', 'thread', 'landing', 'email'),
    t('body', true),
    j('collaborators'),
    t('latestVersionId'),
  ],
  draft_versions: [
    t('draftId'),
    t('body'),
    t('bodyHash'),
    n('kbVersion'),
    sel('status', 'checking', 'checked', 'failed'),
    t('requestedBy'),
    t('requestedAt'),
    sel('mode', 'full', 'reverify'),
    t('jobId'),
  ],
  claims: [
    t('versionId'),
    t('draftId'),
    t('claimHash'),
    t('text'),
    t('quote'),
    j('span'),
    sel('kind', 'capability', 'limit', 'number', 'default', 'security', 'pricing', 'deployment', 'comparison'),
    sel('verdict', 'supported', 'contradicted', 'unsupported'),
    sel('confidence', 'high', 'medium', 'low'),
    j('evidence'),
    t('reason'),
    t('fix'),
    t('carriedFrom'),
  ],
  signoffs: [
    t('claimId'),
    t('versionId'),
    t('reviewerId'),
    sel('decision', 'approve', 'cut'),
    t('note', true),
  ],
  publications: [
    t('draftId'),
    t('versionId'),
    t('url'),
    n('kbVersionAtPublish'),
    sel('status', 'live', 'stale'),
    j('stalePages'),
    t('staleSince'),
  ],
  sources: [
    t('path'),
    t('contentHash'),
    j('kbItemIds'),
    t('lastFetchedAt'),
    sel('indexStatus', 'queued', 'indexing', 'completed', 'error'),
  ],
  kb_state: [n('version'), t('lastSyncAt'), j('lastChangedPages')],
}

// ---------------------------------------------------------------------------------------------
// T-002.1  registration, lint, columns
// ---------------------------------------------------------------------------------------------

describe('T-002.1 registration, lint and columns', () => {
  it('[T-002.1] users and settings are still registered', () => {
    const names = schemas.map((s) => s.name)
    expect(names).toContain('users')
    expect(names).toContain('settings')
  })

  it('[T-002.1] registers exactly users, settings and the seven SPEC §3 collections, no duplicates', () => {
    const names = schemas.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
    expect([...names].sort()).toEqual(['users', 'settings', ...NEW_COLLECTIONS].sort())
  })

  it('[T-002.1] lintSchemas(schemas) returns no warnings (worker boots clean)', () => {
    expect(lintSchemas(schemas)).toEqual([])
  })

  it.each(schemas.map((s) => [s.name, s] as const))(
    '[T-002.1] lintSchema(%s) returns no warnings',
    (_name, schema) => {
      expect(lintSchema(schema)).toEqual([])
    },
  )

  for (const collection of NEW_COLLECTIONS) {
    describe(`columns of ${collection}`, () => {
      for (const spec of SPEC_COLUMNS[collection]) {
        it(`[T-002.1] ${collection}.${spec.name} is ${spec.type}${spec.type === 'select' ? ` (${spec.options.join(',')})` : ''}`, () => {
          const col = colOf(collection, spec.name)
          switch (spec.type) {
            case 'number':
              // SPEC §11: integers are `storage: 'number'`, there is no text fallback.
              expect(col.storage).toBe('number')
              break
            case 'text':
              expect(col.storage).toBe('text')
              if (spec.required) expect(col.required).toBe(true)
              break
            case 'json':
              expect(col.storage).toBe('text')
              expect(col.interpretation).toEqual({ kind: 'json' })
              break
            case 'select':
              expect(col.storage).toBe('text')
              expect(interpKind(col)).toBe('select')
              expect(selectOptions(col).sort()).toEqual([...spec.options].sort())
              break
          }
        })
      }

      it(`[T-002.1] ${collection} declares no columns beyond SPEC §3`, () => {
        const declared = schemaOf(collection).columns.map((c) => c.name).sort()
        const expected = SPEC_COLUMNS[collection].map((c) => c.name).sort()
        expect(declared).toEqual(expected)
      })
    })
  }

  it('[T-002.1] drafts.collaboratorsField is the collaborators column', () => {
    expect(schemaOf('drafts').collaboratorsField).toBe('collaborators')
  })

  it('[T-002.1] the existing users schema is kept (extended, never replaced)', () => {
    const users = schemaOf('users')
    for (const c of ['email', 'name', 'imageUrl', 'role', 'createdAt', 'lastSeenAt']) {
      expect(users.columns.map((x) => x.name)).toContain(c)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// T-002.2  signed-out callers get nothing
// ---------------------------------------------------------------------------------------------

describe('T-002.2 signed-out and unknown roles get nothing', () => {
  for (const collection of NEW_COLLECTIONS) {
    for (const role of SIGNED_OUT_ROLES) {
      describe(`${collection} as role '${role}'`, () => {
        // A record that tries every loophole: the caller created it, is listed as collaborator,
        // and it carries public-looking visibility values.
        const tempting = rec(ANON, {
          collaborators: [ANON],
          visibility: 'public',
          status: 'public',
          reviewerId: ANON,
        })
        const schema = () => schemaOf(collection)

        it(`[T-002.2] cannot read any record of ${collection}`, () => {
          expect(canRead(schema(), role, tempting, ANON)).toBe(false)
          expect(canRead(schema(), role, rec(ALICE), ANON)).toBe(false)
          expect(canRead(schema(), role, rec('server', { collaborators: [] }), ANON)).toBe(false)
        })

        it(`[T-002.2] cannot create ${collection}`, () => {
          expect(canCreate(schema(), role)).toBe(false)
        })

        it(`[T-002.2] cannot update ${collection}`, () => {
          expect(canUpdate(schema(), role, tempting, ANON)).toBe(false)
        })

        it(`[T-002.2] cannot delete ${collection}`, () => {
          expect(canDelete(schema(), role, tempting, ANON)).toBe(false)
        })
      })
    }
  }

  it('[T-002.2] the role a signed-out WebSocket is assigned is the SDK ROLE_ANONYMOUS (guards the assumption above)', () => {
    expect(ROLE_ANONYMOUS).toBe('viewer')
  })

  it.each(NEW_COLLECTIONS.map((c) => [c] as const))(
    "[T-002.2] %s: a role with no entry at all resolves to an all-false permission set",
    (collection) => {
      const p = getRolePermissions(schemaOf(collection), 'no-such-role')
      expect(p).toMatchObject({ read: false, create: false, update: false, delete: false })
    },
  )

  it.each(NEW_COLLECTIONS.map((c) => [c] as const))(
    "[T-002.2] %s: if a 'viewer' entry exists it grants nothing (signed-out callers are 'viewer' at runtime)",
    (collection) => {
      const p = getRolePermissions(schemaOf(collection), ROLE_ANONYMOUS)
      expect(p).toMatchObject({ read: false, create: false, update: false, delete: false })
    },
  )
})

// ---------------------------------------------------------------------------------------------
// AGENTS.md §6: no collection readable by '*'
// ---------------------------------------------------------------------------------------------

describe('AGENTS.md §6 no collection is readable by the wildcard role', () => {
  it.each(schemas.map((s) => [s.name, s] as const))(
    "[T-002.2] %s: permissions['*'] is absent or read:false (no new public collection)",
    (_name, schema) => {
      const star = schema.permissions['*']
      if (star !== undefined) expect(star.read).toBe(false)
    },
  )

  it.each(NEW_COLLECTIONS.map((c) => [c] as const))(
    "[T-002.2] %s: no role other than member/admin has any permission",
    (collection) => {
      for (const [role, perms] of Object.entries(schemaOf(collection).permissions)) {
        if (role === 'member' || role === 'admin') continue
        expect(perms, `role '${role}' on ${collection}`).toMatchObject({
          read: false,
          create: false,
          update: false,
          delete: false,
        })
      }
    },
  )
})

// ---------------------------------------------------------------------------------------------
// T-002.3  drafts: owner / collaborator / stranger
// ---------------------------------------------------------------------------------------------

describe('T-002.3 drafts permissions (member = writer)', () => {
  const drafts = () => schemaOf('drafts')

  const own = rec(ALICE, { title: 'mine', body: 'x', collaborators: [] })
  const sharedWithAliceArray = rec(BOB, { title: 'bobs', body: 'x', collaborators: [ALICE] })
  // `collaborators` is a json column; the SDK accepts either an array or a JSON string.
  const sharedWithAliceJson = rec(BOB, { title: 'bobs', body: 'x', collaborators: JSON.stringify([ALICE]) })
  const privateOfBob = rec(BOB, { title: 'bobs', body: 'x', collaborators: [] })
  const privateOfBobWithOtherCollaborator = rec(BOB, { collaborators: [ADMIN_1] })
  const privateOfBobNoField = rec(BOB, { title: 'bobs', body: 'x' })
  const privateLookingPublic = rec(BOB, {
    collaborators: [],
    visibility: 'public',
    status: 'public',
    channel: 'public',
  })

  it('[T-002.3] member can create a draft', () => {
    expect(canCreate(drafts(), 'member')).toBe(true)
  })

  it('[T-002.3] member can read a draft they created', () => {
    expect(canRead(drafts(), 'member', own, ALICE)).toBe(true)
  })

  it('[T-002.3] member can update a draft they created', () => {
    expect(canUpdate(drafts(), 'member', own, ALICE)).toBe(true)
  })

  it('[T-002.3] member can read a draft where their id is in collaborators (array)', () => {
    expect(canRead(drafts(), 'member', sharedWithAliceArray, ALICE)).toBe(true)
  })

  it('[T-002.3] member can read a draft where their id is in collaborators (JSON string)', () => {
    expect(canRead(drafts(), 'member', sharedWithAliceJson, ALICE)).toBe(true)
  })

  it('[T-002.3] member can update a draft where their id is in collaborators', () => {
    expect(canUpdate(drafts(), 'member', sharedWithAliceArray, ALICE)).toBe(true)
    expect(canUpdate(drafts(), 'member', sharedWithAliceJson, ALICE)).toBe(true)
  })

  it("[T-002.3] member cannot read another member's draft with empty collaborators", () => {
    expect(canRead(drafts(), 'member', privateOfBob, ALICE)).toBe(false)
    expect(canRead(drafts(), 'member', privateOfBobNoField, ALICE)).toBe(false)
  })

  it('[T-002.3] member cannot read a draft whose collaborators list other users only', () => {
    expect(canRead(drafts(), 'member', privateOfBobWithOtherCollaborator, ALICE)).toBe(false)
  })

  it("[T-002.3] a 'public'-looking visibility value does not leak a private draft to another member", () => {
    expect(canRead(drafts(), 'member', privateLookingPublic, ALICE)).toBe(false)
    expect(canUpdate(drafts(), 'member', privateLookingPublic, ALICE)).toBe(false)
  })

  it("[T-002.3] member cannot update another member's draft with empty collaborators", () => {
    expect(canUpdate(drafts(), 'member', privateOfBob, ALICE)).toBe(false)
    expect(canUpdate(drafts(), 'member', privateOfBobNoField, ALICE)).toBe(false)
    expect(canUpdate(drafts(), 'member', privateOfBobWithOtherCollaborator, ALICE)).toBe(false)
  })

  it('[T-002.3] member can delete only their own draft', () => {
    expect(canDelete(drafts(), 'member', own, ALICE)).toBe(true)
    expect(canDelete(drafts(), 'member', privateOfBob, ALICE)).toBe(false)
  })

  it('[T-002.3] a collaborator cannot delete the draft they were shared on', () => {
    expect(canDelete(drafts(), 'member', sharedWithAliceArray, ALICE)).toBe(false)
    expect(canDelete(drafts(), 'member', sharedWithAliceJson, ALICE)).toBe(false)
  })

  it('[T-002.3] admin has full access to any draft', () => {
    expect(canCreate(drafts(), 'admin')).toBe(true)
    expect(canRead(drafts(), 'admin', privateOfBob, ADMIN_1)).toBe(true)
    expect(canUpdate(drafts(), 'admin', privateOfBob, ADMIN_1)).toBe(true)
    expect(canDelete(drafts(), 'admin', privateOfBob, ADMIN_1)).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------
// T-002.4  server-only collections: members cannot write
// ---------------------------------------------------------------------------------------------

describe('T-002.4 server-written collections refuse member writes', () => {
  for (const collection of SERVER_ONLY) {
    describe(collection, () => {
      const schema = () => schemaOf(collection)
      // Even a row the member "owns" (createdBy = member, reviewerId = member) must not be writable.
      const memberOwned = rec(ALICE, { reviewerId: ALICE, collaborators: [ALICE] })

      it(`[T-002.4] member cannot create ${collection}`, () => {
        expect(canCreate(schema(), 'member')).toBe(false)
      })

      it(`[T-002.4] member cannot update ${collection}, even a row they own`, () => {
        expect(canUpdate(schema(), 'member', memberOwned, ALICE)).toBe(false)
        expect(canUpdate(schema(), 'member', rec('server'), ALICE)).toBe(false)
      })

      it(`[T-002.4] member cannot delete ${collection}, even a row they own`, () => {
        expect(canDelete(schema(), 'member', memberOwned, ALICE)).toBe(false)
        expect(canDelete(schema(), 'member', rec('server'), ALICE)).toBe(false)
      })

      it(`[T-002.4] member can read ${collection} (SPEC §3: member read true)`, () => {
        expect(canRead(schema(), 'member', rec('server'), ALICE)).toBe(true)
      })

      it(`[T-002.4] admin can read ${collection} (the review room needs it)`, () => {
        expect(canRead(schema(), 'admin', rec('server'), ADMIN_1)).toBe(true)
      })
    })
  }
})

// ---------------------------------------------------------------------------------------------
// T-002.5  signoffs and uniqueness
// ---------------------------------------------------------------------------------------------

describe('T-002.5 signoffs gate and uniqueness', () => {
  const signoffs = () => schemaOf('signoffs')

  it('[T-002.5] admin can create a signoff', () => {
    expect(canCreate(signoffs(), 'admin')).toBe(true)
  })

  it('[T-002.5] uniqueOn is exactly [claimId, reviewerId]', () => {
    expect(signoffs().uniqueOn).toEqual(['claimId', 'reviewerId'])
  })

  it('[T-002.5] reviewerId is userBound and immutable (cannot be set to another user)', () => {
    const col = colOf('signoffs', 'reviewerId')
    expect(col.userBound).toBe(true)
    expect(col.immutable).toBe(true)
  })

  it('[T-002.5] reviewerId is the ownerField', () => {
    expect(signoffs().ownerField).toBe('reviewerId')
  })

  it('[T-002.5] an admin can update and delete their own signoff', () => {
    const mine = rec('server-or-whoever', { reviewerId: ADMIN_1 })
    expect(canUpdate(signoffs(), 'admin', mine, ADMIN_1)).toBe(true)
    expect(canDelete(signoffs(), 'admin', mine, ADMIN_1)).toBe(true)
  })

  it("[T-002.5] an admin cannot update or delete another admin's signoff", () => {
    const theirs = rec(ADMIN_2, { reviewerId: ADMIN_2 })
    expect(canUpdate(signoffs(), 'admin', theirs, ADMIN_1)).toBe(false)
    expect(canDelete(signoffs(), 'admin', theirs, ADMIN_1)).toBe(false)
  })

  it('[T-002.5] ownership of a signoff follows reviewerId, not the row creator', () => {
    // Row created by admin 2 but stamped for admin 1: admin 2 must not own it.
    const stamped = rec(ADMIN_2, { reviewerId: ADMIN_1 })
    expect(canUpdate(signoffs(), 'admin', stamped, ADMIN_2)).toBe(false)
    expect(canUpdate(signoffs(), 'admin', stamped, ADMIN_1)).toBe(true)
  })

  it('[T-002.5] admin can read every signoff', () => {
    expect(canRead(signoffs(), 'admin', rec(ADMIN_2, { reviewerId: ADMIN_2 }), ADMIN_1)).toBe(true)
  })

  it('[T-002.5] member can read signoffs (the badge needs them) but never write them', () => {
    const row = rec(ADMIN_1, { reviewerId: ADMIN_1 })
    expect(canRead(signoffs(), 'member', row, ALICE)).toBe(true)
    expect(canCreate(signoffs(), 'member')).toBe(false)
    expect(canUpdate(signoffs(), 'member', row, ALICE)).toBe(false)
    expect(canDelete(signoffs(), 'member', row, ALICE)).toBe(false)
  })

  it('[T-002.5] claims.uniqueOn is exactly [versionId, claimHash] (retry produces no duplicate claims)', () => {
    expect(schemaOf('claims').uniqueOn).toEqual(['versionId', 'claimHash'])
  })
})
