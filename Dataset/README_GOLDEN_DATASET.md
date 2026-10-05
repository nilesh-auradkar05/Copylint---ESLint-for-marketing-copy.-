# CopyLint Golden Dataset v2

This dataset is designed for the current **CopyLint / Groundtruth** architecture: extraction produces atomic claims, retrieval returns at most five curated-document chunks, the judge emits `supported | contradicted | unsupported`, and the citation guard can downgrade an uncited positive verdict.

## Contents

- `golden-claims-v2.jsonl` — **122 judge-only golden claims**. Distribution: 49 supported / 49 contradicted / 24 unsupported.
- `golden-drafts-v1.jsonl` — **24 extraction/adversarial drafts** with partial semantic assertions rather than brittle exact-model-output snapshots.
- `golden-citation-guard-v1.jsonl` — **12 deterministic validateJudge cases**.
- `golden-spans-v1.jsonl` — **16 locateQuote / segmentBySpans edge cases**.
- `golden-gate-v1.jsonl` — **14 deterministic publish-gate/sign-off cases**.
- `golden-ids-v1.jsonl` — **12 normalizeClaim/hash-input normalization cases**.
- `golden-reverify-v1.jsonl` — **8 changed-page carry-forward cases**.
- `retrieval-probes-v2.json` — **20 paraphrased retrieval probes**, harder than the original 10.
- `manifest.json` — counts and provenance.

## Why the claim set is split into `core` and `edge`

The live judge costs credits. `suite: "core"` is the smaller regression gate; `suite: "edge"` adds confusing defaults, scope qualifiers, close numeric boundaries, billing/auth interactions, race conditions, and plausible unsupported enterprise claims. Run core on every prompt change and the full set only at freeze points.

## Claim-row schema

```json
{
  "id": 1,
  "suite": "core | edge",
  "claim": "standalone claim",
  "label": "supported | contradicted | unsupported",
  "page": "expected source page or null",
  "kind": "capability | limit | number | default | security | pricing | deployment | comparison",
  "difficulty": "standard | adversarial",
  "tags": ["phenomenon", "..."],
  "pair_id": "p01 or null",
  "note": "human rationale",
  "expected_fix": "smallest supported rewrite for contradictions, else null",
  "review_status": "provenance marker"
}
```

Extra fields are deliberately additive, so a runner that only reads the legacy `id/claim/label/page/note` fields can ignore them.

## Recommended judge metrics

Keep the project targets and add macro metrics:

1. confusion matrix across all three verdicts;
2. contradicted precision and recall;
3. supported precision;
4. unsupported recall;
5. citation validity = 100% for supported/contradicted after guard;
6. downgrade rate from `validateJudge`;
7. accuracy by `suite`, `kind`, and tag;
8. minimal-pair consistency: both rows in a `pair_id` should be correct;
9. retrieval hit: expected `page` appears in top-5 for non-null pages;
10. judge-only error vs retrieval miss diagnosis.

## Important scoring rule

`unsupported` means **the curated corpus is silent or insufficient**, not “false in the real world.” Do not let the judge import general Cloudflare, Stripe, security-certification, or competitor knowledge.

## Extraction-suite scoring

Do **not** demand exact JSON equality from the extractor. For each draft:

- every `must_extract[].semantic` should appear as a semantically equivalent standalone claim;
- every `must_not_extract` string should not become a DeepSpace claim;
- claim count must remain within `expected_min_claims..expected_max_claims`;
- extracted `quote` must locate back into the original body;
- prompt-injection text is data and must not change behavior;
- final persisted claims are capped at 25.

## Suggested CI tiers

- `golden:unit`: citation guard + spans + gate + ids + reverify. No paid calls.
- `golden:extract`: mocked/controlled extractor tests using the draft suite.
- `golden:judge:core`: paid judge run on only `suite=core`.
- `golden:judge:full`: paid run on all 122 claims at freeze/release.
- `golden:retrieve`: 20 probe top-5 hit-rate; target at least 16/20 before prompt tuning.

## Human review note

The factual rows were constructed against the repository’s configured DeepSpace source pages and the documentation state reviewed on 2026-10-05. DeepSpace docs change frequently. Before treating this as a permanently frozen benchmark, re-check every factual pair against the exact corpus snapshot actually ingested by the app, then freeze that snapshot or record its hashes. Otherwise the benchmark will eventually test history rather than truth, a classic human invention.
