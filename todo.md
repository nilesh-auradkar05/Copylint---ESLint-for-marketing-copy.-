# todo.md — live working list (Sat Oct 3)

Short-horizon checklist for the human and both orchestrators. `TASKS.md` is the backlog; this is "right now".
Update at the start and end of every session. Keep it under one screen.

## Now (S0 — first 90 min)
- [ ] Create GitHub repo `groundtruth` (empty)
- [ ] `node --version` (supported line per docs) · `npm --version` ≥ 11.6
- [ ] `npm create deepspace@latest groundtruth` → git init → add remote → first commit → push
- [ ] Copy this docs pack into repo root → commit `docs: agent pack`
- [ ] `npx deepspace auth whoami --json` → correct owner account
- [ ] `npx deepspace deploy` → `npx deepspace app source` shows **GitHub**
- [ ] Worktrees: `../gt-lane-a` (Claude Code), `../gt-lane-b` (Codex); confirm distinct dev ports
- [ ] Start Claude Code (opus-5-5, high) in lane A: "Read CLAUDE.md, then start T-002 and T-003 per AGENTS.md section 3"
- [ ] Start Codex (gpt-6-astra, high) in lane B: "Read AGENTS.md, then run the task loop for T-010"

## Next up
- Lane A: T-002 → T-003 → T-004 → T-005 → T-006
- Lane B: T-010 → T-011 (fixtures from T-003)
- Human: review RBAC matrix (T-002) yourself; run probe queries (T-004.6); log both

## Waiting on / blocked
- T-010 in progress in `/tmp/groundtruth-lane-b-t010`, branch `t/T-010-app-shell`; stop after reviewer verdict. Dev port: 5174.
- T-001 scaffold is absent; Lane B is proceeding with fixtures and has requested the platform contracts in TASKS.md.

## Decisions made today
- Plan compressed to 3 sprints (Sat/Sun/Mon); cut line fixed in docs/sprint-plan.md

## End-of-day checks
- [ ] Live URL tried signed-in
- [ ] `npx deepspace app usage` noted in VERIFICATION-LOG
- [ ] docs/sprint-review.md section filled
