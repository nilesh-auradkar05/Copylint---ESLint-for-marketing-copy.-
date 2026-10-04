# ADR-0009: Two-harness, three-role agent workflow with independent test authorship
- **Status:** Accepted · **Date:** 2026-10-03

## Context
- The build uses Claude Code, Codex, and Cursor.
- The grader evaluates how the agents were directed and what the human verified.
- Agents that write both code and tests tend to write tests that confirm their code rather than the spec.

## Decision

**Orchestrators:**
- Claude Code main session (`claude-opus-5-5`, high effort) owns Lane A (platform and engine).
- Codex main session (`gpt-6-astra`, high reasoning) owns Lane B (UI and E2E).

**Each orchestrator spawns three role-scoped subagents:**

| Role | Claude Code | Codex |
|---|---|---|
| test-author | `claude-sonnet-5-5`, high | `gpt-6.1-sol`, high |
| implementer | `claude-sonnet-5-5`, high | `gpt-6.1-sol`, high |
| reviewer | `claude-sonnet-5-5`, high | `gpt-6.1-sol`, high |

**Rules:**
- Tests are written first, from SPEC acceptance criteria, by a different agent than the implementer.
- Implementers can't edit tests; disputes escalate to the orchestrator.
- Lanes use separate worktrees and dev ports.
- Shared contracts are owned by Lane A.
- Cursor is the human's takeover and final-review tool.
- Every merged task adds a line to `docs/VERIFICATION-LOG.md`.

## Consequences
- (+) Tests reflect the spec.
- (+) Parallel lanes roughly halve wall-clock time.
- (+) The verification log becomes the submission note.
- (−) Coordination overhead.

**Mitigation:** tasks are pre-split in `TASKS.md` with explicit file ownership. Optional cross-harness review (Codex reviews Lane A, Claude reviews Lane B) only for T-005 and T-014, the two highest-risk diffs.

## Revisit when
A lane is idle for more than 2 h waiting on the other. Then merge lanes and run single-harness.
