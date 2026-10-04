# ADR-0001: Curated, versioned DeepSpace docs are the only source of truth
- **Status:** Accepted · **Date:** 2026-10-03

## Context
The judge needs evidence. Open-web search (e.g. `exa/search`) would cover competitor and general claims, but results are unversioned, unreproducible, and can't be hashed for drift detection. The grader values judgment and a working core over breadth.

## Decision
- Evidence comes only from ~25 pages listed in `CONFIG.sourcePages`, fetched as `.md` from docs.deep.space and stored in the app's managed knowledge base under folder `docs`.
- Claims the corpus doesn't address are `unsupported` and go to an engineer.

## Consequences
- (+) Every verdict cites a page the team controls.
- (+) Verdicts are reproducible against a known `kbVersion`.
- (+) Drift detection is a simple hash compare.
- (−) Lower recall: "faster than Firebase" or "300 edge locations" become `unsupported`, not checked. This is the **main tradeoff** in the submission note.

## Alternatives considered
- Exa / Tavily web search as a second evidence tier: deferred. It adds an unversioned source and a second billing surface.
- Embedding the docs into the prompt (no retrieval): ~25 pages is too large per call and costs more per claim.

## Revisit when
Golden-set `unsupported` rate on real drafts exceeds about 40%, meaning writers mostly make claims outside the docs.
