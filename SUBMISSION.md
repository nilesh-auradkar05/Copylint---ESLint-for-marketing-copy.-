# Submission note — CopyLint (Groundtruth)

**Live URL:** https://copylint.app.space
**Repository:** https://github.com/nilesh-auradkar05/Copylint---ESLint-for-marketing-copy.-
**Demo accounts:** [YOU: writer and engineer accounts, or "sign up; the owner promotes you on /admin/users"]

> Draft assembled by the Lane A orchestrator on Oct 5 from `docs/VERIFICATION-LOG.md`, `TASKS.md` and the ADRs.
> Lines marked [YOU: …] need the author. Everything else is traceable to a log line or a file; delete this note before submitting.

## What I built (≤ 5 sentences)
CopyLint checks the technical claims in developer marketing content against DeepSpace's own docs before they ship.
A writer pastes a draft; a background job extracts atomic claims and retrieves evidence from a managed knowledge base of
25 curated docs pages. A judge model marks each claim supported, contradicted or unsupported, with citations and a suggested fix,
and the claim cards appear live for everyone on the draft. An engineer signs off on whatever is not supported, and publishing
is refused server-side until every claim is clear. Detecting docs changes after publication (drift) was designed (ADR-0007) but is not shipped.

## DeepSpace integrations used — and why
| Primitive | Where it shows up |
|---|---|
| Auth + built-in RBAC | Seven collections with server-side permissions; writers cannot create claims, versions, publications or sign-offs; `/admin/users` promotes a writer to engineer and back |
| Records + real-time sync | Claim cards, sign-offs and the ship-ready badge update in every open browser without reload (`tests/t015-two-user.spec.ts`) |
| Background jobs | `verify-draft` (extract, retrieve, judge, write, retry-safe) and `sync-sources` (hash and re-ingest docs pages), with live progress on the draft page |
| Managed knowledge (AI Search) | Evidence retrieval over the curated docs, top 5 chunks per claim |
| AI proxy (`createDeepSpaceAI`) | `claude-haiku-4-5` extracts claims, `claude-sonnet-5` judges each one; both ids live only in `src/engine/config.ts` |
| Server actions | `publishDraft` recomputes the ship-ready gate from stored rows and trusts no client flag |

Planned in ADR-0008 but **not shipped**: Cron (`docs-drift`) and the Resend stale alert.

## Deliberately not used
| Primitive | Why not |
|---|---|
| Payments | Internal tool; nothing to charge for |
| LiveKit | No media |
| Google OAuth / Drive import | Paste covers the core path; import adds per-user consent flows |
| Yjs collaborative editing | Checks run on immutable snapshots (ADR-0002); co-editing would blur what was verified |
| Exa / Tavily web search | Unversioned evidence (ADR-0001, the main tradeoff below) |
| Messaging channels | Review comments live on sign-off notes; a chat adds noise |
| Presence | Stretch; cut (T-017) |
| Client integration proxy for owner-billed integrations | Closed in the T-023 pass: it let signed-out callers spend the owner's credits, and the app's own model calls never needed it |

## Main tradeoff
Curated, versioned docs are the only source of truth (ADR-0001). Every verdict cites a page the team controls and is
reproducible against a known docs version, and a docs change is a hash compare. The price is recall: a claim the 25 pages
do not address ("faster than Firebase", "300 edge locations") is `unsupported` and goes to an engineer instead of being checked.
The size of that effect is **not measured**: the golden-set runner (T-007) was not built, so there is no precision, recall or
unsupported-rate number to report. A labelled set exists (`eval/golden-claims.jsonl`, 28 claims; `Dataset/`, 122 claims and
20 retrieval probes) and is the first thing to run next. [YOU: if you ran the benchmark from commit e14c25a by hand, put the numbers here.]

## What the agents did
- **Two harnesses in parallel worktrees.** Claude Code ran Lane A (schemas, RBAC, engine, jobs, routes, actions); Codex ran Lane B
  (app shell, drafts, the fixture review room: T-010, T-010b, T-011). Lane A then finished Lane B's remaining rows
  (T-011b, T-012, T-013, T-015, T-016) at the author's request. Rules for both are in `AGENTS.md`.
