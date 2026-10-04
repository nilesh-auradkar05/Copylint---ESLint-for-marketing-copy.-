# Kickoff prompts (paste as-is)

## Claude Code — Lane A orchestrator
```
claude --model claude-opus-5-5 --effort high
```
```
You are the Lane A orchestrator. Read CLAUDE.md, AGENTS.md, docs/PRD.md, docs/SPEC.md, docs/adr/*, TASKS.md, todo.md.
Then:
1) Summarize in 10 lines what Lane A must deliver today and anything in SPEC you believe is wrong or ambiguous
   (do not change it yet).
2) Verify the [CHECK] items in SPEC section 11 that block T-002..T-005 by reading node_modules/deepspace/dist/*.d.ts
   and the docs (.md pages). Write the results into SPEC section 11 and show me the diff before committing.
3) Start T-002 and T-003 with the AGENTS.md section 3 loop. They touch disjoint files, so you may run their
   test-authors in parallel.
Stop after each task's reviewer verdict and give me: tests added, review findings, what I should verify by hand.
```

## Codex — Lane B orchestrator
```
cd ../gt-lane-b && codex      # .codex/config.toml selects gpt-6-astra, reasoning high
```
```
You are the Lane B orchestrator. Read AGENTS.md (it requires you to delegate via subagents), docs/PRD.md,
docs/SPEC.md sections 6 and 9, docs/adr/0002 + 0003 + 0004, TASKS.md, todo.md.
Run the AGENTS.md section 3 loop for T-010 using the custom agents test_author, implementer, reviewer.
Read docs.deep.space/design/product-polish.md and /design/anti-ai-gate.md before the implementer starts.
Use dev port 5174. Never edit Lane A files (src/engine/**, src/schemas/**, worker.ts, wrangler.toml).
If you need a contract change, write CONTRACT-CHANGE in TASKS.md and continue with fixtures.
Stop after the reviewer verdict and give me: tests added, findings, what I should check in the browser.
```

## Cross-harness review (only T-005 and T-014)
In Codex:
```
Spawn reviewer on branch t/T-005-verify-job in ../gt-lane-a: git diff main...t/T-005-verify-job.
Focus: retry-safety, citation guard, prompt-injection handling, ctx.signal propagation, cost bounds.
Output in the reviewer format.
```
