# Sprint review log

Filled by the orchestrators and the human at the end of each sprint.
This is the raw material for `SUBMISSION.md` ("what the agent did, what I verified").

Template per sprint:
```
## S<n> — <name> · <date>
Goal met? yes / partly / no
Exit criteria: <each: met/not met + evidence (link, log line, test name)>
Done: T-…
Carried over: T-… (why)
Cut: T-… (why, which cut-line step)
Live URL check: <what was tried, signed-in as whom, result>
Metrics: probe hit-rate · golden P/R (contradicted) · p50 check time · $/check · credits used today
Agent performance:
  - What agents did well:
  - Where I had to intervene (takeover / rejected diff / test dispute) and why:
  - Reviewer BLOCKERs that were real:
Surprises / SPEC corrections (§11 updates):
Next sprint changes:
```

---

## S0 — Setup · 2026-10-03
Goal met? _
Exit criteria: _
...

## S1 — Engine · 2026-10-03
_

## S2 — Review loop · 2026-10-04
_

## S3 — Drift + ship · 2026-10-05
_

### Lane B · T-011 fixture review

Orchestrator/reviewer verdict: **APPROVE fixture slice**, no open code BLOCKERs. Not approved as a live feature or for task completion. Separate `gpt-6.1-sol/high` test-author wrote 14 RED tests before the implementer; implementation consumes canonical snapshot/spans/gate contracts. Read-only review covered the diff against main and ADRs 0002/0003/0004/0005. Snapshot ID prefix replaces the unavailable ordinal; T-011b will handle live version selection.

Verification after rebase onto main `fb11d1d`: type-check/lint clean; 517 unit tests pass. Runtime: 34 passed, 4 failed solely at `expectAdmin` (Engineer is member in Lane B local state), 1 intentional paid-sync skip. No paid sync run. Manual fixture browser checks: 1440px/390px, light/dark, Enter/Space bidirectional focus, reduced motion, no overflow or app console errors. One review correction disabled highlight navigation while loading; focused tests and browser confirmed it. The implementer applied that correction before hitting its usage limit; the orchestrator verified and committed its edits without changing tests.

AGENTS §6 checklist, scoped to this UI-only diff (not a deployed security audit):
- [x] No collection/column permissions changed; no new public reads.
- [x] Server-only collection create permissions untouched; no writes introduced.
- [x] Signoff RBAC/userBound/immutable/uniqueOn untouched; no signoff write controls introduced. Local admin runtime verification remains blocked as above.
- [x] No publish action changes or client ship-ready flag; badge consumes canonical gate.
- [x] No model calls/prompts changed; draft/evidence HTML renders literally. Pipeline injection verification is outside this slice.
- [x] Citation validation unchanged; UI renders supplied evidence and links to the configured docs origin.
- [x] No paid check route/enqueue added; auth/quota/body-limit runtime verification belongs to T-006/T-011b.
- [x] No users queries, actions, or routes added; no raw user rows exposed.
- [x] No secrets, tokens, `.dev.vars`, or Lane A-owned product files in the diff.

Carry-over: T-011b check HTTP/errors, version-scoped job progress and two-browser streaming; T-012 signoff writes; T-013 accept-fix. T-011 remains REVIEW and unmerged; deployed smoke is outstanding.
