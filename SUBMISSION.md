# Submission note — Groundtruth (fill on Mon Oct 5)

**Live URL:** https://groundtruth.app.space
**Repository:** https://github.com/<you>/groundtruth
**Demo accounts:** writer `…` / engineer `…` (or: sign up; the owner promotes you)

## What I built (≤ 5 sentences)
Groundtruth checks the technical claims in developer marketing content against DeepSpace's own docs before they ship.
A writer pastes a draft. A background job extracts claims and retrieves evidence from a managed knowledge base of
~25 docs pages. A judge model marks each claim supported, contradicted, or unsupported, with citations and a suggested fix.
An engineer signs off on the rest, and publishing is refused server-side until every claim is clear.
A daily job re-hashes the docs and flags published posts whose cited pages changed.

## DeepSpace integrations used — and why
<from ADR-0008, one line each, with where it shows up in the product>

## Deliberately not used
<from ADR-0008>

## Main tradeoff
Curated, versioned docs as the only source of truth (ADR-0001): <1 paragraph + the measured effect, e.g. unsupported rate on golden set>.

## What the agents did
<from VERIFICATION-LOG: harnesses, roles, test-first rule, numbers: tasks, tests, review loops, disputes>

## What I verified or changed myself
<the [human] and [takeover] lines: RBAC matrix, forged-write tests, probe queries, golden labels, eval results, security pass, cost per check, fixes I made by hand and why>

## Unfinished / next
<honest list, ordered by value>

Known limitations found in the T-023 security pass (Oct 5), stated rather than fixed:
- **Checked drafts are readable by every signed-in member.** `draft_versions` and `claims` are `member read: true`, and each version row stores the full draft body, so a member who is not a collaborator can still read any draft that has been checked (the `drafts` collection itself is owner and collaborators only). Decided on Oct 5 to document this instead of changing RBAC hours before the deadline. The fix is to make versions and claims readable only by the draft's owner and collaborators.
- **Docs drift is not shipped.** `src/cron.ts` declares no tasks (T-020 not started), so nothing re-hashes the docs on a schedule and no publication is ever flagged stale; the Stale state on `/publications` and the cron row on `/admin/sources` have no data behind them. *Sync now* re-ingests changed pages but does not re-verify publications.
- **Role changes give no feedback on refusal.** `setRole` is fire-and-forget; the role word on `/admin/users` only changes when the user list updates.
