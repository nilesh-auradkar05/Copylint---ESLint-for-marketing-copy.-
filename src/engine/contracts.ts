import { z } from 'zod'

export const ClaimKind = z.enum([
  'capability',
  'limit',
  'number',
  'default',
  'security',
  'pricing',
  'deployment',
  'comparison',
])
export type ClaimKind = z.infer<typeof ClaimKind>

export const ExtractOut = z.object({
  claims: z
    .array(
      z.object({
        text: z.string().min(8).max(300), // standalone, pronouns resolved
        quote: z.string().min(3).max(400), // exact substring of the draft
        kind: ClaimKind,
      }),
    )
    .max(40),
})

export const Verdict = z.enum(['supported', 'contradicted', 'unsupported'])
export type Verdict = z.infer<typeof Verdict>

export const JudgeOut = z.object({
  verdict: Verdict,
  citedChunkIds: z.array(z.string()).max(5),
  reason: z.string().max(400),
  fix: z.string().max(240).nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
})
export type JudgeOut = z.infer<typeof JudgeOut>

export const Evidence = z.object({
  chunkId: z.string(),
  page: z.string(),
  excerpt: z.string().max(300),
})
export type Evidence = z.infer<typeof Evidence>

// Body comes from the stored draft, not the request.
export const CheckRequest = z.object({}).strict()

export const PublishRequest = z.object({
  draftId: z.string(),
  versionId: z.string(),
  url: z.string().url().max(500),
})

// Flattened record shapes (id + record.data) consumed by the gate and the UI.
// `fix` and `carriedFrom` are "not required" text columns: null, '' and missing all mean "none".
export type Claim = {
  id: string
  versionId: string
  draftId: string
  claimHash: string
  text: string
  quote: string
  span: [number, number]
  kind: ClaimKind
  verdict: Verdict
  confidence: JudgeOut['confidence']
  evidence: Evidence[]
  reason: string
  fix?: string | null
  carriedFrom?: string | null
}

export type Version = {
  id: string
  draftId: string
  body: string
  bodyHash: string
  kbVersion: number
  status: 'checking' | 'checked' | 'failed'
  requestedBy: string
  requestedAt: string
  mode: 'full' | 'reverify'
  jobId: string
}

export type Signoff = {
  id: string
  claimId: string
  versionId: string
  reviewerId: string
  decision: 'approve' | 'cut'
  note: string
}

/** Payload of the `sync-sources` job (enqueued by the admin route and the drift cron). */
export const SyncJobPayload = z.object({ reverify: z.boolean().optional() }).strict()
export type SyncJobPayload = z.infer<typeof SyncJobPayload>

/** Payload of the `verify-draft` job. No draft text: the body is read from the frozen version row. */
export const VerifyJobPayload = z
  .object({
    draftId: z.string(),
    versionId: z.string(),
    mode: z.enum(['full', 'reverify']),
    previousVersionId: z.string().optional(),
    changedPages: z.array(z.string()).optional(),
  })
  .strict()
export type VerifyJobPayload = z.infer<typeof VerifyJobPayload>
