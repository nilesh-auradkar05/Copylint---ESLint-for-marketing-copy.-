# ADR-0004: Use built-in roles — member = writer, admin = engineer
- **Status:** Accepted · **Date:** 2026-10-03

## Context
DeepSpace ships `viewer / member / admin` roles enforced in the Durable Object. The owner is pinned to admin and can promote users with `useUsers().setRole`.

## Decision
- Writers are `member`. Engineers are `admin`.
- `signoffs.create`, `/api/admin/sync`, cron triggers, and job-socket writes are admin-only.
- No custom role system.

## Consequences
- (+) Zero custom RBAC code. Every rule is declarative and server-enforced.
- (−) Engineers also get admin powers over sources. Acceptable for a single-team tool.

## Alternatives considered
- A `reviewers` collection plus collaborator checks: finer-grained, but more code and more surface for mistakes.

## Revisit when
Multi-team deployment, or engineers who must not manage sources.
