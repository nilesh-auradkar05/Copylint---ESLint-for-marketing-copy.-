# Test plan — Groundtruth

## Principles
1. **Independent authorship.** Tests are written by a test-author agent from SPEC acceptance criteria, before implementation (AGENTS.md §3). Implementers never edit tests.
2. **Test the boundary that matters.**
   - Security is tested at the server (forged writes over the records API), not by checking that a button is hidden.
   - Model quality is tested by eval, not by unit tests.
3. **Mock only the outside world:** model calls, knowledge search/add, docs `fetch`, the integration proxy.
4. **Paid calls are budgeted:**
   - at most one live model smoke per task
   - golden-set eval at most 3 runs before freeze
   - never paid calls in loops

## Layers

| Layer | Tool | What | Owner |
|---|---|---|---|
| Unit (pure) | Vitest | `ids`, `spans`, `gate`, `citations`, `quota`, segment rendering helpers | test-author A/B |
| Engine (adapters mocked) | Vitest | `verify` job algorithm: idempotency, repair retry, failed status, carry-forward, progress, signal passing, injection fixture | test-author A |
| API / RBAC | Playwright (`deepspace/testing`, `api.spec.ts`) | Every collection × {anon, member, other member, admin} × {read, create, update}; routes 401/403/404/413/429 | test-author A |
| Multi-user E2E | Playwright (`collab.spec.ts`) | Writer + engineer live sync; badge flips on approve; forged signoff refused; non-collaborator blocked | test-author B |
| Smoke | Playwright (`smoke.spec.ts`) | Landing renders signed-out; sign-in reaches drafts | scaffold + B |
| Retrieval quality | `eval/probes.json` | top-5 page hit-rate ≥ 8/10 | human runs, logs |
| Judge quality | `eval/golden-claims.jsonl` (28 claims: 15 S / 9 C / 4 U) | contradicted P ≥ 0.80, R ≥ 0.85; citation validity 100% | human owns labels; test-author owns runner |
| Manual | browser ×2 + phone | important path on live URL, fresh account | human |

## RBAC matrix (T-002 / T-015 must cover every cell)

| Collection | anon read | member create | member read others' | admin create | notes |
|---|---|---|---|---|---|
| drafts | ✗ | ✓ | only if collaborator | ✓ | update `'shared'` |
| draft_versions | ✗ | ✗ | ✓ | (server) | |
| claims | ✗ | ✗ | ✓ | (server) | `uniqueOn` versionId+claimHash |
| signoffs | ✗ | ✗ | ✓ | ✓ | `uniqueOn` claimId+reviewerId; reviewerId userBound |
| publications | ✗ | ✗ | ✓ | (server via action) | |
| sources / kb_state | ✗ | ✗ | ✓ | (server) | |

## Golden-set rules
- **Labels mean** "what the curated corpus says", not "what is true in the world". `unsupported` = not stated in the corpus (ADR-0001).
- Labels were drafted from docs at SDK 0.33.1.
  - The **human re-verifies each label against the live page** before eval run #1.
  - Any change is logged with the reason.
- **Agents may not edit labels.**
- Report per run:
  - confusion matrix
  - contradicted P/R
  - supported precision
  - `% downgraded by citation guard`
  - cost
  - `PROMPT_VERSION`
- **Diagnose each miss.** Retrieval miss (expected page not in top 5) vs judge error. Retrieval misses are fixed in ingestion/chunking, not in the prompt.

## Fixtures
- `seed/launch-thread.md`: expected
  - claims 2 and 4 contradicted
  - 2 supported (215+ APIs; server-side permissions)
  - "millions of users" unsupported
  - the opener may or may not be extracted (both acceptable)
- `eval/fixtures/injection-draft.md`: the injected instruction must have no effect.
- `eval/fixtures/review-room.json`: produced by T-003 for Lane B UI work.
- Changed-page fixture for T-004/T-020: a mocked `fetch` returning a modified `guides/external-apis.md`.
