# ADR-0005: Checks run as a background job, enqueued only by an authenticated, quota-checked HTTP route
- **Status:** Accepted · **Date:** 2026-10-03

## Context
A check makes up to ~26 model calls and up to 25 knowledge searches, all owner-billed. That takes 30–90 s, longer than a request should wait. `ctx.waitUntil` is killed 30 s after the response. The platform does not rate-limit non-Google integrations.

## Decision
- `POST /api/drafts/:id/check` validates, enforces 20 checks per user per day, snapshots the version, and calls `enqueueJob(... 'verify-draft' ...)`.
- `AppJobRoom.authorizeWrite` is admin-only, so members cannot enqueue, cancel, or retry over the socket.
- Members watch progress read-only via `useJobs`.

## Consequences
- (+) Live progress.
- (+) Durable retries.
- (+) Spend is bounded per user.
- (+) Matches the docs' "public producer goes through HTTP" pattern.
- (−) Writers can't cancel a running check (acceptable; it's short).

## Revisit when
Checks routinely exceed 15 minutes (use `backgroundJobTypes`), or writers need cancel.
