# todo.md — live working list (Mon Oct 5, 1:25 PM ET)

Short-horizon checklist for the human and both orchestrators. `TASKS.md` is the backlog; this is "right now".
Update at the start and end of every session. Keep it under one screen.

## Now
- [ ] Human: fast-forward `main` to `lane-a` and push (`git -C ../copylint merge --ff-only lane-a && git -C ../copylint push`)
- [ ] Human: first `npx deepspace deploy` from the primary checkout (T-001). Unblocks the knowledge binding and every live check below
- [x] Admin test user: `Engineer` promoted locally via `/api/debug/set-role` (per worktree; lane-b and the deployed app need their own)
- [ ] Human DECISION (RBAC, blocks nothing but is a privacy hole): `draft_versions` and `claims` are `member read:true` and the check route stores the full draft body on the version, so any member can read every checked draft over the socket. Options: drop `body` from versions, or make versions/claims readable only by the draft's owner and collaborators
- [ ] Human: run the FIRST real sync from the deployed app, not local dev (they share one knowledge base but not the `sources` table: syncing from both duplicates every page)

## Next up
- Lane A: T-005 and T-006 merged to lane-a (both REVIEW: live paid check pending) → T-014 (READY) → T-020 → T-023. T-007 eval needs T-005 live
- Lane B note (T-011.3): `POST /api/drafts/:id/check` answers `202 {jobId, versionId}` (new or still running), `200 {versionId, cached:true}`, `401`, `403`, `404`, `413`, `429` (daily limit OR a failed check retried within 5 min; read `error`), `500`, `503` (storage). Send no body
- Lane B: T-010b reviewer APPROVE; 503 unit tests and 16 browser tests pass (21 existing skips). Merge/deploy/live smoke next, then T-011. Lane B tests use port 5174.
- Lane B: authentication and 4 usable test accounts confirmed; T-002/T-003 contracts and review-room fixture are available.
- Lane B note: `AppJobRoom` socket is now admin-write / member-read. Members enqueue only via the check route (T-006)

## Waiting on the human, after first deploy (T-004)
- T-004.1 `[[ai_search]]` provisions; `npx deepspace app usage` before/after the first sync
- T-004.2 click *Sync now* as owner: 25 sources `completed`, `kb_state.version` 1; second sync = 0 adds
- T-004.6 run `eval/probes.json`, log hit-rate. Check `chunk.filename` is the bare `concepts__permissions.md`; if it is folder-prefixed, `retrieve` drops every chunk
- Does a same-name re-upload replace the item or add a second one? Does `kb.remove` of a missing id 404?
- T-002 live RBAC: 28/28 on the local server; smoke it once on the deployed app

## Known gaps carried forward
- `sync.ts` assumes one kb item per page (no guard); a bump-write failure on the success path loses the bump
- Old kb items are removed before the new ones are indexed (page briefly unsearchable) — decide in T-020
- No per-user quota on admin-only `/api/admin/sync`
- Check route: quota count and write are not atomic (parallel POSTs on different drafts can exceed 20 by the number in flight); two concurrent POSTs for a new version can both enqueue; a `checking` version is treated as dead after 30 min
- `verify-draft`: extraction re-runs on a retry, so rows from an earlier attempt may not match the later extraction (cap of 25 still holds); `reverify` mode throws until T-020; a `checked` re-run reports `dropped: 0`

## Behind plan
- S1 code is merged; its live checks (T-004, T-005, T-006) all wait on the first deploy. Freeze is Mon 6:00 PM ET. Cut line in `docs/sprint-plan.md` will apply

## End-of-day checks
- [ ] Live URL tried signed-in
- [ ] `npx deepspace app usage` noted in VERIFICATION-LOG
- [ ] docs/sprint-review.md section filled