- **A fixed loop per task:** a test-author subagent writes failing tests from the SPEC before any implementation exists, an
  implementer makes them pass without editing tests, the orchestrator runs type-check, lint, unit and runtime suites, and a
  read-only reviewer checks the diff against the SPEC, ADRs and a nine-line security checklist.
- **Numbers at submission:** 706 unit tests in 27 files; 36 runtime tests passing against a local server plus a 3-test two-user
  spec; 23 entries in the verification log; two tasks needed a second review pass (T-004 after a CHANGES REQUIRED, T-005);
  no test disputes were raised.
- **What the reviewer caught that tests did not:** in the final security pass it found the scaffold's integration proxy
  forwarding signed-out callers upstream on the owner's credentials. Confirmed on the deployed app without spending anything,
  pinned with 8 tests, fixed the same hour.
- **Where the loop was skipped, on purpose:** the draft page's live wiring (T-011b) was written directly by the orchestrator
  under time pressure, with no test-author or reviewer; it has no page tests. This is in the log.
- **Board at submission:** 2 tasks DONE, 13 in REVIEW (code merged and reviewed, live verification incomplete), 1 cut,
  the rest not started (T-007 eval, T-020 drift, T-021 alert, T-024 hosted page).

## What I verified or changed myself
From the `[human]` lines in the log; [YOU: correct or extend, this section should be in your words]
- Ran the first deploy with GitHub as the source of record, and every deploy after it.
- On the deployed app: opened drafts, ran *Check claims* on the sample launch thread and saw claims with verdicts, the blocked
  count, live progress and re-check behave as expected (first real paid check).
- On the deployed app: ran the first docs sync from the Sources page.
- On the deployed app: opened `/publications` and `/admin/users` as the owner; cards, *Make engineer* and *Make writer* work.
- Promoted the engineer test account for the local RBAC matrix run (28 of 28).
- Built the golden claim sets and retrieval probes (`Dataset/`).
- Decisions: let Lane A take over the sign-off and fix-and-publish tasks; asked for the publication cards and role revert after
  trying the first version; chose to document rather than change the member-read limitation below.
- [YOU: anything you fixed by hand in Cursor, and why]

**Not verified on the deployed app by anyone:** the signed-in refusals (member 403 on sync, 429 over quota, 413), the RBAC
matrix and the forged sign-off test. They pass against a local server only.

## Cost
About $0.07 per check: the mean of five real checks ($0.02 to $0.10), read from the platform usage log. Those drafts
produced about two claims each; a draft at the 25-claim cap was not measured and would cost several times more. Each user is
limited to 20 checks per day.

## Unfinished / next
In order of value:
1. **Docs drift (T-020).** The headline "re-lint when the docs change" is not shipped; see below.
2. **Golden-set eval (T-007).** No measured judge quality yet.
3. **Restrict checked drafts to their owner and collaborators.** See below.
4. **Live verification of the signed-in security paths** on the deployed app.
5. Hosted public page for a publication (T-024); today Publish only records an external URL.

Known limitations found in the T-023 security pass (Oct 5), stated rather than fixed:
- **Checked drafts are readable by every signed-in member.** `draft_versions` and `claims` are `member read: true`, and each version row stores the full draft body, so a member who is not a collaborator can still read any draft that has been checked (the `drafts` collection itself is owner and collaborators only). Decided on Oct 5 to document this instead of changing RBAC hours before the deadline. The fix is to make versions and claims readable only by the draft's owner and collaborators.
- **Docs drift is not shipped.** `src/cron.ts` declares no tasks (T-020 not started), so nothing re-hashes the docs on a schedule and no publication is ever flagged stale; the Stale state on `/publications` and the cron row on `/admin/sources` have no data behind them. *Sync now* re-ingests changed pages but does not re-verify publications.
- **Role changes give no feedback on refusal.** `setRole` is fire-and-forget; the role word on `/admin/users` only changes when the user list updates.
