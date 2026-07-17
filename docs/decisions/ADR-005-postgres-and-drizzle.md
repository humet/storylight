# ADR-005: Postgres and Drizzle

**Status:** Accepted

## Context

Storylight requires transactions, constraints, revision history, structured metadata, and strong TypeScript integration.

## Decision

Use Postgres as the canonical relational store and Drizzle ORM for schema and queries.

## Consequences

- Transactions protect chapter publication and continuity.
- Database constraints back up workflow locks.
- Migrations are source controlled.
- Large image files remain in object storage.
- Provider-specific managed Postgres hosting remains replaceable.
