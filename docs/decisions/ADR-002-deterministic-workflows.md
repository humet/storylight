# ADR-002: Deterministic AI Workflows

**Status:** Accepted

## Context

Autonomous agents create unpredictable sequencing, cost, state mutation, and debugging difficulty.

## Decision

Use durable deterministic workflows with narrow model calls and strict structured outputs.

## Consequences

- Models do not select tools or publish content.
- Application code controls retries, review, and state changes.
- Every stage is resumable.
- More orchestration code is required, but correctness and observability improve.
