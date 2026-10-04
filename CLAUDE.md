# CLAUDE.md — Claude Code orchestrator (Lane A)

@AGENTS.md

## You are the Lane A orchestrator

- Launch: `claude --model claude-opus-5-5 --effort high` (or set via `/model` at session start).
- Your lane: **A — platform and engine** (see AGENTS.md §4). Codex runs Lane B in parallel in another worktree.
- You plan, delegate, verify, and merge. You do **not** write feature code yourself, except glue under ~30 lines while integrating.

## Subagents available (`.claude/agents/`)

| Subagent | Model / effort | Use for |
|---|---|---|
| `test-author` | claude-sonnet-5-5 / high | Step 1 of every task: failing tests from SPEC + acceptance criteria |
| `implementer` | claude-sonnet-5-5 / high | Step 2: make the tests pass, no test edits |
| `reviewer` | claude-sonnet-5-5 / high, read-only tools | Step 4: diff review against SPEC, ADRs, AGENTS.md §6 |

How to delegate (copy this shape):

```
Use the test-author subagent for T-005.
Inputs: TASKS.md row T-005, docs/SPEC.md §4.3–§4.6 and §5, ADR-0006.
Do NOT read src/engine/verify*.ts.
Return: list of test files, what each asserts, and the command to run them.
```

```
Use the implementer subagent for T-005.
Inputs: TASKS.md row T-005, docs/SPEC.md §4.3–§4.6 and §5, ADR-0006, tests: src/engine/verify.test.ts (read-only).
Return: files changed, how each acceptance criterion is met, any TEST-DISPUTE.
```

Parallelism:
- You may run test-author for task N+1 while implementer works on task N, if they touch disjoint files.
- Never run two implementers on overlapping files.

## Session start checklist (every session)

1. `git pull --rebase`. Read `todo.md`, then your lane's rows in `TASKS.md`.
2. `npx deepspace auth whoami --json`, then confirm the app id and source authority:
   - `npx deepspace app source` must report GitHub after T-001.
3. Re-read the SPEC sections for today's tasks. If `node_modules/deepspace/dist/*.d.ts` contradicts SPEC:
   - The `.d.ts` wins.
   - Write the correction into SPEC §11 ("Verified API facts").
   - Tell the human in one line.

## Session end checklist

1. Every DONE task has a VERIFICATION-LOG line.
2. `todo.md` "Next up" is accurate for whoever picks up next (you, Codex, or the human).
3. If it is the end of a sprint, fill the sprint section in `docs/sprint-review.md`.

## When to stop and ask the human

- Any CLI refusal without a shipped `action`: quota or slot, source authority, transfer or undeploy, billing.
- Any change to an ADR decision, to RBAC rules, or to the cut list.
- Any time a task would exceed its time box by more than 50%.
