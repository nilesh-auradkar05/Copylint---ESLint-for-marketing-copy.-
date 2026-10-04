# Sprint plan — Groundtruth

**Window:** Sat Oct 3 → Mon Oct 5, 2026. **Deadline:** Mon 11:59 PM ET. **Code freeze:** Mon 6:00 PM ET.

This replaces the 5-day plan drawn earlier. We start Saturday, so there are three day-long sprints.

**Principle:** every sprint ends with the important path more complete **on the live URL**, not on localhost.

## Sprint goals

| Sprint | When (ET) | Goal | Exit criteria (all must be true) |
|---|---|---|---|
| **S0 — Setup** | Sat, first 90 min | Repo, scaffold, GitHub source authority, first deploy | `groundtruth.app.space` serves the scaffold. `npx deepspace app source` = GitHub. Both worktrees run `dev start` on different ports. |
| **S1 — Engine** | Sat (rest of day) | A real draft gets real verdicts with citations | Lane A: schemas+RBAC live; 25 docs indexed; probe-query hit-rate ≥ 8/10; `verify-draft` job writes claims for `seed/launch-thread.md`; check route has quota. Lane B: app shell + review room render from fixture data with correct highlighting. |
| **S2 — Review loop** | Sun Oct 4 | Two people can take a draft from check to ship-ready to published | Live review room on real data; admin sign-off; accept-fix → new version; `publishDraft` gate; two-user Playwright spec green; golden-set eval run #1–#2 logged; drift sync job works via "Sync now". |
| **S3 — Drift + ship** | Mon Oct 5, until 6 PM | Drift visible end to end; app polished, documented, submitted | Cron armed and "Run now" works; a changed-page fixture marks a publication stale and re-verifies only affected claims; security pass done; README + SUBMISSION + VERIFICATION-LOG complete; final deploy smoke-tested signed-in on a fresh account. |

## Lane schedule

| Day | Lane A (Claude Code) | Lane B (Codex) | Human (Cursor + browser) |
|---|---|---|---|
| Sat | T-001 · T-002 · T-003 · T-004 · T-005 · T-006 | T-010 · T-011 (fixtures) | T-001 auth and GitHub remote; review RBAC matrix; run probe queries; write the first VERIFICATION-LOG lines |
| Sun | T-007 (eval + prompt iteration) · T-014 · T-020 | T-011 (live) · T-012 · T-013 · T-015 · T-016 | Two-browser manual test; label disputes on the golden set; spend check |
| Mon | T-023 · T-021 (if green by noon) | T-017 (stretch) · design gate pass | T-022: seed, README, SUBMISSION, final deploy, smoke, submit |

## Cut line (apply in this order; decided now so nobody debates it at 4 PM Monday)

1. **T-021** Resend stale alert. The UI stale banner is enough.
2. **T-017** Presence on claims.
3. **T-020 cron schedule.** Keep the manual "Sync now", which runs the same job. Drift still demos.
4. **Claim-level carry-forward** in reverify. Re-judge the whole draft instead (ADR-0007 fallback).
5. **`/publications` page.** Show stale state on the draft list badge instead.

**Never cut:**
- check job
- cited evidence
- sign-off gate (`publishDraft`)
- RBAC
- live deploy
- VERIFICATION-LOG

## Risk register

| Risk | Likelihood | Impact | Early signal | Mitigation |
|---|---|---|---|---|
| Knowledge indexing slow or search results poorly chunked | M | H | Probe hit-rate < 8/10 on Sat | Upload per-section files (split on `##`) instead of whole pages; raise `limit` to 8 |
| Records API unavailable inside job handler | M | H | T-005 [CHECK] fails | Do writes via a server action called from the job, or via `buildCronContext` |
| Judge over-calls "supported" | M | H | Precision OK but contradicted recall < 0.85 | Tighten the prompt with 2 contrastive examples; raise chunk count; log every miss in VERIFICATION-LOG |
| Two lanes conflict on shared files | M | M | Rebase conflicts in `src/schemas` | Lane A owns contracts; Lane B uses `CONTRACT-CHANGE` requests |
| Credits run out mid-build | L | H | `app usage` daily | Cap eval runs at 3; `checksPerUserPerDay` applies to us too |
| Source authority latched to DeepSpace by accident | L | H | `app source` ≠ GitHub | Remote set before first deploy; never `deepspace push` |
| Out of time | M | H | S2 exit criteria not met by Sun 10 PM | Apply the cut line immediately; Monday is ship-only |

## Ceremonies (kept small)

- **Sprint start:** orchestrators read `todo.md` and their `TASKS.md` rows.
- **Mid-sprint (~every 3 h):** human reviews `VERIFICATION-LOG.md` and merges, and tries the live URL.
- **Sprint end:** fill the sprint's section in `docs/sprint-review.md`, check `npx deepspace app usage`, and re-plan the next sprint's rows.
