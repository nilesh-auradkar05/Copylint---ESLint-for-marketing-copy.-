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

2026-10-04 17:48 ET | T-003 | [agent: claude/test-author] wrote 144 engine tests + eval/fixtures/review-room.json; [agent: claude/implementer] wrote src/engine/{config,contracts,ids,spans,gate,citations}.ts; [agent: claude/reviewer] APPROVE, 2 SHOULD (shipReady trusts caller to scope claims to the version; locateQuote can return one span for two near-duplicate quotes) | [orchestrator] ran type-check, lint, vitest on merged main (415/415); confirmed implementer touched no test or fixture | pass; `npx deepspace test run` not run
2026-10-04 17:48 ET | T-002 | [agent: claude/test-author] wrote 271 schema tests through the SDK's canRead/canCreate/canUpdate/canDelete/checkFieldPermissions/lintSchemas, and 21 Playwright stubs (test.fixme); [agent: claude/implementer] wrote 7 schemas + hardening (member writableFields on drafts, immutable signoff claimId/versionId); [agent: claude/reviewer] APPROVE on the pre-hardening diff | [orchestrator] ran type-check, lint, vitest on merged main (415/415) | schema-level pass; NOT verified live: no RBAC run against a worker, no admin test user, hardening commits not re-reviewed
2026-10-04 21:04 ET | T-004 | [agent: claude/test-author] wrote 63 unit tests (retrieve, sync-sources, admin sync route, runJob dispatch, wrangler binding) + 3 Playwright cases (1 live, 2 fixme); [agent: claude/implementer] wrote src/engine/{retrieve,sync}.ts, src/server/admin-routes.ts, runJob dispatch, [[ai_search]] binding; [agent: claude/reviewer] pass 1 CHANGES REQUIRED (BLOCKER: kb_state bump lost when a sync failed after a page's new hash was stored), pass 2 APPROVE after fix, 3 SHOULD | [orchestrator] ran type-check, lint, vitest (486/486) and `npx deepspace test run` (9 passed, 21 fixme-skipped; anonymous POST /api/admin/sync = 401 on local dev); reproduced and fixed the dev-server break caused by the ai_search binding (vite remoteBindings:false); confirmed implementer touched no test; applied 2 reviewer SHOULDs as glue (member authorizeRead on AppJobRoom, log on failed bump) which the reviewer has NOT re-read | unit-level pass; NOT verified live: T-004.1 binding deploy, T-004.2 real sync, T-004.5 member 403 / admin 202, T-004.6 probes. Open: sync assumes one kb item per page (no guard); bump write failing on the success path still loses the bump; old items removed before new ones are indexed (revisit in T-020)

2026-10-04 23:00 ET | T-010b | [agent: codex/test_author] authored live drafts/privacy/sample tests and snapshot badge regressions; [agent: codex/implementer] wired protected draft routes, confirmed creation, shared gate/config, navigation; [agent: codex/reviewer] APPROVE after fixing in-flight snapshot detection | [orchestrator] type-check, lint, Vitest 503/503, `deepspace test run all --port 5174` 16 passed / 21 pre-existing documented skips; no implementer test edits | local pass; deploy and live smoke pending
2026-10-05 11:33 ET | T-002 | [agent: claude/test-author] replaced 21 fixme stubs with real Playwright tests through the SDK hooks (anon 0 rows x7 + control, draft own/shared/delete, member create refused x6 + forged signoff, admin signoff userBound + duplicate + immutable) and tests/helpers/records-probe.tsx; no RBAC finding; [agent: claude/reviewer] APPROVE, 4 SHOULD | [human] promoted test account `Engineer` to admin in local dev via /api/debug/set-role; [orchestrator] ran `npx deepspace test run api --port 5662`: 28 passed, 1 skipped (paid sync, opt-in); type-check, lint, vitest 503/503 | pass on LOCAL server only. Gaps: anon-read control exists for drafts+signoffs only (other 5 collections are empty, so 0 rows does not prove denial live); admin create on the 5 server-only collections is unit-tested only; "another admin cannot edit a signoff" untested (one admin account); whole matrix skips silently if a test account is missing; not run against the deployed app
2026-10-05 11:33 ET | T-004 | [agent: claude/test-author] T-004.5 member 403 is now a live test (bearer token from the signed-in page); admin 202 implemented but gated behind RUN_PAID_SYNC=1 | [orchestrator] ran it in the same suite run: 401 and 403 pass | admin 202 NOT run: local dev holds the app's real identity token, so it would upload 25 pages into the shared knowledge base

2026-10-05 12:07 ET | T-011 | [agent: codex/test_author, gpt-6.1-sol/high] wrote 14 independent RED fixture tests; [agent: codex/implementer, gpt-6.1-sol/high] built immutable review snapshot, ordered evidence cards, scoped gate and states | [orchestrator/reviewer] APPROVE fixture slice after loading-focus correction; type-check/lint clean, Vitest 517/517; rebased runtime 34 pass / 4 failures (local Engineer role is member) / 1 paid-sync skip; browser light/dark, 1440px/390px, keyboard, reduced motion and overflow checks pass | partial, unmerged: T-011b and deployed verification pending; no implementer test edits
