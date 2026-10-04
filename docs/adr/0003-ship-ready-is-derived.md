# ADR-0003: Ship-readiness is derived, never stored; publishing goes through a server action
- **Status:** Accepted · **Date:** 2026-10-03

## Context
If `shipReady` were a column, any client with update rights on the draft could set it. Column-level write control isn't something we want to depend on.

## Decision
- `shipReady(version, claims, signoffs, kbVersion)` is a pure function in `src/engine/gate.ts`.
- The UI uses it for the badge.
- The `publishDraft` server action recomputes it from server-read data before creating a `publications` row.
- `publications` has `create:false` for members.

## Consequences
- (+) The gate can't be forged.
- (+) One function is tested once and used in two places.
- (−) Each badge render reads claims and signoffs (already synced, so the cost is negligible).

## Alternatives considered
- A stored status field plus validation hooks: more moving parts, and easier to get wrong.

## Revisit when
Never for this scope.
