# PRD — Groundtruth

**One line:** a review room where developer-marketing drafts are checked claim-by-claim against the product's own docs before they ship, and re-checked when the docs change.

## 1. Problem

AI makes developer copy cheap; accuracy is now the bottleneck. A wrong technical claim in a launch post costs developer trust. The worst case is a claim that also causes harm, like a billing exposure. Today the check is a Slack ping to an engineer: unstructured, unrecorded, and never repeated when the product changes.

**Evidence from DeepSpace's own context:**
- The GTM role explicitly includes keeping technical claims, demos, and educational content accurate with engineering.
- The SDK ships frequently (versioned docs, changelog), so content goes stale.

## 2. Users and roles

| Persona | App role | Jobs to be done |
|---|---|---|
| Writer (GTM / DevRel) | `member` | Paste a draft, run a check, apply fixes, request sign-off, publish |
| Engineer (reviewer) | `admin` | See only what needs judgment, approve or cut with a note |
| Owner | `admin` (pinned) | Manage source pages, run docs re-sync, see stale posts |

Signed-out visitors see a static landing page only. They get no data and cannot trigger checks.

## 3. Core user stories (the important path; must work on the live URL)

1. **Draft.** As a writer, I create a draft (title, channel, body ≤ 20,000 chars) and see it in my list.
2. **Check.** I click *Check claims*.
   - Within about 60 s, claim cards stream in live with progress.
   - Each card shows the verdict, the quoted span highlighted in the draft, cited docs excerpts with page path, and a suggested fix if contradicted.
3. **Fix.** I accept a suggested fix. It edits the body, which creates a new version and requires a re-check.
4. **Sign-off.** An engineer, viewing the same draft live in another browser, approves or cuts each unsupported or contradicted claim. Each decision carries a note.
5. **Gate.** The badge reads **SHIP-READY** only when every claim of the current version is either `supported` or approved. Publishing is refused server-side otherwise.
6. **Publish.** I record where it was published (URL). The publication is pinned to the checked version and docs version.
7. **Drift.**
   - A daily job, or an admin's *Run drift check now*, re-hashes source pages.
   - If a page cited by a live publication changed, that publication becomes **STALE** with the affected claims listed.
   - A re-verify runs automatically.

## 4. Non-goals (explicit, for the write-up)

- Open-web or competitor fact-checking. Curated docs only (ADR-0001).
- Real-time co-editing of the draft body (ADR-0002).
- Auto-publishing to any channel; payments; video; Google Docs import.
- Multi-tenant workspaces. One workspace per deployment (the default `SCOPE_ID`).

## 5. Success metrics

| Metric | Target | How measured |
|---|---|---|
| Contradicted-claim **recall** on golden set | ≥ 0.85 | `npm run eval` on `eval/golden-claims.jsonl` |
| Contradicted-claim **precision** | ≥ 0.80 | same |
| Citation validity | 100% of supported/contradicted verdicts cite a retrieved chunk | enforced in code + unit test |
| Time to verdicts (10-claim draft) | p50 ≤ 60 s | job `startedAt` → last claim `createdAt` in logs |
| Cost per check | ≤ $0.25 | `npx deepspace app usage` delta over 5 checks |
| Important path works on live URL | 100% | manual smoke + `tests/collab.spec.ts` |

**GTM framing for the write-up:**
- Leading indicator: contradicted claims caught before publish.
- Lagging indicator: stale posts caught after a release.

## 6. Acceptance demo (what the grader should be able to do in 3 minutes)

1. Sign in.
2. Open the seeded draft *"DeepSpace launch thread"* (`seed/launch-thread.md`) and click *Check claims*.
3. Watch five verdicts stream in. Claim 3 ("paid APIs are auth-gated for you") is **contradicted**, with a citation to `guides/external-apis`.
4. Accept the fix for claim 2 and re-check.
5. The badge stays BLOCKED until the "millions of users" claim is approved or cut.
