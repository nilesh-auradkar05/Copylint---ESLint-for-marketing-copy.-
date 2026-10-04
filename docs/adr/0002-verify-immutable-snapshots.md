# ADR-0002: Verify immutable version snapshots, not live collaborative text
- **Status:** Accepted · **Date:** 2026-10-03

## Context
Claim highlights are character spans. Under concurrent Yjs editing, spans drift and verdicts silently attach to the wrong words.

## Decision
- `drafts.body` is a plain text field edited by one person at a time.
- A check snapshots the body into `draft_versions` (id = hash of draftId + body + kbVersion).
- Claims and spans belong to the snapshot. Editing the body never mutates old verdicts. It makes the next check a new version.

## Consequences
- (+) Verdicts are auditable and reproducible.
- (+) Spans are always correct for their version.
- (+) Idempotent re-checks.
- (−) No simultaneous co-editing of the body. Collaboration happens on claims (live cards, sign-offs), which is where the review actually happens.

## Alternatives considered
- Yjs collaborative body with relative positions: correct but costly; not needed for the core value.

## Revisit when
Users routinely co-write long drafts inside the tool.
