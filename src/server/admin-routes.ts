/**
 * Admin-only paid triggers. Auth and role are resolved server-side on every call; the job type and
 * payload are fixed here, never taken from the request.
 */

import type { Hono } from 'hono'
import type { AppContext, Env } from '../../worker.js'

export interface AdminRouteDeps {
  resolveAuth: (req: Request, env: Env) => Promise<{ userId: string } | null>
  resolveRole: (env: Env, userId: string) => Promise<string | null>
  enqueue: (
    env: Env,
    type: string,
    payload: unknown,
    options: { enqueuedBy: string },
  ) => Promise<string>
}

export function registerAdminRoutes(app: Hono<AppContext>, deps: AdminRouteDeps): void {
  app.post('/api/admin/sync', async (c) => {
    const auth = await deps.resolveAuth(c.req.raw, c.env)
    if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    if ((await deps.resolveRole(c.env, auth.userId)) !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403)
    }
    const jobId = await deps.enqueue(c.env, 'sync-sources', { reverify: true }, { enqueuedBy: auth.userId })
    return c.json({ jobId }, 202)
  })
}
