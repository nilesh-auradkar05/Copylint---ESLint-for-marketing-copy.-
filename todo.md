# todo.md — live working list (Sun Oct 4, 9:05 PM ET)

Short-horizon checklist for the human and both orchestrators. `TASKS.md` is the backlog; this is "right now".
Update at the start and end of every session. Keep it under one screen.

## Now
- [ ] Human: fast-forward `main` to `lane-a` and push (`git -C ../copylint merge --ff-only lane-a && git -C ../copylint push`)
- [ ] Human: first `npx deepspace deploy` from the primary checkout (T-001). Unblocks the knowledge binding and every live check below
- [ ] Human: decide how tests get an **admin** user (SPEC §11 correction 8). Blocks T-002.5, T-004.5 admin-202

## Next up
- Lane A: T-005 (READY) → T-006 → T-014 → T-020 → T-023. T-007 eval needs T-005 live
- Lane B: T-010b reviewer APPROVE; 503 unit tests and 16 browser tests pass (21 existing skips). Merge/deploy/live smoke next, then T-011. Lane B tests use port 5174.
- Lane B: authentication and 4 usable test accounts confirmed; T-002/T-003 contracts and review-room fixture are available.
- Lane B note: `AppJobRoom` socket is now admin-write / member-read. Members enqueue only via the check route (T-006)

## Waiting on the human, after first deploy (T-004)
- T-004.1 `[[ai_search]]` provisions; `npx deepspace app usage` before/after the first sync
- T-004.2 click *Sync now* as owner: 25 sources `completed`, `kb_state.version` 1; second sync = 0 adds
- T-004.6 run `eval/probes.json`, log hit-rate. Check `chunk.filename` is the bare `concepts__permissions.md`; if it is folder-prefixed, `retrieve` drops every chunk
- Does a same-name re-upload replace the item or add a second one? Does `kb.remove` of a missing id 404?
- T-002 live RBAC matrix (21 Playwright cases still `fixme`)

## Known gaps carried forward
- `sync.ts` assumes one kb item per page (no guard); a bump-write failure on the success path loses the bump
- Old kb items are removed before the new ones are indexed (page briefly unsearchable) — decide in T-020
- No per-user quota on admin-only `/api/admin/sync`

## Behind plan
- S1 (due Sat) still open: T-005, T-006. Freeze is Mon 6:00 PM ET. Cut line in `docs/sprint-plan.md` will apply

## End-of-day checks
- [ ] Live URL tried signed-in
- [ ] `npx deepspace app usage` noted in VERIFICATION-LOG
- [ ] docs/sprint-review.md section filled
