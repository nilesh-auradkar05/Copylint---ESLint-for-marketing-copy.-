# ADR-0008: Which DeepSpace integrations we use, and which we deliberately don't
- **Status:** Accepted · **Date:** 2026-10-03

## Decision

**Used (each is on the important path or the drift path):**

| Primitive | Where |
|---|---|
| Auth + built-in RBAC | §3 permissions, ADR-0004 |
| Records + real-time sync | live claim cards and sign-offs across browsers |
| Background jobs | `verify-draft`, `sync-sources` |
| Managed knowledge (AI Search) | evidence retrieval |
| AI proxy (`createDeepSpaceAI`) | extract + judge |
| Cron | `docs-drift` |
| Server actions | `publishDraft` gate |
| Integration proxy: `resend/send-email` | stale alert. **Stretch, cut first** |

**Not used, on purpose:**

| Primitive | Why not |
|---|---|
| Payments | internal tool; nothing to charge for |
| LiveKit | no media |
| Google OAuth / Drive import | paste covers the core path; adds per-user consent flows |
| Yjs collaborative editing | ADR-0002 |
| Exa / Tavily | ADR-0001 |
| Messaging channels | comments live on sign-offs; a chat adds noise |
| Presence | stretch: nice for the demo, not required for correctness |

## Revisit when
A grader-visible flow would be clearly better with one of these. Otherwise, never during this build.
