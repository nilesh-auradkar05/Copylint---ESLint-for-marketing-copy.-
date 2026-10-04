# ADR-0007: Drift detection by content hash and targeted, claim-level invalidation
- **Status:** Accepted · **Date:** 2026-10-03

## Context
Published content goes stale when the SDK changes. Re-checking everything daily wastes credits and creates noise.

## Decision
- A daily cron (`0 6 * * *` America/New_York) enqueues `sync-sources`.
- The job fetches each source `.md`, compares its sha256 with `sources.contentHash`, and re-ingests only changed pages.
- When anything changed, it bumps `kb_state.version`.
- For live publications whose claims cite a changed page:
  - mark the publication `stale`
  - create a `reverify` version
  - copy forward claims whose evidence pages didn't change; re-judge only the rest
- Admins can also trigger it manually ("Sync now" / cron "Run now").

## Consequences
- (+) Cost scales with change, not with content volume.
- (+) A stale flag is specific ("these 2 claims cite a changed page").
- (−) A claim whose *true* evidence lives on a page it didn't cite won't be re-checked. Acceptable, and documented.

## Revisit when
False "still supported" results are observed after releases.
