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
