# todo.md — live working list (Mon Oct 5, 8:45 PM ET)

Short-horizon checklist for the human and both orchestrators. `TASKS.md` is the backlog; this is "right now".
Update at the start and end of every session. Keep it under one screen.

## Now
- [ ] Human: fast-forward `main` to `lane-a` and push (`git -C ../copylint merge --ff-only lane-a && git -C ../copylint push`)
- [x] Human: first `npx deepspace deploy` from the primary checkout (T-001), done Oct 5. Unblocks the knowledge binding and every live check below
- [x] Admin test user: `Engineer` promoted locally via `/api/debug/set-role` (per worktree; lane-b and the deployed app need their own)
- [ ] Human DECISION (RBAC, blocks nothing but is a privacy hole): `draft_versions` and `claims` are `member read:true` and the check route stores the full draft body on the version, so any member can read every checked draft over the socket. Options: drop `body` from versions, or make versions/claims readable only by the draft's owner and collaborators
- [ ] Human: run the FIRST real sync from the deployed app, not local dev (they share one knowledge base but not the `sources` table: syncing from both duplicates every page)

## Next up
- T-016 follow-up merged to `lane-a` (9:20 PM): publication cards with entrance animation, *Make writer* on `/admin/users` (not on your own row). Human: redeploy, then look at `/publications` in light and dark; nobody has seen the cards in a browser
- Lane B backlog closed out by Lane A (8:45 PM): T-016.2 `/publications`, T-016.4 `/admin/users` (*Make engineer*), T-015 two-user spec are merged to `lane-a`. Human before deploy: open `/publications` and `/admin/users` once as an admin and once as a member (never seen in a browser), then promote the deployed app's engineer account from `/admin/users`
- Still open on Lane B rows: T-016.3 cron row + *Run now* (needs T-020's `docs-drift` task; `src/cron.ts` is empty); T-017 presence is CUT; `setRole` gives no feedback if the server refuses
- Do NOT merge `t/T-012-signoff-ui` (gt-lane-b, 7 commits): superseded by `SignoffPanel` on lane-a. gt-lane-b also has uncommitted doc edits (TASKS, todo, sprint docs, VERIFICATION-LOG) that nobody has reconciled
- Lane B STOP on T-012: Lane A shipped it (`src/components/SignoffPanel.tsx`, wired in `drafts/[id].tsx`) with human approval. `t/T-012-signoff-ui` and the uncommitted `SignoffReviewRoom.tsx` in gt-lane-b will conflict; do not merge them. The draft page also has an inline Publish form (T-016 modal and `/publications` still open)
- Lane A: T-005, T-006, T-014 merged to lane-a (all REVIEW: live checks pending) → T-020 (next; not started) → T-023. T-007 eval needs T-005 live
- Lane B note (T-016): `publishDraft` returns `{success:true, data:{ok:true, publicationId}}`, or `{success:true, data:{ok:false, reason:'not_ship_ready', blocking:[claimIds]}}`, or `{success:false, code, error}`. Params `{draftId, versionId, url}`, url http(s) only. Only the draft owner or a collaborator may publish; an admin who is neither is refused, so do not show them Publish
- Lane B note (T-011b): draft links 404'd because `/drafts/:id` had no page. Lane A added a thin adapter, `src/pages/(app)/(protected)/drafts/[id].tsx` (live queries → `ReviewRoom`, *Check claims* POSTs the route with a Bearer token, inline error). T-011b is unblocked (T-005/T-006 are on main): build on that file; still missing are `useJobs` progress, per-status copy, tests, and the two-browser check
- Lane B note (T-011.3): `POST /api/drafts/:id/check` answers `202 {jobId, versionId}` (new or still running), `200 {versionId, cached:true}`, `401`, `403`, `404`, `413`, `429` (daily limit OR a failed check retried within 5 min; read `error`), `500`, `503` (storage). Send no body
- Lane B: T-011 fixture APPROVE on `t/T-011-review-room`; 517 unit pass, type-check/lint clean; light/dark + mobile + keyboard browser smoke pass. T-011b live route/check/progress/sync waits for T-005/T-006.
- Lane B runtime after rebase: 34 pass / 4 failures because local `Engineer` is member, not admin / 1 paid-sync skip. Human must provision the local admin role before the full suite can pass. Port 5174.
- Lane B: T-010b is on local main; deploy/live smoke still pending. T-011 remains unmerged pending live integration.
- Lane B: authentication and 4 usable test accounts confirmed; T-002/T-003 contracts and review-room fixture are available.
- Lane B note: `AppJobRoom` socket is now admin-write / member-read. Members enqueue only via the check route (T-006)

## Waiting on the human, after first deploy (T-004)
- T-004.1 `[[ai_search]]` provisions; `npx deepspace app usage` before/after the first sync
    - Requests: 405, Errors: 0, Subrequests: 485, CPU p50/p99: 20947.0 ms
    - Plan:     free
      Credits:  487 of 500 remaining (100 credits = $1)

      Usage by integration (last 30 days):
      INTEGRATION  CALLS  COST
      anthropic    30     $0.12

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
