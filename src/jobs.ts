/**
 * Background-job handler — invoked by AppJobRoom (worker.ts) for every
 * job picked up from the queue. Dispatch on `job.type` and return a
 * result (captured as `job.result`) or throw to fail (retried up to
 * `maxAttempts`, then permanently marked failed).
 *
 * Use this for any work that needs to outlive the HTTP response:
 *   - AI generation that exceeds Cloudflare's 30-second waitUntil window
 *   - Export / render pipelines
 *   - Bulk imports, fan-out side effects
 *
 * Enqueue from a client with the `useJobs(roomId)` hook, or from
 * worker-side code (an HTTP route, an action, a cron task) with
 * `enqueueJob(env.JOB_ROOMS, \`app:${env.DEEPSPACE_APP_ID}\`, type, payload)`.
 *
 * Long-running progress / checkpoint guidance:
 *   - `ctx.progress(0..1, msg?)` publishes a real-time update over the
 *     room's WebSocket so subscribers see progress without polling.
 *   - `ctx.continue(state, { afterMs })` yields and resumes on the next
 *     alarm with `job.resumeFrom = state` — use this for work that
 *     exceeds the 15-minute per-alarm wall-time ceiling.
 *   - `ctx.signal` is an AbortSignal that fires when a client cancels;
 *     forward it to `fetch` and check `.aborted` at loop suspension
 *     points.
 *
 * Example:
 *
 *   export async function runJob(job: Job, ctx: JobContext, env: Env) {
 *     switch (job.type) {
 *       case 'ai-summarize': {
 *         const { text } = job.payload as { text: string }
 *         ctx.progress(0.1, 'starting')
 *         const summary = await summarize(text, { signal: ctx.signal })
 *         return { summary }
 *       }
 *       default:
 *         throw new Error(`Unknown job type: ${job.type}`)
 *     }
 *   }
 */

import { knowledge } from 'deepspace/worker'
import type { Job, JobContext } from 'deepspace/worker'
import { SyncJobPayload } from './engine/contracts'
import { syncSources } from './engine/sync'
import { createActionTools } from './server/action-routes'
import type { Env } from '../worker'

// `env` is `unknown` at this boundary (AppJobRoom hands over its Env); handlers narrow it when needed.
export async function runJob(job: Job, ctx: JobContext, rawEnv: unknown): Promise<unknown> {
  switch (job.type) {
    case 'sync-sources': {
      const env = rawEnv as Env
      const payload = SyncJobPayload.parse(job.payload ?? {})
      return await syncSources(
        {
          // Wrapped: a bare `fetch` called as a method of another object throws in Workers.
          fetch: (input, init) => fetch(input, init),
          kb: knowledge(env),
          // Jobs act as the app owner; RBAC is off for action tools, the server-side job is the boundary.
          records: createActionTools(env, env.OWNER_USER_ID, env.APP_OWNER_JWT),
          signal: ctx.signal,
        },
        payload,
      )
    }
    default:
      throw new Error(`Unknown job type: ${job.type}`)
  }
}
