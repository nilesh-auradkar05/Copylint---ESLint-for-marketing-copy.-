# Verification log

One line per merged task, plus any human takeover. This file is the evidence behind the submission note.

**Format:**
```
YYYY-MM-DD HH:MM ET | T-ID | [agent: <harness/role>] produced … | [human|orchestrator] verified … by … | result
```

**Tags:**
- `[human]` = I personally did or checked it.
- `[takeover]` = I edited code myself.
- `[eval]` = golden-set or probe run (include P/R, cost).

**Examples of the expected granularity:**
```
2026-10-03 14:10 | T-002 | [agent: claude/implementer] wrote 7 schemas | [human] read every permissions block against SPEC §3; ran api.spec RBAC matrix with 2 accounts + anon | pass
2026-10-03 16:40 | T-004 | [eval] probes 9/10 top-5 hit (miss: "uniqueOn" → expected concepts/permissions, got guides/data-storage) | [human] ran on live app | pass
2026-10-04 11:05 | T-007 | [eval] p1: contradicted P=0.82 R=0.78, $0.41/run → p2 added contrastive examples: P=0.86 R=0.89 | [human] re-labeled claim #23 after reading page | pass
```

---
