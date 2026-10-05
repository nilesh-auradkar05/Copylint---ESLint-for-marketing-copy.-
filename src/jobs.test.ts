import { describe, expect, it } from 'vitest'
import type { Job, JobContext } from 'deepspace/worker'
import { runJob } from './jobs'

function job(type: string): Job {
  return {
    id: 'job-1',
    type,
    status: 'running',
    payload: {},
    attempts: 1,
    maxAttempts: 2,
    enqueuedAt: '2026-10-04T00:00:00.000Z',
  }
}

const ctx: JobContext = {
  progress: () => undefined,
  continue: () => undefined,
  signal: new AbortController().signal,
} as unknown as JobContext

describe('runJob dispatch', () => {
  it('[T-004.2] throws on an unknown job type and names the type in the error', async () => {
    await expect(runJob(job('definitely-not-a-job'), ctx, {})).rejects.toThrow(/definitely-not-a-job/)
  })
})
