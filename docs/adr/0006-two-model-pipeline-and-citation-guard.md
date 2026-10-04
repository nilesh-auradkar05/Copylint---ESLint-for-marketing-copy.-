# ADR-0006: Haiku extracts, Sonnet judges; citations are validated in code
- **Status:** Accepted · **Date:** 2026-10-03

## Context
- Extraction is high-volume and simple.
- Judging needs careful reading of evidence.
- LLMs can invent citations and are unreliable at character offsets.

## Decision
- Extraction uses `claude-haiku-4-5` and returns `quote`, not offsets. Spans are located in code.
- The judge uses `claude-sonnet-5` with retrieved chunks labeled `c0..c4`.
- Code drops citations outside the retrieved set. A supported or contradicted verdict without a valid citation is downgraded to `unsupported`.
- All model output is zod-validated with one repair retry.
- Prompts are versioned (`PROMPT_VERSION`).

## Consequences
- (+) No hallucinated citations reach the UI.
- (+) Spans are exact.
- (+) Cost is concentrated where quality matters.
- (−) Downgrades lower recall slightly; measured on the golden set.

## Alternatives considered
- A single model for both steps: simpler, costlier, and no better at offsets.
- One batched judge call for all claims: cheaper, but one bad output fails everything and citations get confused across claims.

## Revisit when
Golden-set contradicted recall < 0.85. Then try more retrieved chunks (`limit: 8`) or a stronger judge model before changing the architecture.
